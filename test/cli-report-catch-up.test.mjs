import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinApplication } from '../src/cli/application.mjs';
import { readCatchUp, setCatchUp } from '../src/cli/catch-up.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { main } from '../src/cli/main.mjs';
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
 * `answer(request)`, and any other model run fails, as one with no model would.
 */
async function openHobkin(t, root, answer = () => ({ status: 'completed', text: CATCH_UP_TEXT, cost: null })) {
  Telemetry.open(root, STARTED);
  const asked = [];
  const runHarness = async request => {
    if (request.purpose !== 'catch-up') throw Error(`Unexpected ${request.purpose} job.`);
    asked.push(request);
    return answer(request);
  };
  const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, runHarness, intervalMs: 60000 });
  t.after(() => app.close());
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
