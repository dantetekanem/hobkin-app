import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { fileDecision, openDecisions } from '../src/cli/decisions.mjs';
import { createMemoryExtension } from '../src/cli/memory.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';
import { readReport, saveReport } from '../src/cli/reports.mjs';
import { startSession } from '../src/cli/session.mjs';
import { recordSessionEnd, recordSessionStart, sessionsToTell, sessionsToWake } from '../src/cli/session-log.mjs';
import { recordCardAction } from '../src/cli/work/card-actions.mjs';
import { foldFinishedLines, finishedLine } from '../src/cli/work/chat.mjs';
import { chooseProject, fileItem, paths, readItems, readMode, updateItem, writeMode, writeState } from '../src/cli/work/store.mjs';
import { fakePi } from './helpers/pi-session.mjs';
import { repository } from './helpers/work-fixture.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-back-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const fake = fakePi(root);
  const runHarness = async () => { throw Error('No agent runs in this test.'); };
  return { root, fake, openApp: (options = {}) => HobkinApplication.open(root, { createMain: fake.createMain, runHarness, ...options }) };
}

const handoffs = root => join(root, 'runtime', 'handoffs');
const reportOf = (root, name) => join(handoffs(root), `${name}.report.md`);

/** A session as `hobkin session` leaves it: a line when it starts, and the follower's line when it ends. */
function endSession(root, name, title, text, start = {}) {
  const report = reportOf(root, name);
  recordSessionStart(root, { name, title, report, ...start });
  mkdirSync(handoffs(root), { recursive: true });
  if (text !== null) writeFileSync(report, text);
  recordSessionEnd({ name, report });
}

const backgroundRun = (id, details = {}) => ({
  id, kind: 'background', scheduleId: 'work.api.do', title: 'api: Fix login', status: 'completed', work: { slug: 'api', lane: 'do', item: 'abc' },
  startedAt: '2026-01-02T09:00:00.000Z', finishedAt: '2026-01-02T09:01:00.000Z', result: { status: 'completed', text: 'Useful: Fixed the login redirect on hobkin/abc.\n\nDetails.' }, ...details,
});

const chat = view => view.messages.filter(message => message.role === 'notice');

test('a session writes down its title when it starts, so the ending can say it', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-back-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { name, report } = await startSession({ root, title: 'Land the finboard work', cwd: root, brief: 'Go.' });

  const [line] = readFileSync(join(handoffs(root), 'sessions.jsonl'), 'utf8').trim().split('\n').map(text => JSON.parse(text));
  assert.deepEqual([line.name, line.title, line.report], [name, 'Land the finboard work', report]);
});

test('a session that ended tells Chat once, with its title and what happened, and joins Reports', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    endSession(h.root, 'hobkin-land-1', 'Land finboard', '# Report\n\nMerged 3 branches.\nNothing was pushed.\n\nMore detail.');

    await app.refresh();
    const view = await app.refresh();

    const [notice, ...rest] = chat(view);
    assert.equal(rest.length, 0);
    assert.match(notice.content, /^Land finboard: Report Merged 3 branches\./);
    const report = view.reports.find(({ title }) => title === 'Land finboard');
    assert.match(report.body, /More detail/);
    assert.equal(report.outcome, 'completed');
  } finally {
    await app.close();
  }
});

test('a session that stopped with no report says so, and leaves nothing to open', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    endSession(h.root, 'hobkin-quiet-1', 'Quiet one', null);

    const view = await app.refresh();

    assert.match(chat(view)[0].content, /Quiet one stopped without a report/);
    assert.equal(view.reports.some(({ title }) => title === 'Quiet one'), false);
  } finally {
    await app.close();
  }
});

test('a session whose report found nothing new tells Chat nothing and keeps no report, and the main agent still hears it ended', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    endSession(h.root, 'hobkin-look-1a2b', 'Look around', 'Nothing new.\n\nLooked at every branch.');

    await app.refresh();
    const view = await app.refresh();

    assert.deepEqual(chat(view), []);
    assert.equal(view.reports.some(({ title }) => title === 'Look around'), false);
    assert.equal(readReport(h.root, 'session:hobkin-look-1a2b', null), null);
    assert.deepEqual(sessionsToTell(h.root).map(({ said }) => said), ['Nothing new. Looked at every branch.']);
  } finally {
    await app.close();
  }
});

test('a session that ended while hobkin was closed is told at the next open, and once across a restart', async t => {
  const h = fixture(t);
  endSession(h.root, 'hobkin-night-1', 'Overnight', 'Finished the migration branch.');
  let app = await h.openApp();
  try {
    assert.equal(chat(await app.refresh()).filter(({ content }) => /Overnight/.test(content)).length, 1);
  } finally {
    await app.close();
  }

  atomicJson(join(h.root, 'runtime/view.json'), { version: 1, messages: [] });
  app = await h.openApp();
  try {
    assert.equal(chat(await app.refresh()).length, 0, 'it was marked as posted, so even a lost view does not post it again');
    assert.equal((await app.refresh()).reports.filter(({ title }) => title === 'Overnight').length, 1);
  } finally {
    await app.close();
  }
});

test('the main agent hears of a finished session with the next message, once', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    endSession(h.root, 'hobkin-land-2', 'Land finboard', 'Merged 3 branches.');
    const sent = t.mock.method(app.runtime, 'send');

    await app.send('how did that go?');
    await app.send('and now?');

    const [first, second] = sent.mock.calls.map(({ arguments: [text] }) => text);
    assert.match(first, /<hobkin-work>/);
    assert.match(first, /Land finboard/);
    assert.match(first, /Merged 3 branches/);
    assert.match(first, /hobkin-land-2\.report\.md/);
    assert.doesNotMatch(second, /Land finboard/);
    const shown = (await app.refresh()).messages.filter(({ role }) => role === 'user').map(({ content }) => content);
    assert.deepEqual(shown, ['how did that go?', 'and now?']);
  } finally {
    await app.close();
  }
});

test('--wake goes on the record, and only for a session that ends', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-back-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const start = options => startSession({ root, title: 'Prepare teams', cwd: root, brief: 'Go.', ...options });

  await start({ wake: true });

  const [line] = readFileSync(join(handoffs(root), 'sessions.jsonl'), 'utf8').trim().split('\n').map(text => JSON.parse(text));
  assert.equal(line.wake, true);
  await assert.rejects(start({ wake: true, keep: true }), /--wake/);
});

test('a session started with --wake gives the main agent a turn as soon as it ends, and the next message does not tell it again', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    endSession(h.root, 'hobkin-prep-1', 'Prepare teams', 'Prepared 2.7.0 on release-prep/2.7.0.', { wake: true });
    endSession(h.root, 'hobkin-land-3', 'Land finboard', 'Merged 3 branches.');
    const sent = t.mock.method(app.runtime, 'send');

    await app.tickWakes();
    await app.runtime.idle();
    await app.tickWakes();
    await app.send('anything else?');

    const [woken, next, ...rest] = sent.mock.calls.map(({ arguments: [text] }) => text);
    assert.deepEqual(rest, []);
    assert.match(woken, /^<hobkin-wake>\n/);
    assert.match(woken, /Prepared 2\.7\.0/);
    assert.match(woken, /hobkin-prep-1\.report\.md/);
    assert.doesNotMatch(woken, /Land finboard/, 'only a session started with --wake wakes it');
    assert.match(next, /Land finboard/);
    assert.doesNotMatch(next, /Prepare teams/);
    const shown = (await app.refresh()).messages.filter(({ role }) => role === 'user').map(({ content }) => content);
    assert.deepEqual(shown, ['anything else?']);
  } finally {
    await app.close();
  }
});

test('a failed session wakes the parent with the original brief; admitting that wake is not completing it', async t => {
  const h = fixture(t);
  let now = Date.now();
  const target = join(h.root, 'verified.txt');
  const original = `Write ${target} and verify its exact value is ready.`;
  const app = await h.openApp({ intervalMs: 60000, now: () => now, runHarness: async ({ prompt }) => {
    const { task } = JSON.parse(prompt);
    const brief = readFileSync(task.slice('Read '.length, -' and follow it.'.length), 'utf8');
    assert.ok(brief.startsWith(original));
    if (!brief.includes('Resume from the failed first attempt.')) return { status: 'failed', text: 'Queued a plan; the file is missing.' };
    writeFileSync(target, 'ready');
    return { status: 'completed', text: `Verified ${readFileSync(target, 'utf8')}.` };
  } });
  t.after(() => app.close());
  const first = await startSession({ root: h.root, title: 'Verify outcome', brief: original, cwd: h.root, wake: true, tier: 'mid' });
  await app.tickSessions();
  const control = h.fake.controls.get(h.fake.opened.at(-1));
  control.started = Promise.withResolvers();
  control.gate = Promise.withResolvers();
  const wake = app.tickWakes();
  await control.started.promise;
  const during = sessionsToWake(h.root).length;
  control.gate.reject(Error('Provider failed after admission'));
  await wake;
  await app.runtime.mainWork;
  assert.equal(during, 1);
  assert.equal(sessionsToWake(h.root).length, 1, 'the failed parent turn remains due');
  const due = sessionsToWake(h.root)[0];
  assert.deepEqual([due.name, due.outcome, due.cwd, due.tier], [first.name, 'failed', h.root, 'mid']);
  assert.ok(readFileSync(due.brief, 'utf8').startsWith(original));

  control.gate = undefined;
  const main = mainSession(h);
  const prompt = main.prompt.bind(main);
  let successor;
  main.prompt = async (text, options) => {
    const ended = JSON.parse(text.split('\n')[1]).sessions[0];
    if (ended.name === first.name) {
      const brief = readFileSync(ended.brief, 'utf8').split('\n\n## When you finish')[0];
      successor = await startSession({ root: h.root, title: ended.title, cwd: ended.cwd, tier: ended.tier, wake: true,
        brief: `${brief}\nResume from the failed first attempt.` });
    }
    return prompt(text, options);
  };
  await app.tickWakes();
  assert.equal(successor, undefined, 'a failed wake backs off rather than spinning');
  now += 5 * 60000;
  await app.tickWakes();
  await app.tickSessions();
  assert.equal(readFileSync(target, 'utf8'), 'ready');
  assert.equal((await app.runtime.state()).runs[`session:${successor.name}`].status, 'completed');
  await app.tickWakes();
  await app.tickWakes();
  assert.deepEqual(sessionsToWake(h.root), []);
  assert.equal(Object.values((await app.runtime.state()).runs).filter(run => run.session).length, 2);
});

test('work the user chose that work mode cannot start goes to the main agent once, as a turn of its own', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    const send = app.runtime.send.bind(app.runtime);
    app.handOff({ project: 'finboard', item: 'abc123', title: 'Browse older payment installments', branch: 'hobkin/abc123', asked: 'Refresh it.', why: 'work mode is off' });
    app.runtime.send = async () => { throw Error('Wake was not admitted'); };
    await app.tickWakes();
    app.runtime.send = send;
    const sent = t.mock.method(app.runtime, 'send');

    await app.tickWakes();
    await app.runtime.idle();
    await app.tickWakes();

    const woken = sent.mock.calls.map(({ arguments: [text] }) => text);
    assert.equal(woken.length, 1);
    assert.match(woken[0], /^<hobkin-wake>\n\{"handOff":\[/);
    assert.match(woken[0], /Browse older payment installments/);
  } finally {
    await app.close();
  }
});

const mainSession = h => h.fake.sessions.get(h.fake.opened.at(-1));

/** One run of a command the main agent scheduled, as the scheduler posts it into the conversation. */
function scheduledRun(h, code, task = { id: 'task_wait', name: 'Wait for the report' }, command = "test -s '/tmp/prep.report.md'") {
  return mainSession(h).sendCustomMessage({
    customType: 'scheduled-task',
    content: `Scheduled command ${task.id} finished with exit code ${code}: ${command}`,
    display: true,
    details: { task, result: { ok: code === 0, code, killed: false, command, stdout: '', stderr: code ? 'not there yet' : '' } },
  }, { triggerTurn: false });
}

test('a scheduled command that fails wakes the main agent once to fix it, and a run that worked stays out of Chat', async t => {
  const h = fixture(t);
  let app = await h.openApp();
  try {
    const sent = t.mock.method(app.runtime, 'send');
    await scheduledRun(h, 1);
    await scheduledRun(h, 1);
    await scheduledRun(h, 0, { id: 'task_ci', name: 'Watch CI' }, 'gh run view 1');

    await app.tickWakes();
    await app.runtime.idle();
    await app.tickWakes();

    const woken = sent.mock.calls.map(({ arguments: [text] }) => text);
    assert.equal(woken.length, 1, 'the same failure is told once');
    assert.match(woken[0], /^<hobkin-wake>\n/);
    assert.match(woken[0], /task_wait/);
    assert.match(woken[0], /not there yet/);
    assert.doesNotMatch(woken[0], /task_ci/);
    const lines = (await app.refresh()).messages.filter(({ role }) => role === 'custom').map(({ content }) => content);
    assert.ok(lines.some(line => /task_wait finished with exit code 1/.test(line)), 'a failure stays in sight');
    assert.equal(lines.some(line => /exit code 0/.test(line)), false, 'a run that worked says nothing');
  } finally {
    await app.close();
  }

  app = await h.openApp();
  try {
    const sent = t.mock.method(app.runtime, 'send');
    await app.tickWakes();
    assert.equal(sent.mock.callCount(), 0, 'a failure from before this open was told already');
  } finally {
    await app.close();
  }
});

test('a work run gets one quiet line from its Useful line, a look with nothing new stays silent, and Critical works as it did', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    await app.runtime.change(state => {
      state.runs.done = backgroundRun('done');
      state.runs.look = backgroundRun('look', { title: 'api: security', result: { status: 'completed', text: 'Nothing new.\n\nLooked.' } });
      state.runs.hot = backgroundRun('hot', { title: 'web: Keys', finishedAt: '2026-01-02T09:02:00.000Z', result: { status: 'completed', text: 'Critical: A secret leaked.\n\nDetails.' } });
    });

    const notices = chat(await app.refresh());

    assert.deepEqual(notices.map(({ content, tone }) => [content, tone]), [
      ['api: Fix login: Fixed the login redirect on hobkin/abc.', 'quiet'],
      ['web: Keys: A secret leaked.', 'critical'],
    ]);
  } finally {
    await app.close();
  }
});

test('a run of finished lines folds into one that keeps the newest and counts the rest', () => {
  const line = index => finishedLine(`notice:report:${index}`, `api: ${index}`, 'Done.', `2026-01-02T09:0${index}:00.000Z`);
  const said = { id: 'user', role: 'user', content: 'hello' };

  const first = foldFinishedLines([line(1), line(2), said, line(3), line(4)]);
  const again = foldFinishedLines([...first, line(5)]);

  assert.deepEqual(first.map(({ id }) => id), ['notice:report:2', 'user', 'notice:report:4']);
  assert.match(first[0].content, /^api: 2: Done\. 1 more/);
  assert.match(again.at(-1).content, /^api: 5: Done\. 2 more/);
});

test('a busy day of finished runs never pushes the conversation out of Chat', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    await app.send('Keep this one');
    const user = app.runtime.messages().findLast(({ role }) => role === 'user');
    await app.runtime.change(state => {
      for (let index = 0; index < 150; index++) {
        const id = `run-${index}`;
        state.runs[id] = backgroundRun(id, { finishedAt: new Date(user.timestamp + 60000 + index * 1000).toISOString() });
      }
    });

    const view = await app.refresh();

    assert.ok(view.messages.some(({ role, content }) => role === 'user' && /Keep this one/.test(content)));
    assert.equal(chat(view).length, 1);
    assert.match(chat(view)[0].content, /149 more finished/);
    assert.equal(view.reports.filter(({ scheduleId }) => scheduleId === 'work.api.do').length, 150);
  } finally {
    await app.close();
  }
});

test('Reports lists every report, however many there are', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    await app.runtime.change(state => {
      for (let index = 0; index < 230; index++) {
        const finishedAt = new Date(Date.parse('2026-01-02T09:00:00.000Z') + index * 60000).toISOString();
        const { work, ...routineRun } = backgroundRun(`run-${index}`, { scheduleId: 'digest', title: `Digest ${index}`, finishedAt });
        state.runs[`run-${index}`] = routineRun;
      }
    });

    const { reports } = await app.refresh();

    assert.ok(reports.length >= 230, `${reports.length} reports listed`);
  } finally {
    await app.close();
  }
});

test('a session line is not folded away by the runs around it', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    await app.runtime.change(state => { state.runs.first = backgroundRun('first', { finishedAt: new Date(Date.now() - 2000).toISOString() }); });
    await app.refresh();
    endSession(h.root, 'hobkin-middle', 'Middle', 'Did it.');
    await app.refresh();
    await app.runtime.change(state => { state.runs.last = backgroundRun('last', { finishedAt: new Date(Date.now() + 2000).toISOString() }); });

    const notices = chat(await app.refresh());

    assert.equal(notices.length, 3);
    assert.match(notices[1].content, /^Middle: Did it\./);
  } finally {
    await app.close();
  }
});

/** A chosen project with a pile of finished rows, each proved and read by the last survey, and nothing else to do. */
function pile(root, count) {
  chooseProject(root, '/repos/api', 'important');
  const open = [];
  for (let index = 0; index < count; index++) {
    const branch = `hobkin/${index}`;
    const { id } = fileItem(root, 'api', { key: `row ${index}`, kind: 'fix', title: `Row ${index}`, brief: 'The first change.' });
    updateItem(root, 'api', id, { state: 'branch', branch, proof: 'It failed, then it passed.' });
    open.push({ kind: 'branch', branch, sha: `sha-${index}`, conflict: false, size: { additions: 1, deletions: 0, files: 1 } });
  }
  atomicJson(join(root, 'work', 'unmerged.json'), { at: new Date().toISOString(), projects: { api: { lastMergeAt: null, trees: 0, open } } });
}

test('/work with a pile says the count, and the first pair waits in Action Items before anything starts', async t => {
  const h = fixture(t);
  pile(h.root, 46);
  writeMode(h.root, { folder: h.root });
  const app = await h.openApp();
  try {
    await app.workAction('toggle');

    const view = await app.refresh();

    assert.equal(view.work.shipFirst.pile, 46);
    assert.ok(view.work.plan.every(({ waiting }) => waiting === 'shipping first'));
    assert.deepEqual(openDecisions(h.root).map(({ key }) => key), ['pair']);
    assert.equal(chat(view).filter(({ content }) => /Shipping first/.test(content)).length, 0, 'the reply to /work says it, so Chat does not say it again');
  } finally {
    await app.close();
  }
});

test('read opens Done, and go reports in Chat what it did', async t => {
  const h = fixture(t);
  pile(h.root, 9);
  writeMode(h.root, { enabled: true, folder: h.root });
  const showDone = t.mock.fn();
  const app = await h.openApp({ showDone });
  try {
    await app.director.tick();
    const [{ id }] = openDecisions(h.root);
    await app.workAction('decide', id, 'read');
    assert.equal(showDone.mock.callCount(), 1);

    writeMode(h.root, { ship: { ...readMode(h.root).ship, last: null } });
    await app.director.tick();
    const [next] = openDecisions(h.root);
    const { message } = await app.workAction('decide', next.id, 'go');

    assert.match(message, /Row 0/);
    assert.equal(chat(await app.refresh()).filter(({ content }) => /Row 0/.test(content)).length, 1);
  } finally {
    await app.close();
  }
});

test('the main agent is told the pile plainly', async t => {
  const h = fixture(t);
  pile(h.root, 9);
  writeMode(h.root, { enabled: true, folder: h.root });
  const app = await h.openApp();
  try {
    const sent = t.mock.method(app.runtime, 'send');

    await app.send('why is nothing starting?');

    assert.match(sent.mock.calls[0].arguments[0], /Shipping first: 9 finished and waiting/);
  } finally {
    await app.close();
  }
});

const systemLines = view => view.messages.filter(message => message.role === 'system');
const cards = view => view.waiting.branches;
const noteOf = text => JSON.parse(text.match(/^<hobkin-work>\n(.*)\n<\/hobkin-work>\n\n/)?.[1] ?? '{}');

test('what the user does from a card is said in Chat as a system line, and it stays there across a restart', async t => {
  const h = fixture(t);
  pile(h.root, 1);
  const [{ id }] = readItems(h.root, 'api');
  let app = await h.openApp();
  try {
    await assert.rejects(app.workAction('decline', 'api', 'zzz'), /Unknown item/);
    await app.workAction('decline', 'api', id);
    await app.refresh();

    const lines = systemLines(await app.refresh());

    assert.equal(lines.length, 1, 'a failed action says nothing in Chat, and the line is said once');
    assert.match(lines[0].content, /^Said no to "Row 0" on api\./);
  } finally {
    await app.close();
  }

  app = await h.openApp();
  try {
    assert.equal(systemLines(await app.refresh()).length, 1);
  } finally {
    await app.close();
  }

  atomicJson(join(h.root, 'runtime/view.json'), { version: 1, messages: [] });
  app = await h.openApp();
  try {
    assert.equal(systemLines(await app.refresh()).length, 0, 'it was said once, so even a lost view does not say it again');
  } finally {
    await app.close();
  }
});

/** gh as a host that merges what it is asked to: the merge ends well, and a read after it says merged, with its merge commit. */
const MERGED_VIEW = JSON.stringify({ state: 'MERGED', mergedAt: '2026-06-01T12:00:00Z', mergeCommit: { oid: 'c'.repeat(40) } });
// Its open PRs, one for each row these tests make, so an item's own address is the one open on its branch.
const OPEN_PRS = JSON.stringify([0, 1, 2, 3].map(number => ({ url: `https://example.com/pull/${number}` })));
const mergingHost = async ([, verb]) => {
  if (verb === 'list') return OPEN_PRS;
  return verb === 'view' ? MERGED_VIEW : '';
};

test('a PR merged from its card leaves Decisions at once, and Chat says which one with its link', async t => {
  const h = fixture(t);
  pile(h.root, 1);
  const [{ id }] = readItems(h.root, 'api');
  updateItem(h.root, 'api', id, { state: 'pr', pr: 'https://example.com/pull/1' });
  const app = await h.openApp();
  try {
    assert.equal(cards(await app.refresh()).length, 1);

    await app.workAction('mergePr', 'api', id, { head: 'abc1234', gh: mergingHost });
    const view = await app.refresh();

    assert.deepEqual(cards(view), []);
    assert.match(systemLines(view)[0].content, /^Merged the PR for "Row 0" on api: https:\/\/example\.com\/pull\/1\.$/);
  } finally {
    await app.close();
  }
});

test('the main agent hears what the user did from a card with the next message, once, even across a restart', async t => {
  const h = fixture(t);
  pile(h.root, 2);
  const [first, second] = readItems(h.root, 'api');
  updateItem(h.root, 'api', second.id, { state: 'pr', pr: 'https://example.com/pull/2' });
  let app = await h.openApp();
  try {
    await app.workAction('done', 'api', first.id);
    await app.workAction('mergePr', 'api', second.id, { gh: mergingHost });
    const sent = t.mock.method(app.runtime, 'send');

    await app.send('what did I just do?');
    await app.send('anything else?');

    const [heard, heardAgain] = sent.mock.calls.map(({ arguments: [text] }) => noteOf(text).userDid);
    assert.deepEqual(heard.map(({ did, project, item, title, pr }) => [did, project, item, title, pr]), [
      ['marked it done', 'api', first.id, 'Row 0', undefined],
      ['merged the PR', 'api', second.id, 'Row 1', 'https://example.com/pull/2'],
    ]);
    assert.ok(heard.every(({ at }) => Number.isFinite(Date.parse(at))));
    assert.equal(heardAgain, undefined);
  } finally {
    await app.close();
  }

  app = await h.openApp();
  try {
    const sent = t.mock.method(app.runtime, 'send');
    await app.send('and now?');
    assert.equal(noteOf(sent.mock.calls[0].arguments[0]).userDid, undefined);
  } finally {
    await app.close();
  }
});

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const decidedPart = root => {
  let handler;
  createMemoryExtension(root)({ on: (_event, run) => { handler = run; } });
  const prompt = handler({ systemPrompt: '' }).systemPrompt;
  return prompt.slice(prompt.indexOf('## What the user decided lately'));
};

test('what the user decided lately comes from their own answers on every turn, and a card still reaches the work note once', async t => {
  const h = fixture(t);
  pile(h.root, 1);
  const [{ id: item }] = readItems(h.root, 'api');
  let askTool;
  const app = await h.openApp({
    askQuestion: async () => 'wait',
    createMain: options => openPiSession(options, {
      ...h.fake.dependencies,
      createSession: session => {
        askTool = session.customTools.find(tool => tool.name === 'ask_question');
        return h.fake.dependencies.createSession(session);
      },
    }),
  });
  try {
    const { id } = fileDecision(h.root, {
      from: 'Routine gym-check',
      question: 'Cancel the gym membership?',
      choices: [{ value: 'keep', label: 'Keep it' }, { value: 'cancel', label: 'Cancel it' }],
      answerTo: { kind: 'routine', id: 'gym-check' },
    });
    await app.workAction('decide', id, 'keep');
    await pause(5);
    await app.workAction('decline', 'api', item);
    await pause(5);
    await askTool.execute('q', {
      question: 'Restore the backup now or wait for Monday?',
      choices: [{ value: 'now', label: 'Restore now' }, { value: 'wait', label: 'Wait for Monday' }],
    });

    const part = decidedPart(h.root);
    const places = ['Wait for Monday', 'Row 0', 'Keep it'].map(words => part.indexOf(words));
    assert.ok(places.every(place => place > 0), part);
    assert.deepEqual(places, places.toSorted((left, right) => left - right), 'newest first');
    for (const shown of [item, id]) assert.ok(!part.includes(shown), shown);

    const sent = t.mock.method(app.runtime, 'send');
    await app.send('what did I just do?');
    await app.send('anything else?');
    const [heard, heardAgain] = sent.mock.calls.map(({ arguments: [text] }) => noteOf(text).userDid);
    assert.deepEqual(heard.map(({ did, title }) => [did, title]), [['said no', 'Row 0']]);
    assert.equal(heardAgain, undefined);
    assert.ok(decidedPart(h.root).includes('Row 0'), 'the part keeps it after the note has said it');
  } finally {
    await app.close();
  }
});

test('a stop says so in Chat once, and the main agent hears it with the next message', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    const control = h.fake.controls.get(app.runtime.main.sessionId);
    control.gate = Promise.withResolvers();
    const { id } = await app.send('Look through every report');
    const queuedWithNote = '<hobkin-work>\n{"commands":{}}\n</hobkin-work>\n\nand the old ones';
    app.runtime.main.clearQueue = () => ({ steering: [queuedWithNote], followUp: [] });

    assert.deepEqual(await app.interrupt(), ['and the old ones'], 'what never reached the agent goes back as the user typed it');

    assert.equal((await app.runtime.state()).runs[id].status, 'interrupted');
    assert.equal(app.snapshot.busy, false);
    assert.deepEqual(systemLines(app.snapshot).map(({ content }) => content), ['You stopped hobkin.']);
    assert.equal(await app.interrupt(), null, 'with nothing running, nothing stops and nothing is said');

    // The fake Pi stays aborted until it is told to take turns again.
    Object.assign(control, { gate: null, aborted: false });
    const sent = t.mock.method(app.runtime, 'send');
    await app.send('do something else');

    assert.deepEqual(noteOf(sent.mock.calls[0].arguments[0]).userDid.map(({ did }) => did), ['stopped your turn']);
    assert.equal(systemLines(await app.refresh()).length, 1);
  } finally {
    await app.close();
  }
});

/** A real repository with one item to do and work mode on, so hobkin's own director starts an agent on it. */
function workingOn(t, root) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-back-repo-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  chooseProject(root, repository(base, 'api'), 'important');
  const now = new Date().toISOString();
  mkdirSync(paths(root, 'api').directory, { recursive: true });
  writeFileSync(paths(root, 'api').project, '# What it is\n');
  writeState(root, 'api', { lastLookAt: now, lastLensAt: now, lastIdeasAt: now, lastSignalsAt: now });
  atomicJson(join(root, 'work', 'unmerged.json'), { at: now, projects: {} });
  writeMode(root, { enabled: true, startGapMs: 0, lastDiscoveryAt: now });
  return fileItem(root, 'api', { key: 'fix login', kind: 'fix', title: 'Fix login', brief: 'The first change.' });
}

const untilStopped = request => new Promise(resolve => {
  const stop = () => resolve({ status: 'interrupted', error: 'Harness cancelled.' });
  if (request.signal.aborted) stop();
  else request.signal.addEventListener('abort', stop, { once: true });
});

/** The item's agent at work, once hobkin has started `count` agents. */
async function agentAtWork(app, started, count) {
  while (started.length < count) await new Promise(resolve => setTimeout(resolve, 10));
  return app.director.running().find(({ lane }) => lane === 'do');
}

async function runsEnded(app) {
  await Promise.all([...app.runner.jobs.values()]);
  await app.director.closing;
}

test('an agent stopped from the screen says how in Chat, and the main agent hears it with the next message', async t => {
  const h = fixture(t);
  const filed = workingOn(t, h.root);
  const key = `item:api:${filed.id}`;
  const started = [];
  const runHarness = request => {
    started.push(request);
    return untilStopped(request);
  };
  const app = await h.openApp({ runHarness });
  try {
    await app.workAction('stop', (await agentAtWork(app, started, 1)).id, 'later');
    await runsEnded(app);
    assert.deepEqual(readMode(h.root).queueSkipped, [key], 'stopped for now, it waits at the end of the queue');

    await app.workAction('back', key);
    await app.workAction('stop', (await agentAtWork(app, started, 2)).id, 'decline');
    await runsEnded(app);

    assert.equal(readItems(h.root, 'api')[0].state, 'declined');
    assert.deepEqual(systemLines(await app.refresh()).map(({ content }) => content), [
      'Stopped "Fix login" on api for now; it waits at the end of the queue.',
      'Stopped "Fix login" on api: not approved, so it will not run again.',
    ]);
    const sent = t.mock.method(app.runtime, 'send');
    await app.send('i stopped it');
    assert.deepEqual(noteOf(sent.mock.calls[0].arguments[0]).userDid.map(({ did, title }) => [did, title]), [
      ['stopped it for now', 'Fix login'],
      ['stopped it: not approved', 'Fix login'],
    ]);
  } finally {
    await app.close();
  }
});

test('the main agent hears ten things the user did at a time, and the rest with the next message', async t => {
  const h = fixture(t);
  for (let index = 0; index < 12; index++) {
    recordCardAction(h.root, { did: 'said no', project: 'api', item: `item${index}`, title: `Row ${index}`, line: `Said no to "Row ${index}" on api.` });
  }
  const app = await h.openApp();
  try {
    const sent = t.mock.method(app.runtime, 'send');

    await app.send('first');
    await app.send('second');

    const [first, second] = sent.mock.calls.map(({ arguments: [text] }) => noteOf(text).userDid.map(({ title }) => title));
    assert.equal(first.length, 10);
    assert.deepEqual(second, ['Row 10', 'Row 11']);
  } finally {
    await app.close();
  }
});

test('a group answered at once says each row in Chat and one line that sums it up, and the main agent hears each row once', async t => {
  const h = fixture(t);
  pile(h.root, 3);
  const rows = readItems(h.root, 'api').map(({ id }, index) => {
    updateItem(h.root, 'api', id, { state: 'pr', pr: `https://example.com/pull/${index}` });
    return { slug: 'api', item: id, head: `abc${index}`, how: 'mergePr' };
  });
  const gh = async ([, verb, url]) => {
    if (verb === 'merge' && url.endsWith('/1')) throw Object.assign(Error('failed'), { stderr: 'Head branch was modified.' });
    return mergingHost([, verb]);
  };
  const app = await h.openApp();
  try {
    await app.workAction('group', rows, { gh });
    const lines = systemLines(await app.refresh()).map(({ content }) => content);

    assert.equal(lines.length, 4);
    assert.match(lines[0], /^Merged the PR for "Row 0" on api/);
    assert.equal(lines[1], '"Row 1" on api did not merge: Head branch was modified.');
    assert.match(lines[2], /^Merged the PR for "Row 2" on api/);
    assert.match(lines[3], /^Merged 2 of 3\b/);

    const sent = t.mock.method(app.runtime, 'send');
    await app.send('what happened?');
    const heard = noteOf(sent.mock.calls[0].arguments[0]).userDid.map(({ did, title }) => [did, title]);
    assert.deepEqual(heard, [['merged the PR', 'Row 0'], ['could not merge it', 'Row 1'], ['merged the PR', 'Row 2']]);
  } finally {
    await app.close();
  }
});

test('what a run left in the user\'s own folder is said in Chat once, as a system line', async t => {
  const h = fixture(t);
  const at = new Date().toISOString();
  const line = 'api\'s folder stays on the branch for "fix", because it has uncommitted changes. Nothing in it was changed.';
  writeMode(h.root, { folderLines: [{ key: `folder:api:${at}`, line, at }] });
  const app = await h.openApp();
  try {
    assert.deepEqual(systemLines(await app.refresh()).map(({ content }) => content), [line]);
    assert.equal(systemLines(await app.refresh()).length, 1, 'once');
  } finally {
    await app.close();
  }
});

test('a deleted session report stays deleted', async t => {
  const h = fixture(t);
  saveReport(h.root, 'session:hobkin-gone', 'Gone.');
  endSession(h.root, 'hobkin-gone', 'Gone', 'Gone.');
  writeFileSync(join(h.root, 'runtime', 'deleted-reports.json'), JSON.stringify({ version: 1, ids: ['session:hobkin-gone'] }), { mode: 0o600 });
  const app = await h.openApp();
  try {
    assert.equal((await app.refresh()).reports.some(({ title }) => title === 'Gone'), false);
  } finally {
    await app.close();
  }
});

test('Continue goes on after a turn the user stopped, as their own word, and only then', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    assert.equal(app.snapshot.mainStopped, null);
    await assert.rejects(app.continueStopped(), /Nothing to continue/);

    const control = h.fake.controls.get(app.runtime.main.sessionId);
    control.gate = Promise.withResolvers();
    const { id } = await app.send('Look through every report');
    app.runtime.main.clearQueue = () => ({ steering: [], followUp: [] });
    await app.interrupt();
    assert.equal(app.snapshot.mainStopped, id, 'the stopped turn is the one to continue');

    // Pi cannot resume a stopped run, so the word goes as the user would type it, with the news that they stopped it.
    Object.assign(control, { gate: null, aborted: false });
    const sent = t.mock.method(app.runtime, 'send');
    const continued = await app.continueStopped({ sentAt: Date.now() });
    const [words] = sent.mock.calls[0].arguments;
    assert.ok(words.endsWith('\n\nContinue'), words);
    assert.deepEqual(noteOf(words).userDid.map(({ did }) => did), ['stopped your turn']);
    assert.notEqual(continued.id, id);

    await app.runtime.idle();
    assert.equal((await app.refresh()).mainStopped, null, 'a turn has started since');
    await assert.rejects(app.continueStopped(), /Nothing to continue/);
  } finally {
    await app.close();
  }
});

test('Chat keeps the conversation in the order the model read it, and puts each line by its time', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    const at = iso => Date.parse(`2026-01-02T08:00:${iso}Z`);
    const reply = (text, second) => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', timestamp: at(second) });
    // A message queued for a turn keeps the time it was sent, and the model reads it once the reply before it ends.
    t.mock.method(app.runtime, 'messages', () => [
      { role: 'user', content: 'Plan the week', timestamp: at('00') },
      reply('Here is a plan', '10'),
      { role: 'user', content: 'Then sum it up', timestamp: at('05') },
      reply('In short', '20'),
    ]);
    recordCardAction(h.root, { id: 'between', did: 'did something', line: 'A line between the replies.' }, at('15'));

    const said = (await app.refresh()).messages.map(({ role, content }) => `${role}: ${content}`);
    assert.deepEqual(said, ['user: Plan the week', 'assistant: Here is a plan', 'user: Then sum it up', 'system: A line between the replies.', 'assistant: In short']);
  } finally {
    await app.close();
  }
});
