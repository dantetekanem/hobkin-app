import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { fileDecision } from '../src/cli/decisions.mjs';
import { readEvents } from '../src/cli/events.mjs';
import { main } from '../src/cli/main.mjs';
import { createDashboard } from '../src/cli/ui.mjs';
import { chooseProject, fileItem, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { fakePi } from './helpers/pi-session.mjs';
import { branched, repository } from './helpers/work-fixture.mjs';

// Inside Herdr, opening an app or a diff starts and closes real panes in front of the user, so this file must never look like it is in there.
for (const name of Object.keys(process.env).filter(key => key.startsWith('HERDR_'))) delete process.env[name];

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-recording-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const fake = fakePi(root);
  return {
    root,
    fake,
    openApp: (options = {}) => HobkinApplication.open(root, { createMain: fake.createMain, ...options }),
    ofType: type => readEvents(root).filter(event => event.type === type),
    written: () => readdirSync(join(root, 'runtime', 'events')).map(name => readFileSync(join(root, 'runtime', 'events', name), 'utf8')).join(''),
  };
}

const background = (id, overrides = {}) => ({
  id,
  kind: 'background',
  scheduleId: id,
  title: `Title of ${id}`,
  status: 'completed',
  startedAt: '2026-01-02T08:00:00.000Z',
  finishedAt: '2026-01-02T08:01:00.000Z',
  result: { status: 'completed', text: 'Useful: A private finding about the user.' },
  ...overrides,
});

test('the app says when it opened and closed', async t => {
  const h = fixture(t);
  const app = await h.openApp();

  await app.close();

  assert.equal(h.ofType('app_opened').length, 1);
  assert.ok(h.ofType('app_closed')[0].ms >= 0);
});

test('a main turn records how long it took and why it stopped, and none of its words', async t => {
  const h = fixture(t);
  const app = await h.openApp();

  await app.send('a very private sentence');
  await app.runtime.idle();
  await app.close();

  const [started] = h.ofType('turn_started');
  const [finished] = h.ofType('turn_finished');
  assert.equal(finished.id, started.id);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.stopReason, 'stop');
  assert.ok(finished.ms >= 0);
  assert.doesNotMatch(h.written(), /private sentence/);
});

test('a run records what it was, how it ended and what it cost, and none of its report', async t => {
  const h = fixture(t);
  const app = await h.openApp({ runHarness: async () => { throw Error('No provider in this test.'); } });
  app.runtime.editReport = null;
  const work = { slug: 'site', lane: 'do', item: 'abc123' };

  await app.runtime.dispatch(
    { id: 'work:site:do:1', kind: 'background', scheduleId: 'work.site.do', title: 'Private item title', harness: 'pi', work },
    async () => ({ status: 'completed', text: 'Critical: a private finding.', cost: { usd: 0.5 }, tokens: 1200 }),
  );
  await app.close();

  const [started] = h.ofType('run_started');
  assert.deepEqual({ ...started, at: null }, { at: null, type: 'run_started', id: 'work:site:do:1', kind: 'background', lane: 'do', routine: 'work.site.do', project: 'site', item: 'abc123' });
  const [finished] = h.ofType('run_finished');
  assert.deepEqual(
    [finished.lane, finished.routine, finished.project, finished.status, finished.usd, finished.tokens, finished.triage],
    ['do', 'work.site.do', 'site', 'completed', 0.5, 1200, 'critical'],
  );
  assert.ok(finished.ms >= 0);
  assert.doesNotMatch(h.written(), /private/);
});

test('a run left running by a crash is recorded when the next owner finds it', async t => {
  const h = fixture(t);
  const first = await h.openApp();
  const { finishedAt, result, ...left } = background('left');
  await first.runtime.change(state => { state.runs.left = { ...left, status: 'running' }; });
  await first.close();

  const second = await h.openApp();
  await second.close();

  assert.deepEqual(h.ofType('run_finished').map(({ id, status }) => [id, status]), [['left', 'interrupted']]);
});

test('a notice posted to Chat records its tone and source once, and none of its words', async t => {
  const h = fixture(t);
  const app = await h.openApp();

  await app.runtime.change(state => { state.runs.useful = background('useful'); });
  await app.refresh();
  await app.refresh();
  await app.close();

  assert.deepEqual(h.ofType('notice_posted').map(({ tone, source }) => [tone, source]), [['useful', 'report']]);
  assert.doesNotMatch(h.written(), /private finding/);
});

test('a decision records where it came from and how long the answer took, and none of its question', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  const asked = { key: 'once', from: 'Routine digest', question: 'A private question?', choices: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], answerTo: { kind: 'routine', id: 'digest' } };

  const { id } = fileDecision(h.root, asked);
  fileDecision(h.root, asked);
  await app.workAction('decide', id, 'yes');
  await app.close();

  assert.deepEqual(h.ofType('decision_filed').map(event => [event.id, event.source]), [[id, 'routine']]);
  const [answered] = h.ofType('decision_answered');
  assert.deepEqual([answered.id, answered.source], [id, 'routine']);
  assert.ok(answered.ms >= 0);
  assert.doesNotMatch(h.written(), /private question/i);
});

test('a report read or messaged about is recorded by its id', async t => {
  const h = fixture(t);
  const app = await h.openApp();

  app.recordReportRead({ id: 'one', dwellMs: 4000 });
  await app.send('what a private reply', { id: 'two', title: 'A report', body: 'Its private body.' });
  await app.runtime.idle();
  await app.close();

  assert.deepEqual(h.ofType('report_read').map(({ id, ms }) => [id, ms]), [['one', 4000]]);
  assert.deepEqual(h.ofType('report_messaged').map(({ id }) => id), ['two']);
  assert.doesNotMatch(h.written(), /private/);
});

test('in the Done walk, what the user did with a branch is recorded, and what fails is not', async t => {
  const h = fixture(t);
  const checkout = repository(h.root, 'api');
  const { slug } = chooseProject(h.root, checkout, 'important');
  const file = title => {
    const { id } = fileItem(h.root, slug, { key: title, kind: 'fix', title, brief: 'Evidence and first change.' });
    branched(checkout, `hobkin/${title}`);
    updateItem(h.root, slug, id, { state: 'branch', branch: `hobkin/${title}` });
    return id;
  };
  const app = await h.openApp();

  const merged = file('one');
  const declined = file('two');
  const sentBack = file('three');
  await app.workAction('merge', slug, merged);
  await app.workAction('decline', slug, declined);
  await app.workAction('ask', slug, sentBack, 'a private note');
  await app.workAction('diff', slug, sentBack);
  await assert.rejects(app.workAction('merge', slug, 'missing'));
  await app.close();

  assert.deepEqual(h.ofType('done_merged').map(event => [event.project, event.item]), [[slug, merged]]);
  assert.deepEqual(h.ofType('done_declined').map(event => event.item), [declined]);
  assert.deepEqual(h.ofType('done_sent_back').map(event => event.item), [sentBack]);
  assert.deepEqual(h.ofType('done_diff').map(event => event.item), [sentBack]);
  assert.doesNotMatch(h.written(), /private note/);
});

test('work mode pausing and resuming records the kind of pause', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  writeMode(h.root, { enabled: true, pausedAt: new Date().toISOString() });

  await app.refresh();
  await app.refresh();
  writeMode(h.root, { pausedAt: null });
  await app.refresh();
  await app.close();

  assert.deepEqual(h.ofType('work_paused').map(({ pause }) => pause), ['hand']);
  assert.deepEqual(h.ofType('work_resumed').map(({ pause }) => pause), ['hand']);
});

test('compaction records its start, and how it ended and how long it took', async t => {
  const h = fixture(t);
  let tell;
  const app = await h.openApp({
    createMain: async options => {
      const session = await h.fake.createMain(options);
      const { subscribe } = session;
      session.subscribe = listener => {
        tell = listener;
        return subscribe.call(session, listener);
      };
      return session;
    },
  });

  tell({ type: 'compaction_start', reason: 'threshold' });
  tell({ type: 'compaction_end', reason: 'threshold', aborted: false });
  await app.close();

  assert.deepEqual(h.ofType('compaction_started').map(({ reason }) => reason), ['threshold']);
  const [finished] = h.ofType('compaction_finished');
  assert.deepEqual([finished.reason, finished.status], ['threshold', 'completed']);
  assert.ok(finished.ms >= 0);
});

test('a stopped main chat reaches the screen as an error from main, with none of its text', async t => {
  const h = fixture(t);
  const app = await h.openApp();

  app.runtime.mainFault = Error('A private failure.');
  await app.refresh();
  await app.refresh();
  app.runtime.mainFault = null;
  await app.close();

  assert.deepEqual(h.ofType('error_shown').map(({ from }) => from), ['main']);
  assert.doesNotMatch(h.written(), /private failure/);
});

const dashboard = (snapshot = {}, handlers = {}, options = {}) => {
  const seen = [];
  const ui = createDashboard({
    config: { main: {}, background: { harness: 'pi', model: null, effort: 'medium' } },
    counts: { daily: 0, weekly: 0, monthly: 0 },
    schedules: [],
    reports: [],
    messages: [],
    connection: 'connected',
    runs: [],
    usage: null,
    ...snapshot,
  }, { ...handlers, event: (type, facts) => seen.push({ type, ...facts }) }, options);
  return { ui, ofType: type => seen.filter(event => event.type === type) };
};

const choices = [{ value: 'a', label: 'First' }, { value: 'b', label: 'Second' }];
const ENTER = '\r';
const DOWN = '\x1b[B';
const ESCAPE = '\x1b';

test('a question records that it showed, which choice answered it and how long it was up', async () => {
  let clock = 1000;
  const { ui, ofType } = dashboard({}, {}, { now: () => clock });

  const answer = ui.askQuestion({ question: 'A private question?', choices });
  clock += 4000;
  ui.input(DOWN);
  ui.input(ENTER);
  await answer;
  ui.stop();

  assert.equal(ofType('question_shown').length, 1);
  assert.deepEqual(ofType('question_ended'), [{ type: 'question_ended', how: 'answered', choice: 1, ms: 4000 }]);
});

test('a question escaped says so, and one left to run out says it expired', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ui, ofType } = dashboard();

  const escaped = ui.askQuestion({ question: 'One?', choices });
  ui.input(ESCAPE);
  await escaped;
  const left = ui.askQuestion({ question: 'Two?', choices, waitMs: 30000 });
  t.mock.timers.tick(30000);
  await left;
  ui.stop();

  assert.deepEqual(ofType('question_ended').map(({ how, choice }) => [how, choice]), [['escaped', undefined], ['expired', undefined]]);
});

test('an answer typed in Other counts as the row past the last choice, and its words stay out', async () => {
  const { ui, ofType } = dashboard();

  const answer = ui.askQuestion({ question: 'Which?', choices, other: true });
  ui.input(DOWN);
  ui.input(DOWN);
  ui.input('x');
  ui.input(ENTER);
  assert.deepEqual(await answer, { typed: 'x' });
  ui.stop();

  const [ended] = ofType('question_ended');
  assert.deepEqual([ended.how, ended.choice], ['answered', 2]);
  assert.equal(JSON.stringify(ended).includes('typed'), false);
});

test('every tab opened is recorded', () => {
  const { ui, ofType } = dashboard();

  ui.input('\x1b[C');
  ui.input('\x1b[C');
  ui.stop();

  assert.deepEqual(ofType('tab_opened').map(({ tab }) => tab), ['reports', 'schedules']);
});

test('a page in the Done walk records how long it stayed open', async () => {
  let clock = 1000;
  const ready = [{ slug: 'site', project: 'website', item: 'one', title: 'Work one', branch: 'hobkin/one', gap: 'land', described: true, proved: true }];
  const workAction = async () => ({ description: 'Moves the site.' });
  const { ui, ofType } = dashboard({ work: { enabled: true, projects: [], ready } }, { workAction }, { now: () => clock });

  ui.showDone();
  ui.input(DOWN);
  ui.input(ENTER);
  await ui.pending();
  clock += 6000;
  ui.input(ESCAPE);
  ui.stop();

  assert.deepEqual(ofType('done_page'), [{ type: 'done_page', project: 'site', item: 'one', ms: 6000 }]);
});

test('an error on screen says where it came from and leaves out what it said', async () => {
  const send = async () => { throw Error('A private failure.'); };
  const { ui, ofType } = dashboard({}, { send });

  ui.input('h');
  ui.input('i');
  ui.input(ENTER);
  await ui.pending();
  ui.stop();

  assert.deepEqual(ofType('error_shown'), [{ type: 'error_shown', from: 'Send' }]);
});

test('the dashboard writes its events to the data folder, connected or not', async t => {
  const h = fixture(t);
  let handlers;
  const started = Promise.withResolvers();
  const output = { isTTY: true, write() {} };
  const stops = new Map();
  const signals = { on: (name, listener) => stops.set(name, listener), removeListener() {} };
  const work = main(['--home', h.root], output, {
    signals,
    input: { isTTY: true },
    signIn: async () => {},
    startDashboard: (_view, next) => {
      handlers = next;
      started.resolve();
      return { update() {}, stop() {} };
    },
    openApplication: async () => ({ async close() {} }),
  });

  await started.promise;
  handlers.event('tab_opened', { tab: 'reports' });
  stops.get('SIGTERM')();
  await work;

  assert.deepEqual(h.ofType('tab_opened').map(({ tab }) => tab), ['reports']);
});
