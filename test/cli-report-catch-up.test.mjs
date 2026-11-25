import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinApplication } from '../src/cli/application.mjs';
import { catchUpIdle, readCatchUp, setCatchUp, startCatchUp, tickCatchUp } from '../src/cli/catch-up.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { buildInvocation } from '../src/cli/harnesses.mjs';
import { main } from '../src/cli/main.mjs';
import { saveShortReport } from '../src/cli/reports.mjs';
import { reportReadStates, Telemetry } from '../src/cli/telemetry.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const MINUTE = 60000;
const STARTED = Date.parse('2026-11-01T00:00:00Z');
const iso = ms => new Date(ms).toISOString();

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-catch-up-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  config.tiers = { fast: { model: 'fixture/fast', effort: 'medium' } };
  atomicJson(join(root, 'config.json'), config);
  return root;
}

const output = () => ({ text: '', write(chunk) { this.text += chunk; } });

/** A saved list of reports, as the running hobkin leaves it for `hobkin reports`. */
function savedView(root, reports) {
  mkdirSync(join(root, 'runtime'), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'runtime/view.json'), JSON.stringify({ version: 1, reports }));
}

const listed = (id, minutes, body = `Useful: ${id} found something.`, patch = {}) => ({
  id, title: `Routine ${id}`, scheduleId: `routine-${id}`, at: iso(STARTED + minutes * MINUTE), body, outcome: 'completed', ...patch,
});

/**
 * hobkin itself on a home whose reads were watched from the start, with no model: each catch-up's model run gets
 * `answer(request)`, and any other model run fails, as one with no model would. Both triggers start off, so only a
 * test's own ask or the triggers it sets start a catch-up, and its first tick is over before the test goes on.
 */
async function openHobkin(t, root, { answer = () => ({ status: 'completed', text: CATCH_UP_TEXT, cost: null }), now, catchUp = {} } = {}) {
  Telemetry.open(root, STARTED);
  setCatchUp(root, { daily: null, pileUp: null, ...catchUp });
  const asked = [];
  const runHarness = async request => {
    if (request.purpose !== 'catch-up') throw Error(`Unexpected ${request.purpose} job.`);
    asked.push(request);
    return answer(request);
  };
  const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, runHarness, intervalMs: 60000, ...(now ? { now } : {}) });
  t.after(() => app.close());
  await app.runner.tick();
  return { app, asked };
}

/** A routine's run that finished with `text` as its report, listed once hobkin refreshes. */
async function finishRun(app, id, text, { scheduleId = 'digest', title = 'Digest', status = 'completed', trigger } = {}) {
  await app.runtime.admit({ id, kind: 'background', scheduleId, title, ...(trigger ? { trigger } : {}) });
  await app.runtime.finish(id, { status, text, ...(status === 'failed' ? { error: text } : {}) });
}

const CATCH_UP_TEXT = 'Useful: Two invoices came in, and the mail check found nothing that needs you.\n\n## What happened\n\nThe digest found two invoices.';

test('a report is read once opened for 3 seconds or asked about, caught up once a catch-up covered it, and read wins', t => {
  const root = home(t);
  const telemetry = Telemetry.open(root, STARTED);

  telemetry.recordReportRead({ id: 'opened', dwellMs: 4000 }, STARTED + MINUTE);
  telemetry.recordReportRead({ id: 'glanced', dwellMs: 1000 }, STARTED + MINUTE);
  telemetry.recordReportDiscussed('asked', STARTED + MINUTE);
  telemetry.recordCaughtUp(['covered', 'opened later', 'opened'], 'catch-up:1', STARTED + 2 * MINUTE);
  telemetry.recordReportRead({ id: 'opened later', dwellMs: 3000 }, STARTED + 3 * MINUTE);

  assert.deepEqual(Object.fromEntries(reportReadStates(root)), {
    opened: 'read', asked: 'read', covered: 'caught-up', 'opened later': 'read',
  });
  const caught = telemetry.events.filter(({ type }) => type === 'report_caught_up');
  assert.deepEqual(caught[0], { type: 'report_caught_up', at: iso(STARTED + 2 * MINUTE), id: 'covered', by: 'catch-up:1' });
});

test('a caught-up report is still unopened in report-attention.json', t => {
  const root = home(t);
  const telemetry = Telemetry.open(root, STARTED);
  const runs = Array.from({ length: 6 }, (_, day) => ({
    id: `digest-${day}`, kind: 'background', scheduleId: 'digest', title: 'Digest', status: 'completed',
    finishedAt: iso(STARTED + (day + 1) * 86400000), result: { status: 'completed', text: 'Useful: Something happened.' },
  }));

  telemetry.recordCaughtUp(runs.map(({ id }) => id), 'catch-up:1', STARTED + 7 * 86400000);
  const [digest] = telemetry.attention(runs, STARTED + 8 * 86400000);

  assert.equal(digest.read, 0);
  assert.equal(digest.ignored, true);
});

test('hobkin reports gives each report its read state: read, caught-up or unread', async t => {
  const root = home(t);
  savedView(root, [listed('a', 1), listed('b', 2), { ...listed('c', 3), readState: 'read' }]);
  const telemetry = Telemetry.open(root, STARTED);
  telemetry.recordReportRead({ id: 'a', dwellMs: 5000 }, STARTED + 10 * MINUTE);
  telemetry.recordCaughtUp(['b'], 'catch-up:1', STARTED + 10 * MINUTE);
  const printed = output();

  assert.equal(await main(['reports', '--home', root], printed), 0);

  const reports = JSON.parse(printed.text);
  assert.deepEqual(reports.map(({ id, read }) => [id, read]), [['c', 'unread'], ['b', 'caught-up'], ['a', 'read']]);
  assert.equal(reports.some(report => 'readState' in report), false, 'one field says it, from the reads themselves');
  assert.equal(reports[0].routineId, 'routine-c');
});

test('hobkin\'s snapshot marks a report read or caught-up, and an unread one with nothing', { timeout: 20000 }, async t => {
  const root = home(t);
  const { app } = await openHobkin(t, root);
  for (const id of ['opened', 'covered', 'unread']) await finishRun(app, id, `Useful: ${id}.`);

  app.recordReportRead({ id: 'opened', dwellMs: 5000 });
  app.telemetry.recordCaughtUp(['covered', 'opened'], 'catch-up:1');
  const { reports } = await app.refresh();

  assert.deepEqual(Object.fromEntries(reports.map(({ id, readState }) => [id, readState])), {
    opened: 'read', covered: 'caught-up', unread: undefined,
  });
});

test('a new home catches up daily at 08:00 and at 8 reports, and counts only the unread reports from runs since tracking began', t => {
  const root = home(t);
  const telemetry = Telemetry.open(root, STARTED);
  savedView(root, [
    listed('unread', 1),
    listed('failed', 2, 'The run failed: no network.', { outcome: 'failed' }),
    listed('opened', 3),
    listed('covered', 4),
    listed('quiet', 5, 'Nothing new.'),
    listed('unchanged', 6, 'No change.', { outcome: 'no_change' }),
    listed('catch-up:1', 7, 'Useful: Two reports matter.', { scheduleId: 'catch-up' }),
    listed('old', -60),
    listed('imported', 8, 'Useful: From the old extension.', { outcome: 'imported' }),
  ]);
  telemetry.recordReportRead({ id: 'opened', dwellMs: 5000 }, STARTED + 10 * MINUTE);
  telemetry.recordCaughtUp(['covered'], 'catch-up:1', STARTED + 10 * MINUTE);

  assert.deepEqual(readCatchUp(root), { daily: '08:00', pileUp: 8, running: false, lastAt: null, uncovered: 2 });
});

test('the catch-up settings change one at a time, turn off with null, and refuse a bad time or count in plain words', t => {
  const root = home(t);
  const config = () => JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));

  assert.deepEqual(setCatchUp(root, { daily: '18:30' }), { daily: '18:30', pileUp: 8, running: false, lastAt: null, uncovered: 0 });
  assert.equal(setCatchUp(root, { pileUp: 30 }).daily, '18:30', 'what is left out stays as it was');
  assert.deepEqual(setCatchUp(root, { daily: null, pileUp: null }), { daily: null, pileUp: null, running: false, lastAt: null, uncovered: 0 });
  assert.deepEqual(config().catchUp, { daily: null, pileUp: null });
  assert.equal(config().background.model, 'fixture/check', 'the rest of config.json stays as it was');

  for (const daily of ['8:00', '24:00', '07:60', 'noon', 8]) {
    assert.throws(() => setCatchUp(root, { daily }), /^Error: The daily catch-up time is HH:MM on a 24-hour clock, such as 08:00\.$/);
  }
  for (const pileUp of [0, -1, 1.5, '3']) {
    assert.throws(() => setCatchUp(root, { pileUp }), /^Error: A pile-up is a whole number of reports, 1 or more\.$/);
  }
  assert.deepEqual(config().catchUp, { daily: null, pileUp: null }, 'a refused change changes nothing');
  assert.equal(setCatchUp(root, { pileUp: 1 }).pileUp, 1);
});

const until = async check => {
  while (!check()) await new Promise(resolve => setTimeout(resolve, 5));
};

test('a catch-up covers exactly the uncovered unread reports, once it has finished, and one runs at a time', { timeout: 20000 }, async t => {
  const root = home(t);
  const answered = Promise.withResolvers();
  const { app, asked } = await openHobkin(t, root, { answer: () => answered.promise });
  const long = `Useful: The mail check found a letter from the bank.\n\n${'The letter asks for a signed form before Friday. '.repeat(30)}`;
  await finishRun(app, 'digest-1', 'Useful: The digest found two invoices.');
  saveShortReport(root, 'digest-1', 'Two invoices came in.');
  await finishRun(app, 'mail-1', long, { scheduleId: 'mail', title: 'Mail' });
  await finishRun(app, 'quiet-1', 'Nothing new.', { trigger: 'manual' });
  await finishRun(app, 'opened-1', 'Useful: Opened already.');
  app.recordReportRead({ id: 'opened-1', dwellMs: 5000 });
  await app.refresh();

  assert.deepEqual(startCatchUp(root, app), { message: 'hobkin is writing a catch-up of 2 unread reports. It shows in Reports when it is done, in about a minute.' });
  assert.equal(readCatchUp(root).running, true);
  assert.deepEqual(startCatchUp(root, app), { message: 'hobkin is already writing a catch-up. Reports that came in since go in the next one.' });
  await until(() => asked.length);

  const [request] = asked;
  assert.equal(request.purpose, 'catch-up');
  assert.equal(request.model, 'fixture/fast');
  assert.equal(request.effort, 'low');
  const { reports, routines } = JSON.parse(request.prompt);
  assert.deepEqual(reports.map(({ id }) => id), ['mail-1', 'digest-1'], 'newest first, and only the uncovered unread ones');
  assert.deepEqual(reports[1], {
    id: 'digest-1', title: 'Digest', routine: 'digest', at: reports[1].at, outcome: 'completed',
    triage: 'Useful: The digest found two invoices.', text: 'Two invoices came in.',
  });
  assert.equal(reports[0].triage, 'Useful: The mail check found a letter from the bank.');
  assert.equal(reports[0].text, `${long.slice(0, 600).trimEnd()}…`, 'with no short version, the start of the body');
  assert.ok(Array.isArray(routines));

  await finishRun(app, 'late-1', 'Useful: This came in while the catch-up was written.');
  answered.resolve({ status: 'completed', text: CATCH_UP_TEXT, cost: null });
  await catchUpIdle(root);
  const listed = (await app.refresh()).reports;

  const states = Object.fromEntries(listed.map(({ id, readState }) => [id, readState]));
  assert.deepEqual([states['digest-1'], states['mail-1'], states['late-1'], states['opened-1']], ['caught-up', 'caught-up', undefined, 'read']);
  const written = listed.find(({ scheduleId }) => scheduleId === 'catch-up');
  assert.equal(written.title, 'Catch-up');
  assert.equal(written.body, CATCH_UP_TEXT);
  const caught = app.telemetry.events.filter(({ type }) => type === 'report_caught_up');
  assert.deepEqual(caught.map(({ id, by }) => [id, by]), [['mail-1', written.id], ['digest-1', written.id]]);
  const after = readCatchUp(root);
  assert.equal(after.running, false);
  assert.equal(after.uncovered, 1, 'the report that came in during the run, and never the catch-up itself');
  assert.ok(Number.isFinite(Date.parse(after.lastAt)));
});

test('a catch-up that fails covers nothing, and with nothing uncovered none starts', { timeout: 20000 }, async t => {
  const root = home(t);
  const answers = [{ status: 'failed', text: '', error: 'The model is not signed in.' }, { status: 'completed', text: '  ' }];
  const { app, asked } = await openHobkin(t, root, { answer: () => answers.shift() });

  assert.deepEqual(startCatchUp(root, app), { message: 'Nothing to catch up on: every report is read or already in a catch-up.' });
  assert.equal(readCatchUp(root).running, false);

  await finishRun(app, 'digest-1', 'Useful: The digest found two invoices.');
  await app.refresh();
  for (let attempt = 0; attempt < 2; attempt++) {
    startCatchUp(root, app);
    await catchUpIdle(root);
    await app.refresh();
  }

  assert.equal(asked.length, 2);
  assert.equal(app.telemetry.events.some(({ type }) => type === 'report_caught_up'), false);
  assert.deepEqual(readCatchUp(root), { daily: null, pileUp: null, running: false, lastAt: null, uncovered: 1 });
});

test('with no fast model to write it, no catch-up starts and hobkin says so', { timeout: 20000 }, async t => {
  const root = home(t);
  const { app, asked } = await openHobkin(t, root);
  await finishRun(app, 'digest-1', 'Useful: The digest found two invoices.');
  await app.refresh();
  const { tiers, background: { model, ...background }, ...config } = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
  atomicJson(join(root, 'config.json'), { ...config, background });

  assert.deepEqual(startCatchUp(root, app), { message: 'hobkin has no fast model to write a catch-up with. Choose one for the fast tier in Settings.' });
  assert.equal(asked.length, 0);
});

test('the catch-up runs with no tools, and its prompt asks for a one-minute read in three parts that links each report and changes nothing', t => {
  const root = home(t);
  const { args } = buildInvocation({
    id: '00000000-0000-4000-8000-000000000000', harness: 'pi', purpose: 'catch-up', cwd: root, model: 'fixture/fast', effort: 'low',
    prompt: '{"reports":[],"routines":[]}', sessionFile: join(root, 'job.jsonl'),
  });

  assert.ok(args.includes('--no-tools'));
  const prompt = args[args.indexOf('--system-prompt') + 1];
  assert.match(prompt, /under 200 words/);
  for (const label of ['Critical:', 'Blocked:', 'Useful:']) assert.ok(prompt.includes(`\`${label}`), label);
  for (const part of ['## What happened', '## Open these', '## Skippable']) assert.ok(prompt.includes(part), part);
  assert.ok(prompt.includes('[title](hobkin-report:<id>)'));
  assert.match(prompt, /Never pause, change or delete a routine/);
});

/** Local wall time `days` after midnight three days ago, as the app's clock reads it. */
const localTime = (days, hours, minutes) => {
  const day = new Date(Date.now() - 3 * 86400000);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days, hours, minutes).getTime();
};

test('the daily catch-up comes once a day at its time when something is uncovered and unread, and never when it is off', { timeout: 20000 }, async t => {
  const root = home(t);
  let clock = localTime(0, 7, 59);
  const { app, asked } = await openHobkin(t, root, { now: () => clock, catchUp: { daily: '08:00' } });
  const tickAt = async time => {
    clock = time;
    tickCatchUp(root, app);
    await catchUpIdle(root);
    await app.refresh();
  };
  await finishRun(app, 'digest-1', 'Useful: The digest found two invoices.');
  await app.refresh();

  await tickAt(localTime(0, 7, 59));
  assert.equal(asked.length, 0, 'not before its time');
  await tickAt(localTime(0, 8, 0));
  assert.equal(asked.length, 1);
  assert.equal(app.snapshot.reports.find(({ scheduleId }) => scheduleId === 'catch-up').readState, undefined);

  await finishRun(app, 'digest-2', 'Useful: Another invoice came in.');
  await app.refresh();
  await tickAt(localTime(0, 23, 0));
  assert.equal(asked.length, 1, 'once a day');
  await tickAt(localTime(1, 9, 30));
  assert.deepEqual(JSON.parse(asked[1].prompt).reports.map(({ id }) => id), ['digest-2'], 'the next day, what came since');
  await tickAt(localTime(2, 8, 0));
  assert.equal(asked.length, 2, 'nothing uncovered, so nothing to write');

  setCatchUp(root, { daily: null });
  await finishRun(app, 'digest-3', 'Useful: A third invoice came in.');
  await app.refresh();
  await tickAt(localTime(3, 8, 0));
  assert.equal(asked.length, 2, 'turned off');
});

test('a pile-up starts a catch-up when a report finishes and the uncovered count reaches its size, and never a second while one runs', { timeout: 20000 }, async t => {
  const root = home(t);
  const answered = Promise.withResolvers();
  const { app, asked } = await openHobkin(t, root, { answer: () => answered.promise, catchUp: { pileUp: 2 } });
  const finishAndTick = async (...ids) => {
    for (const id of ids) await finishRun(app, id, `Useful: ${id} found something.`);
    await app.refresh();
    tickCatchUp(root, app);
  };

  await finishAndTick('a');
  assert.equal(readCatchUp(root).running, false, 'one uncovered report is under the pile size');
  await finishAndTick('b');
  assert.equal(readCatchUp(root).running, true);
  await until(() => asked.length);
  await finishAndTick('c', 'd');
  answered.resolve({ status: 'completed', text: CATCH_UP_TEXT, cost: null });
  await catchUpIdle(root);
  await app.refresh();
  tickCatchUp(root, app);

  assert.equal(asked.length, 1, 'neither while it ran nor when its own report came in');
  assert.deepEqual(JSON.parse(asked[0].prompt).reports.map(({ id }) => id), ['b', 'a']);
  assert.equal(readCatchUp(root).uncovered, 2);
  setCatchUp(root, { pileUp: null });
  await finishAndTick('e');
  assert.equal(readCatchUp(root).running, false, 'turned off');
});

test('hobkin reports catch-up asks the running hobkin for one on its next tick, or says there is nothing to catch up on', { timeout: 20000 }, async t => {
  const root = home(t);
  const { app, asked } = await openHobkin(t, root);
  const ask = async () => {
    const printed = output();
    assert.equal(await main(['reports', 'catch-up', '--home', root], printed), 0);
    return JSON.parse(printed.text);
  };

  assert.deepEqual(await ask(), { message: 'Nothing to catch up on: every report is read or already in a catch-up.' });
  await app.runner.tick();
  assert.equal(asked.length, 0);

  await finishRun(app, 'digest-1', 'Useful: The digest found two invoices.');
  await app.refresh();
  assert.deepEqual(await ask(), { message: 'Asked hobkin for a catch-up of 1 unread report. It starts within a second while hobkin runs, and shows in Reports when it is done.' });
  await app.runner.tick();
  await catchUpIdle(root);
  await app.runner.tick();

  assert.equal(asked.length, 1, 'one ask, one catch-up');
  const [run] = Object.values((await app.runtime.state()).runs).filter(({ scheduleId }) => scheduleId === 'catch-up');
  assert.equal(run.trigger, 'manual');
});
