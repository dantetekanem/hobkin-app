import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HobkinApplication } from '../src/cli/application.mjs';
import { initialize } from '../src/cli/config.mjs';
import { fileDecision } from '../src/cli/decisions.mjs';
import { chooseProject, fileItem, writeMode } from '../src/cli/work/store.mjs';
import { repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:30.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;

// A bare application over a real home with one chosen project, as cli-tick-signature.test.mjs builds one. The director is a stand-in whose
// running agent's counts the test moves, as its meter does when the agent's session file grows. Every rebuild asked for is counted.
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-work-tick-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  chooseProject(root, repository(base, 'api'), 'important', NOW);
  writeMode(root, { enabled: true });
  const clock = { now: NOW };
  const running = [{ id: 'work:api:do:one', slug: 'api', lane: 'do', kind: 'do', level: 'important', title: 'Fix it', tokens: 1000, cached: 5000, estimate: { fresh: 100000 }, startedAt: new Date(NOW).toISOString() }];
  const app = new HobkinApplication();
  const published = [];
  let rebuilds = 0;
  app.now = () => clock.now;
  app.runtime = { directory: root };
  app.moods = { notice() {} };
  app.learner = { enabled: () => false };
  app.director = { tick: async () => {}, outlook: () => ({ now: clock.now, running: running.map(run => ({ ...run })) }), running: () => [] };
  app.snapshot = { messages: [] };
  app.onChange = snapshot => published.push(snapshot);
  app.requestRefresh = () => { rebuilds += 1; };
  const tick = async (after = SECOND) => {
    clock.now += after;
    await app.tickWork();
    return rebuilds;
  };
  const grow = () => { running[0].tokens += 1500; running[0].cached += 40000; };
  return { root, app, running, published, tick, grow };
}

test('a tick where only a work session grew publishes its tokens and rebuilds nothing', async t => {
  const h = fixture(t);
  assert.equal(await h.tick(0), 1, 'the first tick rebuilds');
  h.grow();
  assert.equal(await h.tick(), 1);
  h.grow();
  assert.equal(await h.tick(), 1);
  assert.equal(h.published.length, 2, 'each grown tick publishes once');
  const { work } = h.published.at(-1);
  assert.equal(work.running[0].tokens, 4000);
  assert.equal(work.running[0].cached, 85000);
  assert.equal(work.discovering, false, 'it is the same view a rebuild shows');
  assert.equal(h.app.snapshot.work, work);
  assert.equal(await h.tick(), 1, 'nothing new, nothing published');
  assert.equal(h.published.length, 2);
});

test('a filed item, a decision, a pause notice, a finished run and a new minute each still rebuild', async t => {
  const h = fixture(t);
  assert.equal(await h.tick(0), 1);
  h.grow();
  fileItem(h.root, 'api', { key: 'bug', kind: 'fix', title: 'A new bug', brief: 'Found while working.' }, NOW);
  assert.equal(await h.tick(), 2, 'a filed item, with tokens grown too');
  fileDecision(h.root, { from: 'work', question: 'Merge it?', choices: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }, NOW);
  assert.equal(await h.tick(), 3, 'a decision');
  h.grow();
  writeMode(h.root, { pausedAt: new Date(NOW).toISOString(), pauseNotice: { id: 'hand', at: new Date(NOW).toISOString(), line: 'Paused by hand.', tone: 'quiet' } });
  assert.equal(await h.tick(), 4, 'a pause and its notice');
  h.running.pop();
  assert.equal(await h.tick(), 5, 'a run that finished');
  assert.equal(await h.tick(MINUTE), 6, 'a new minute');
  assert.equal(h.published.length, 0, 'every one of them went as a rebuild');
});

// A bare application around a real director (test/helpers/work-director.mjs), its planner counted. Work is paused by hand, so a tick starts
// nothing and only looks.
async function withDirector(t) {
  const { director, studied } = await import('./helpers/work-director.mjs');
  const h = director(t);
  studied(h, 'api');
  fileItem(h.root, 'api', { key: 'fix', kind: 'fix', title: 'Fix it', brief: 'Evidence, who benefits, the first change, the proof.', impact: 'high', effort: 'small' }, h.clock);
  writeMode(h.root, { pausedAt: new Date(h.clock).toISOString() });
  const plans = [];
  const planWork = h.director.planWork;
  h.director.planWork = (root, options) => {
    const plan = planWork(root, options);
    plans.push(plan);
    return plan;
  };
  const app = new HobkinApplication();
  Object.assign(app, { now: () => h.clock, runtime: { directory: h.root }, director: h.director, moods: { notice() {} }, learner: { enabled: () => false } });
  app.requestRefresh = (_activityOnly, work) => { app.shownWork = work; };
  return { h, app, plans };
}

test('a tick plans once, and its director, Work status and YOLO view read that one plan', async t => {
  const { h, app, plans } = await withDirector(t);
  await app.tickWork();
  assert.equal(plans.length, 1, 'one plan for the whole tick');
  const work = app.shownWork;
  assert.deepEqual(work.plan.filter(row => !row.skipped).map(row => row.key), plans[0].entries.filter(entry => !entry.skipped).map(entry => entry.key));
  assert.equal(work.pause.kind, plans[0].pause.kind);
  assert.equal(work.queued, plans[0].entries.filter(entry => !entry.skipped).length);
  assert.ok(work.yolo, 'the YOLO view comes from the same look');
  await app.tickWork();
  assert.equal(plans.length, 2, 'the next tick plans again: nothing is kept past its tick');
  await h.settled();
});

test('a file the plan read that changes before the status is read makes the status plan again, and shows the change', async t => {
  const { h, app, plans } = await withDirector(t);
  // Between the director's look and the status, as another process or a run's own call could write.
  app.learn = async () => { fileItem(h.root, 'api', { key: 'later', kind: 'fix', title: 'Filed meanwhile', brief: 'Evidence, who benefits, the first change, the proof.', impact: 'high', effort: 'small' }, h.clock); };
  await app.tickWork();
  assert.equal(plans.length, 2);
  assert.ok(app.shownWork.plan.some(row => row.title === 'Filed meanwhile'));
  await h.settled();
});

test('a rebuild under way never puts back Work older than a light publish made meanwhile', async t => {
  const h = fixture(t);
  const { setTimeout: wait } = await import('node:timers/promises');
  delete h.app.requestRefresh;
  h.app.runner = {};
  // The real rebuild awaits evidence, the run index, the document and the runner before it shows the Work it was asked with.
  const gate = Promise.withResolvers();
  h.app.project = async work => {
    await gate.promise;
    h.app.snapshot = { ...h.app.snapshot, work: h.app.workView(work) };
    h.app.onChange(h.app.snapshot);
    return h.app.snapshot;
  };
  await h.tick(0);
  await wait(40);
  h.grow();
  await h.tick();
  assert.equal(h.app.snapshot.work.running[0].tokens, 2500, 'published the light way');
  gate.resolve();
  await h.app.refreshing;
  assert.equal(h.app.snapshot.work.running[0].tokens, 2500, 'the older rebuild did not put back 1,000');
  assert.equal(h.published.at(-1).work.running[0].tokens, 2500, 'and the window was told the newer one last');
  await h.tick();
  assert.equal(h.app.snapshot.work.running[0].tokens, 2500);
});
