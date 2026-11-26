import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinRunner } from '../src/cli/runner.mjs';
import { loadWorkflows, parseWorkflow, readWorkflowSwitches, switchWorkflow, workflowFoldersOf } from '../src/cli/workflows.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const NOW = Date.parse('2026-11-24T14:00:00Z');
const file = (metadata, body = 'Look at the open issues and say which need the user.') => `---\n${JSON.stringify(metadata)}\n---\n${body}\n`;

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-workflows-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'integration', 'workflows');
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(root, 'runtime'), { recursive: true });
  const defaults = { model: 'fixture/check', effort: 'medium', cwd: root };
  return { root, folder, defaults, write: (name, source) => writeFileSync(join(folder, name), source) };
}

test('a workflow is a routine file with its id from its file, its cadence from what it gives, an optional schedule and what else starts it', t => {
  const { folder, defaults, root } = home(t);
  const place = name => ({ integration: 'github', name, path: join(folder, `${name}.md`) });
  const daily = parseWorkflow(file({ title: 'Triage', at: '09:00', timezone: 'UTC', on: ['press'] }), place('triage'), defaults);
  assert.equal(daily.id, 'github/triage');
  assert.equal(daily.integration, 'github');
  assert.deepEqual([daily.cadence, daily.at, daily.timezone, daily.on], ['daily', '09:00', 'UTC', ['press']]);
  assert.deepEqual([daily.model, daily.effort, daily.cwd, daily.context, daily.harness], ['fixture/check', 'medium', root, [], 'pi'], "the home's background binding");
  assert.equal(daily.prompt, 'Look at the open issues and say which need the user.');
  assert.equal(Object.hasOwn(daily, 'enabled'), false, 'whether it is on is the home\'s');
  assert.equal(parseWorkflow(file({ title: 'Weekly', at: '09:00', timezone: 'UTC', weekday: 1 }), place('weekly'), defaults).cadence, 'weekly');
  assert.equal(parseWorkflow(file({ title: 'Monthly', window: { start: '09:00', end: '10:00', everyMinutes: 30 }, timezone: 'UTC', day: 3 }), place('monthly'), defaults).cadence, 'monthly');
  const pressed = parseWorkflow(file({ id: 'after-issue', title: 'After an issue', effort: 'high', on: ['after:github.issue.add', 'start'] }), place('after-issue'), defaults);
  assert.deepEqual([pressed.cadence, pressed.effort, pressed.on, Object.hasOwn(pressed, 'at'), Object.hasOwn(pressed, 'timezone')], [null, 'high', ['after:github.issue.add', 'start'], false, false]);
  for (const [metadata, wrong] of [
    [{ title: 'X', on: ['press'], enabled: true }, /unknown setting: enabled/],
    [{ id: 'other', title: 'X', on: ['press'] }, /id must be the file name/],
    [{ title: 'X' }, /needs a schedule or something in on/],
    [{ title: 'X', on: ['sometimes'] }, /on must list distinct starts/],
    [{ title: 'X', on: ['press'], timezone: 'UTC' }, /go with a schedule/],
    [{ title: 'X', at: '25:00', timezone: 'UTC' }, /at must be HH:mm/],
    [{ title: 'X', on: ['press'], effort: 'loud' }, /unsupported pi effort/],
  ]) assert.throws(() => parseWorkflow(file(metadata), place('x'), defaults), wrong);
});

test("a folder's workflows load in name order with whether the home has them on, and a missing folder has none", t => {
  const { root, folder, defaults, write } = home(t);
  write('triage.md', file({ title: 'Triage', at: '09:00', timezone: 'UTC' }));
  write('after-issue.md', file({ title: 'After an issue', on: ['after:github.issue.add'] }));
  write('README.md', '# Not a workflow');
  write('Bad Name.md', file({ title: 'X', on: ['press'] }));
  write('broken.md', 'no front matter');
  const folders = [{ id: 'github', folder, tools: ['github_find_pull'] }, { id: 'notes', folder: join(root, 'none'), tools: [] }];
  const loaded = loadWorkflows(root, folders, defaults, NOW);
  assert.deepEqual(loaded.schedules.map(item => [item.id, item.enabled]), [['github/after-issue', true], ['github/triage', true]]);
  assert.deepEqual(loaded.errors.map(error => error.path), [join(folder, 'Bad Name.md'), join(folder, 'broken.md')]);
  switchWorkflow(root, 'github/triage', false, new Date(NOW));
  switchWorkflow(root, 'github/after-issue', true, new Date(NOW));
  const switched = loadWorkflows(root, folders, defaults, NOW);
  assert.deepEqual(switched.schedules.map(item => [item.id, item.enabled, item.enabledAt]), [
    ['github/after-issue', true, '2026-11-24T14:00:00.000Z'], ['github/triage', false, undefined]]);
  assert.deepEqual(readWorkflowSwitches(root).switches['github/triage'], { enabled: false, at: '2026-11-24T14:00:00.000Z' });
  writeFileSync(join(root, 'runtime', 'workflows.json'), 'not json');
  const unreadable = loadWorkflows(root, folders, defaults, NOW);
  assert.equal(unreadable.schedules.every(item => !item.enabled), true, 'a switch file that cannot be read keeps every workflow off');
  assert.match(unreadable.errors[0].message, /every workflow stays off/);
});

test("the host's folders are taken as they are well formed", () => {
  assert.deepEqual(workflowFoldersOf({ workflowFolders: () => [
    { id: 'github', folder: '/repo/integrations/github/workflows', tools: ['github_find_pull', 3] },
    { id: 'github', folder: '/elsewhere', tools: [] },
    { id: 'Bad Id', folder: '/x', tools: [] },
    { id: 'notes', folder: 'relative', tools: [] },
  ] }), [{ id: 'github', folder: '/repo/integrations/github/workflows', tools: ['github_find_pull'] }]);
  assert.deepEqual(workflowFoldersOf({ workflowFolders: () => { throw Error('broken'); } }), []);
  assert.deepEqual(workflowFoldersOf(undefined), []);
});

class FakeRuntime {
  data = { main: null, runs: {}, lastTick: null };
  active = new Map();
  async state() { return structuredClone(this.data); }
  async change(fn) { return fn(this.data); }
  dispatch(request, effect, onAdmitted) {
    const controller = new AbortController();
    const run = this.data.runs[request.id] = { ...request, status: 'running' };
    onAdmitted?.();
    const work = Promise.resolve().then(() => effect(controller.signal)).catch(error => ({ status: 'failed', error: error.message }))
      .then(result => Object.assign(run, { status: result.status, finishedAt: new Date(NOW).toISOString(), result })).finally(() => this.active.delete(request.id));
    this.active.set(request.id, { controller, work });
    return work;
  }
  async idle() { await Promise.all([...this.active.values()].map(item => item.work)); }
}

/** A runner over this home with these workflow folders, whose runs are only recorded, on a clock the test moves. */
function runner(t, setUp, { at = NOW } = {}) {
  const h = home(t);
  setUp(h);
  const asked = [];
  const runtime = new FakeRuntime();
  const folders = [{ id: 'github', folder: h.folder, tools: ['github_find_pull'] }];
  const clock = { at };
  const made = new HobkinRunner({ root: h.root, runtime, now: () => new Date(clock.at), workflows: () => folders,
    config: { concurrency: 3, initializedAt: '2026-01-01T00:00:00Z', main: { cwd: h.root }, background: { harness: 'pi', model: 'fixture/check', effort: 'medium' } },
    runHarness: async request => { asked.push(request); return { status: 'completed', text: 'ok' }; } });
  const listing = () => readdirSync(h.folder).map(name => [name, statSync(join(h.folder, name)).mtimeMs]);
  return { ...h, asked, runtime, runner: made, listing, clock };
}

test('a scheduled workflow runs on its schedule as a routine does, with its directions, and one with no schedule never runs by the clock', async t => {
  const h = runner(t, ({ write }) => {
    write('triage.md', file({ title: 'Triage', at: '09:00', timezone: 'UTC' }));
    write('on-press.md', file({ title: 'On a press', on: ['press'] }, 'Only when pressed.'));
    write('once.md', file({ title: 'Once', at: '10:00', timezone: 'UTC', date: '2026-11-24' }, 'Just today.'));
  }, { at: Date.parse('2026-11-24T08:00:00Z') });
  await h.runner.tick();
  const before = h.listing();
  h.clock.at = NOW;
  await h.runner.tick();
  await h.runtime.idle();
  await h.runner.tick();
  const runs = Object.values(h.runtime.data.runs);
  assert.deepEqual(runs.map(run => [run.id, run.scheduleId]).sort(), [['github:once:2026-11-24', 'github/once'], ['github:triage:2026-11-24', 'github/triage']]);
  const prompts = h.asked.map(request => JSON.parse(request.prompt).routine).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(prompts.map(routine => [routine.id, routine.instructions]), [['github/once', 'Just today.'], ['github/triage', 'Look at the open issues and say which need the user.']]);
  assert.deepEqual(h.listing(), before, 'nothing is written into the folder, a finished once file included');
});

test("a workflow started by its integration runs now with its input in the run's context; one turned off does not run", async t => {
  const h = runner(t, ({ write }) => {
    write('after-issue.md', file({ title: 'After an issue', on: ['after:github.issue.add'] }, 'Label the new issue.'));
    write('triage.md', file({ title: 'Triage', at: '09:00', timezone: 'UTC' }));
  }, { at: Date.parse('2026-11-24T08:00:00Z') });
  await h.runner.tick();
  h.clock.at = NOW;
  const { run } = await h.runner.startWorkflow('github/after-issue', { args: { title: 'Dark mode' }, answer: { number: 12 } });
  await h.runtime.idle();
  assert.match(run, /^once:[0-9a-f]{64}$/);
  assert.equal(h.runtime.data.runs[run].scheduleId, 'github/after-issue');
  assert.equal(h.runtime.data.runs[run].trigger, 'manual');
  const envelope = JSON.parse(h.asked[0].prompt);
  assert.deepEqual(envelope.input, { args: { title: 'Dark mode' }, answer: { number: 12 } });
  assert.equal(envelope.routine.instructions, 'Label the new issue.');
  const second = await h.runner.startWorkflow('github/after-issue');
  await h.runtime.idle();
  assert.equal(Object.hasOwn(JSON.parse(h.asked[1].prompt), 'input'), false);
  assert.notEqual(second.run, run);
  await assert.rejects(h.runner.startWorkflow('github/none'), /Unknown workflow/);
  await assert.rejects(h.runner.startWorkflow('github/after-issue', { big: 'x'.repeat(40000) }), /at most 32768 bytes/);
  await assert.rejects(h.runner.trigger('github/after-issue', 'asked'), /Unknown exact native routine ID/, 'a routine run by name is never a workflow');

  assert.deepEqual(await h.runner.setWorkflowEnabled('github/triage', false), { id: 'github/triage', enabled: false });
  await h.runner.setWorkflowEnabled('github/after-issue', false);
  await assert.rejects(h.runner.startWorkflow('github/after-issue'), /turned off/);
  await h.runner.tick();
  await h.runtime.idle();
  assert.equal(Object.values(h.runtime.data.runs).some(item => item.scheduleId === 'github/triage'), false, 'a workflow turned off does not run on its schedule');
  await assert.rejects(h.runner.setWorkflowEnabled('github/none', true), /Unknown workflow/);
});

test('the snapshot lists workflows with the routines, each marked with its integration and what starts it', async t => {
  const h = runner(t, ({ write }) => {
    write('triage.md', file({ title: 'Triage', at: '18:00', timezone: 'UTC' }));
    write('on-press.md', file({ title: 'On a press', on: ['press', 'start'] }));
  });
  mkdirSync(join(h.root, 'routines', 'daily'), { recursive: true });
  writeFileSync(join(h.root, 'routines', 'daily', 'check.md'), file({ id: 'check', title: 'Check', at: '18:00', timezone: 'UTC', enabled: true, harness: 'pi', model: null, effort: 'medium', cwd: h.root, context: [] }));
  await h.runner.tick();
  const { schedules } = await h.runner.snapshot();
  assert.deepEqual(schedules.map(item => [item.id, item.integration, item.on, item.cadence, item.nextRun.state]), [
    ['check', undefined, undefined, 'daily', 'scheduled'],
    ['github/on-press', 'github', ['press', 'start'], null, 'unscheduled'],
    ['github/triage', 'github', [], 'daily', 'scheduled'],
  ]);
  await h.runner.setWorkflowEnabled('github/on-press', false);
  assert.equal((await h.runner.snapshot()).schedules.find(item => item.id === 'github/on-press').nextRun.state, 'paused');
});

test('a runner given no workflows loads the routines alone', async t => {
  const h = home(t);
  h.write('triage.md', file({ title: 'Triage', on: ['press'] }));
  const made = new HobkinRunner({ root: h.root, runtime: new FakeRuntime(), now: () => new Date(NOW), config: { concurrency: 1, initializedAt: '2026-01-01T00:00:00Z' },
    runHarness: async () => ({ status: 'completed' }) });
  await made.tick();
  assert.deepEqual(made.loaded.schedules, []);
  await assert.rejects(made.startWorkflow('github/triage'), /Unknown workflow/);
});

test("hobkin's application runs a workflow its integration starts, as a run in Reports offered only that integration's tools", async t => {
  const h = home(t);
  const config = initialize(h.root, { cwd: h.root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(h.root, 'config.json'), config);
  h.write('sweep.md', file({ title: 'Sweep', on: ['start'] }, 'Sweep the notes.'));
  const object = { type: 'object', properties: {}, additionalProperties: false };
  const integrations = {
    tools: () => [
      { name: 'notes_sweep', description: 'Sweeps notes.', parameters: object, agents: ['main'] },
      { name: 'github_find_pull', description: 'Finds a pull request.', parameters: object, agents: ['runs'] },
    ],
    callTool: async () => ({ text: '' }),
    workflowFolders: () => [{ id: 'notes', folder: h.folder, tools: ['notes_sweep'] }],
  };
  const handed = [];
  const app = await HobkinApplication.open(h.root, { createMain: fakePi(h.root).createMain, intervalMs: 60000, now: () => NOW, integrations,
    runHarness: async (request, options) => { handed.push({ request, options }); return { status: 'completed', text: 'Swept.', cost: null }; } });
  t.after(() => app.close());
  await app.refresh();
  assert.deepEqual(app.snapshot.schedules.map(item => [item.id, item.integration, item.nextRun.state]), [['notes/sweep', 'notes', 'unscheduled']]);
  const { run } = await app.startWorkflow('notes/sweep', { why: 'asked' });
  const until = Date.now() + 5000;
  while (!handed.length && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(JSON.parse(handed[0].request.prompt).input, { why: 'asked' });
  assert.deepEqual(handed[0].options.integrations.offer.tools.map(tool => tool.name), ['notes_sweep']);
  assert.equal(handed[0].options.integrations.agent, run);
  let reports = [];
  while (!reports.some(report => report.id === run) && Date.now() < until) {
    reports = (await app.runner.snapshot()).reports;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(reports.filter(report => report.id === run).map(report => [report.title, report.text]), [['Sweep', 'Swept.']]);
  assert.deepEqual(await app.setWorkflowEnabled('notes/sweep', false), { id: 'notes/sweep', enabled: false });
  await assert.rejects(app.startWorkflow('notes/sweep'), /turned off/);
});

/** The runs of one workflow the runner has started so far, by occurrence. */
const runsOf = (h, id) => Object.values(h.runtime.data.runs).filter(run => run.scheduleId === id).map(run => run.id);
async function tickAt(h, iso) {
  h.clock.at = Date.parse(iso);
  await h.runner.tick();
  await h.runtime.idle();
}

test('a daily 09:00 workflow first seen at 15:00 runs tomorrow at 09:00, not now', async t => {
  const h = runner(t, ({ write }) => write('triage.md', file({ title: 'Triage', at: '09:00', timezone: 'UTC' })), { at: Date.parse('2026-11-24T15:00:00Z') });
  await tickAt(h, '2026-11-24T15:00:00Z');
  await tickAt(h, '2026-11-24T23:59:00Z');
  assert.deepEqual(runsOf(h, 'github/triage'), []);
  assert.equal((await h.runner.snapshot()).schedules[0].nextRun.at, '2026-11-25T09:00:00.000Z');
  await tickAt(h, '2026-11-25T09:00:30Z');
  assert.deepEqual(runsOf(h, 'github/triage'), ['github:triage:2026-11-25']);
});

test('a daily 09:00 workflow first seen at 08:00 runs at 09:00 that day', async t => {
  const h = runner(t, ({ write }) => write('triage.md', file({ title: 'Triage', at: '09:00', timezone: 'UTC' })), { at: Date.parse('2026-11-24T08:00:00Z') });
  await tickAt(h, '2026-11-24T08:00:00Z');
  assert.deepEqual(runsOf(h, 'github/triage'), []);
  await tickAt(h, '2026-11-24T09:00:30Z');
  assert.deepEqual(runsOf(h, 'github/triage'), ['github:triage:2026-11-24']);
});

test('a workflow that leaves its folder and comes back counts from its return', async t => {
  const h = runner(t, ({ write }) => write('triage.md', file({ title: 'Triage', at: '09:00', timezone: 'UTC' })), { at: Date.parse('2026-11-24T07:00:00Z') });
  await tickAt(h, '2026-11-24T07:00:00Z');
  rmSync(join(h.folder, 'triage.md'));
  await tickAt(h, '2026-11-24T08:00:00Z');
  h.write('triage.md', file({ title: 'Triage', at: '09:00', timezone: 'UTC' }));
  await tickAt(h, '2026-11-24T10:00:00Z');
  assert.deepEqual(runsOf(h, 'github/triage'), [], 'the 09:00 it was away for does not run');
  await tickAt(h, '2026-11-25T09:00:30Z');
  assert.deepEqual(runsOf(h, 'github/triage'), ['github:triage:2026-11-25']);
});
