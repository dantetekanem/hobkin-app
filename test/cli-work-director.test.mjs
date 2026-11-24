import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { initialize, setLearning } from '../src/cli/config.mjs';
import { jarPath } from '../src/cli/proof/tools.mjs';
import { readEvents, recordEvent } from '../src/cli/events.mjs';
import { saveState } from '../src/cli/learning/store.mjs';
import { lastUpkeep } from '../src/cli/work/upkeep.mjs';
import { HobkinRunner } from '../src/cli/runner.mjs';
import { firstGuess } from '../src/cli/work/budget.mjs';
import { askAgent, requestReview } from '../src/cli/work/controls.mjs';
import { WorkDirector } from '../src/cli/work/director.mjs';
import { planWork } from '../src/cli/work/plan.mjs';
import { recordSignals } from '../src/cli/work/signals.mjs';
import {
  answerAllowance, chooseProject, fileItem, itemTree, noteDiscovery, paths, pickNext, prFile, proposeProject, requestCancel, pendingCancels, readDiscovery, readItems, readMode, readState, recordDiscovery,
  readProject, recordTokens, setProjectPrMode, setProjectPriority, skipProject, startWork, tokenEvents, tokensToday, updateItem, writeMode, writeState,
} from '../src/cli/work/store.mjs';
import { readUnmerged } from '../src/cli/work/unmerged.mjs';
import { withOrigin, writeJson } from './helpers/work-fixture.mjs';

const HOUR = 3600000;
const config = {
  concurrency: 2,
  initializedAt: '2026-01-01T00:00:00Z',
  main: { model: 'fixture/main', effort: 'medium', cwd: '/tmp' },
  background: { harness: 'pi', model: 'fixture/background', effort: 'medium' },
};
const item = { key: 'update:rack', kind: 'update', title: 'Update rack', brief: 'Rack has an advisory.' };

class MemoryRuntime {
  data = { main: null, runs: {}, lastTick: null };
  active = new Map();

  async state() { return structuredClone(this.data); }

  dispatch(request, effect) {
    const controller = new AbortController();
    const run = this.data.runs[request.id] = { ...request, status: 'running' };
    const work = Promise.resolve()
      .then(() => effect(controller.signal))
      .catch(error => ({ status: 'failed', error: error.message }))
      .then(result => Object.assign(run, { status: result.status, result }))
      .finally(() => this.active.delete(request.id));
    this.active.set(request.id, { controller, work });
    return work;
  }

  async cancel(id) {
    this.active.get(id)?.controller.abort();
    await this.active.get(id)?.work;
  }
}

test('user Work Stop waits for settlement and refuses failed or stale kills', { timeout: 10000 }, async () => {
  const run = { id: 'work:exact', title: 'Exact Work run', lane: 'discover' };
  const settled = Promise.withResolvers();
  const calls = [];
  const director = new WorkDirector({ root: '/unused', config, runtime: {}, runner: {
    kill: (...args) => { calls.push(args); return settled.promise; },
  } });
  director.active.set('discover', run);
  let returned = false;
  const stopping = director.stopFromScreen(run.id, 'later').then(result => { returned = true; return result; });
  await Promise.resolve();
  assert.equal(returned, false);
  settled.resolve(false);
  await assert.rejects(stopping, /nothing was stopped|already finished/i);
  assert.deepEqual(calls, [[run.id, { source: 'user', reason: 'Stopped for now.' }]]);
  director.runner.kill = async () => { throw Error('Stop failed'); };
  await assert.rejects(director.stopFromScreen(run.id, 'later'), /Stop failed/);
  director.runner.kill = async () => true;
  assert.match((await director.stopFromScreen(run.id, 'later')).message, /Stopped "Exact Work run"/);
});

test('a stop from the window is written down with its run, project, item and how it stopped, and a stop that stopped nothing is not', { timeout: 10000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-stop-record-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let stops = true;
  const director = new WorkDirector({ root, config, runtime: {}, runner: { kill: async () => stops } });
  director.active.set('do:api', { id: 'work:api:do:1', title: 'Fix rack', lane: 'do', slug: 'api', item: 'a1' });

  await director.stopFromScreen('work:api:do:1', 'decline');
  stops = false;
  await assert.rejects(director.stopFromScreen('work:api:do:1', 'later'));

  const stopped = readEvents(root).filter(({ type }) => type === 'work_stopped').map(({ at, ...facts }) => facts);
  assert.deepEqual(stopped, [{ type: 'work_stopped', id: 'work:api:do:1', project: 'api', item: 'a1', lane: 'do', how: 'decline' }]);
});

test('user Work cancel request reaches the exact run once without blocking the owner tick', { timeout: 10000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-stop-work-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const settled = Promise.withResolvers();
  const calls = [];
  const director = new WorkDirector({ root, config: { ...config, concurrency: 1 }, runtime: {}, runner: {
    kill: (...args) => { calls.push(args); return settled.promise; },
  } });
  director.active.set('discover', { id: 'work:external', title: 'Exact queued cancellation', lane: 'discover' });
  requestCancel(root, 'work:external');
  director.answerCancels();
  director.answerCancels();
  assert.deepEqual(pendingCancels(root), []);
  assert.deepEqual(calls, [['work:external', { source: 'user', reason: 'Stopped for now.' }]]);
  settled.resolve(true);
  await settled.promise;
});

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

function repository(base, name) {
  const checkout = join(base, name);
  execFileSync('git', ['init', '-q', '-b', 'main', checkout]);
  git(checkout, 'config', 'user.email', 'test@example.com');
  git(checkout, 'config', 'user.name', 'Test');
  writeFileSync(join(checkout, 'app.txt'), 'one\n');
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-qm', 'first');
  return checkout;
}

function fixture(t, agent = async () => {}, earlier = null) {
  const base = earlier?.base ?? realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-director-')));
  const root = join(base, 'home');
  if (!earlier) {
    mkdirSync(root);
    t.after(() => rmSync(base, { recursive: true, force: true }));
  }

  const h = { base, root, clock: Date.parse('2026-06-01T12:00:00Z'), calls: [], changes: 0, agent };
  const runtime = new MemoryRuntime();
  const runner = new HobkinRunner({ runtime, root, config, now: () => new Date(h.clock) });
  h.runtime = runtime;
  h.runner = runner;
  // Most of these are about what starts, not when, so the gap between starts is off here, and a reading of the subscription allows two agents.
  // The weekly state-machines look is off here too: it would come first on every new project, and its own test turns it on.
  writeMode(root, { startGapMs: 0, machinesLook: false });
  writeJson(join(root, 'work', 'subscription.json'), { secondary: { usedPercent: 1, windowMinutes: 10080, resetAt: h.clock + 6 * 24 * HOUR } });
  h.director = new WorkDirector({
    root,
    config,
    runner,
    runtime,
    now: () => h.clock,
    onChange: () => { h.changes++; },
    gh: async (...args) => h.gh(...args),
    claudeProjects: join(base, 'claude-projects'),
    runHarness: async (request, options) => {
      h.calls.push(request);
      await h.agent(request, options);
      // A discovery that does its job reports every root folder finished.
      if (request.purpose === 'work-discover' && !h.stopsEarly) noteDiscovery(root, { rootFolders: ['everything'], finishedFolders: ['everything'] });
      if (h.result) return h.result;
      return { status: request.signal.aborted ? 'interrupted' : 'completed', text: h.report ?? 'Useful: Done.' };
    },
  });
  h.gh = async () => { throw Error('This repository has no remote.'); };
  h.settled = async () => {
    await Promise.all([...runner.jobs.values()]);
    await h.director.closing;
    await h.director.watching;
    await h.director.surveying;
  };
  h.tick = async () => {
    await h.director.tick();
    await h.settled();
  };
  // One run starts on each tick.
  h.ticks = async count => {
    for (let index = 0; index < count; index++) await h.tick();
  };
  h.purposes = () => h.calls.map(call => call.purpose);
  h.work = call => JSON.parse(call.prompt).work;
  return h;
}

// These tests count starts tick by tick, and a project's first signals look would be one more of them.
const signalsKnown = (root, slug) => recordSignals(root, slug, { type: 'tool', deploy: { command: 'git tag', saw: 'v1.0.0' } });

const study = root => (request) => {
  if (request.purpose === 'work-look' && !existsSync(paths(root, 'api').project)) {
    writeFileSync(paths(root, 'api').project, '# What it is\n\nAn API.\n');
    signalsKnown(root, 'api');
  }
};

test('main workload Stop plan keys cross begin and start unchanged for every Work lane', async t => {
  const h = fixture(t);
  const project = { slug: 'api', name: 'API', path: h.base };
  const { proposeProject } = await import('../src/cli/work/store.mjs');
  proposeProject(h.root, { ...project, level: 'casual', summary: 'Fixture.' });
  const captured = [];
  for (const name of ['startDiscovery', 'startLook', 'startDo']) h.director[name] = (...args) => captured.push(args.at(-1).planKey);
  for (const lane of ['discover', 'look', 'do']) h.director.begin({ lane, slug: 'api', key: `actual:${lane}` }, { used: 0, limit: 100 }, { queueNext: [] });
  assert.deepEqual(captured, ['actual:discover', 'actual:look', 'actual:do']);
  h.director.start({ key: 'different-internal-key', planKey: 'actual:discover', lane: 'discover', title: 'Fixture', cwd: h.root, work: () => ({}) });
  await h.settled();
  assert.equal(Object.values(h.runtime.data.runs)[0].work.planKey, 'actual:discover');
});

test('nothing runs while work mode is off', async t => {
  const h = fixture(t);
  chooseProject(h.root, repository(h.base, 'api'));

  await h.tick();

  assert.deepEqual(h.calls, []);
});

test('the survey runs while work mode is off, so merged work is still found', async t => {
  const h = fixture(t);
  chooseProject(h.root, repository(h.base, 'api'));

  await h.tick();

  assert.equal(readUnmerged(h.root).at, new Date(h.clock).toISOString());
});

test('with no folder named, nothing goes looking', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true });

  await h.tick();

  assert.deepEqual(h.calls, []);
});

test('a busy Chat holds no work back', async t => {
  const h = fixture(t);
  h.runtime.mainBusy = true;
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();

  assert.deepEqual(h.purposes(), ['work-discover']);
});

test('turning work mode on sends the agent to the folder the user named, and a finished look is not repeated', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();
  await h.tick();

  assert.deepEqual(h.purposes(), ['work-discover']);
  assert.equal(h.calls[0].model, 'fixture/main');
  assert.equal(h.calls[0].effort, 'medium');
  assert.equal(h.calls[0].cwd, join(h.root, 'work'));
  assert.equal(h.work(h.calls[0]).folder, '/repos');
  assert.match(h.work(h.calls[0]).commands.propose, /work propose --home/);

  h.clock += 25 * HOUR;
  await h.tick();
  assert.deepEqual(h.purposes(), ['work-discover']);
});

test('a failed discovery tries again soon instead of waiting a day', async t => {
  const h = fixture(t, async () => { throw Error('Provider is down.'); });
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();
  await h.tick();
  assert.equal(h.calls.length, 1);

  h.clock += 20 * 60000;
  await h.tick();

  assert.equal(h.calls.length, 2);
});

const waitForAbort = async request => {
  await new Promise(resolve => {
    if (request.signal.aborted) resolve();
    request.signal.addEventListener('abort', resolve, { once: true });
  });
};
const hoursAgo = (h, hours) => new Date(h.clock - hours * HOUR).toISOString();

test('closing Hobkin during a discovery starts it over next time', async t => {
  const h = fixture(t, waitForAbort);
  writeMode(h.root, { enabled: true, folder: '/repos' });
  await h.director.tick();
  while (!h.calls.length) await new Promise(resolve => setTimeout(resolve, 20));

  await h.runner.stop();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(readMode(h.root).lastDiscoveryAt, null);
  assert.equal(readDiscovery(h.root).status, 'interrupted');
});

test('a discovery whose owner died starts over when Hobkin reopens', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, folder: '/repos', lastDiscoveryAt: hoursAgo(h, 1) });
  recordDiscovery(h.root, { status: 'running', folder: '/repos', startedAt: hoursAgo(h, 1) });

  await h.tick();

  assert.deepEqual(h.purposes(), ['work-discover']);
});

test('a discovery whose owner died is put right even with work mode off', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: false, folder: '/repos', lastDiscoveryAt: hoursAgo(h, 1) });
  recordDiscovery(h.root, { status: 'running', folder: '/repos', startedAt: hoursAgo(h, 1) });

  await h.tick();

  assert.equal(readDiscovery(h.root).status, 'interrupted');
  assert.deepEqual(h.calls, []);
});

test('cancelling a discovery does not start it again', async t => {
  const h = fixture(t, waitForAbort);
  writeMode(h.root, { enabled: true, folder: '/repos' });
  await h.director.tick();
  while (!h.calls.length) await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(await h.runner.kill(h.director.running()[0].id), true);
  await h.settled();
  await new Promise(resolve => setImmediate(resolve));
  await h.tick();

  assert.equal(h.calls.length, 1);
  assert.equal(readDiscovery(h.root).status, 'cancelled');
});

test('turning work mode on with auto-pick and nothing to show looks at once, whatever the clock says', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: false, folder: '/repos', lastDiscoveryAt: hoursAgo(h, 22.6) });

  startWork(h.root, undefined, { autoPick: true });
  await h.tick();

  assert.deepEqual(h.purposes(), ['work-discover']);
});

test('opening Hobkin with work mode on and a clock no finished look explains looks at once', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, folder: '/repos', lastDiscoveryAt: hoursAgo(h, 22.6) });

  await h.tick();

  assert.deepEqual(h.purposes(), ['work-discover']);
});

test('a recent look that really found nothing is not repeated on reopening', async t => {
  const h = fixture(t);
  h.report = 'Useful: Offers none, because they are all forks.';
  writeMode(h.root, { enabled: true, folder: '/repos' });
  await h.tick();

  h.clock += HOUR;
  await h.tick();
  assert.equal(h.calls.length, 1);

  h.clock += 24 * HOUR;
  await h.tick();
  assert.equal(h.calls.length, 1, 'the watcher proposes what turns up there later, for no tokens');
});

test('a look that finished with nothing to propose promises no other look', async t => {
  const h = fixture(t);
  h.report = 'Useful: Offers none, because they are all forks.';
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();

  assert.match(readDiscovery(h.root).message, /nothing to propose/);
  assert.doesNotMatch(readDiscovery(h.root).message, /looks again/);
});

test('a look in another folder says nothing about this one', async t => {
  const h = fixture(t);
  h.report = 'Nothing new.';
  writeMode(h.root, { enabled: true, folder: '/old' });
  await h.tick();

  writeMode(h.root, { folder: '/repos' });
  await h.tick();

  assert.deepEqual(h.calls.map(call => h.work(call).folder), ['/old', '/repos']);
});

test('once there are projects, repeat looks keep to the daily clock', async t => {
  const h = fixture(t);
  proposeProject(h.root, { name: 'api', path: '/repos/api', level: 'casual' });
  writeMode(h.root, { enabled: true, folder: '/repos', lastDiscoveryAt: hoursAgo(h, 22.6) });

  await h.tick();
  assert.deepEqual(h.calls, []);

  writeMode(h.root, { enabled: false });
  startWork(h.root, undefined, { autoPick: true });
  await h.tick();
  assert.deepEqual(h.calls, [], 'turning it off and on again does not pay for another look');
});

test('turning work mode off stops a discovery, and turning it on again carries on from its notes', async t => {
  const h = fixture(t, waitForAbort);
  writeMode(h.root, { enabled: true, folder: '/repos' });
  await h.director.tick();
  while (!h.calls.length) await new Promise(resolve => setTimeout(resolve, 20));

  writeMode(h.root, { enabled: false });
  await h.tick();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(h.director.running(), []);
  assert.equal(readDiscovery(h.root).status, 'cancelled');

  h.agent = async () => {};
  startWork(h.root, undefined, { autoPick: true });
  await h.tick();

  assert.equal(h.calls.length, 2);
  assert.match(h.calls[1].prompt, /carry on from where it stopped/);
});

test('a new folder named during a discovery still gets its own look', async t => {
  const finish = Promise.withResolvers();
  const h = fixture(t, () => finish.promise);
  writeMode(h.root, { enabled: true, folder: '/repos' });
  await h.director.tick();
  while (!h.calls.length) await new Promise(resolve => setTimeout(resolve, 20));

  startWork(h.root, h.base, { autoPick: true });
  finish.resolve();
  await h.settled();
  await h.tick();

  assert.deepEqual(h.calls.map(call => h.work(call).folder), ['/repos', h.base]);
});

const offering = (h, ...names) => () => {
  for (const [index, name] of names.entries()) {
    proposeProject(h.root, {
      name,
      path: `/repos/${name}`,
      rank: index + 1,
      level: index ? 'casual' : 'critical',
      summary: `What ${name} is.`,
      found: `CI on ${name} is red.`,
      reason: `Why ${name} matters.`,
    });
  }
};

test('when discovery ends the message names each repository, what was found and how critical, in rank order', async t => {
  const h = fixture(t);
  h.agent = offering(h, 'billing', 'site');
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();

  const { status, offered, message, finishedAt } = readDiscovery(h.root);
  assert.deepEqual([status, offered], ['finished', 2]);
  assert.ok(finishedAt);
  assert.ok(message.indexOf('billing') < message.indexOf('site'));
  for (const text of ['billing', 'critical', 'CI on billing is red', 'site', 'casual', 'CI on site is red']) assert.ok(message.includes(text), text);
});

test('a project already answered is not offered again', async t => {
  const h = fixture(t);
  h.agent = offering(h, 'billing', 'site');
  writeMode(h.root, { enabled: true, folder: '/repos' });
  proposeProject(h.root, { name: 'site', path: '/repos/site', level: 'casual' });
  skipProject(h.root, 'site');

  await h.tick();

  assert.doesNotMatch(readDiscovery(h.root).message, /site/);
});

test('a discovery that proposes nothing says so with the reason from its report', async t => {
  const h = fixture(t);
  h.report = 'Useful: Looked through 12 repositories and offers none, because they are all forks.\n\n## Left out\n';
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();

  const { status, offered, reason, message } = readDiscovery(h.root);
  assert.deepEqual([status, offered], ['finished', 0]);
  assert.match(reason, /they are all forks/);
  assert.match(message, /they are all forks/);
});

test('a discovery with nothing to say still leaves the user a reason', async t => {
  const h = fixture(t);
  h.report = 'Nothing new.';
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();

  assert.ok(readDiscovery(h.root).reason);
  assert.ok(readDiscovery(h.root).message);
});

test('a discovery that fails says why, and a retry that fails the same way stays quiet', async t => {
  const h = fixture(t, async () => { throw Error('Provider is down.'); });
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();

  const first = readDiscovery(h.root);
  assert.equal(first.status, 'failed');
  assert.match(first.reason, /Provider is down/);
  assert.match(first.message, /Provider is down/);

  h.clock += 20 * 60000;
  await h.tick();

  assert.equal(h.calls.length, 2);
  assert.equal(readDiscovery(h.root).status, 'failed');
  assert.equal(readDiscovery(h.root).message, undefined);
});

test('a discovery that fails after proposing still offers what it found', async t => {
  const h = fixture(t);
  h.agent = async () => {
    offering(h, 'billing')();
    throw Error('Provider is down.');
  };
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();

  const { message } = readDiscovery(h.root);
  assert.match(message, /Provider is down/);
  assert.match(message, /billing/);
});

test('a look triggered again with nothing new stays out of Chat once its proposals have been told', async t => {
  const h = fixture(t);
  h.agent = offering(h, 'billing');
  writeMode(h.root, { enabled: true, folder: '/repos' });
  await h.tick();
  assert.match(readDiscovery(h.root).message, /billing/);

  h.clock += 25 * HOUR;
  pickNext(h.root, 'discover');
  await h.tick();

  assert.equal(h.calls.length, 2);
  assert.equal(readDiscovery(h.root).message, undefined);
});

test('a new proposal on a later look is told, along with those still waiting', async t => {
  const h = fixture(t);
  h.agent = offering(h, 'billing');
  writeMode(h.root, { enabled: true, folder: '/repos' });
  await h.tick();

  h.clock += 25 * HOUR;
  pickNext(h.root, 'discover');
  h.agent = offering(h, 'billing', 'site');
  await h.tick();

  const { message } = readDiscovery(h.root);
  assert.match(message, /billing/);
  assert.match(message, /site/);
});

test('a proposal with no look behind it still reaches Chat, once', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: false, folder: '/repos' });
  proposeProject(h.root, { name: 'api', path: '/repos/api', level: 'casual' });

  await h.tick();
  const { message, finishedAt } = readDiscovery(h.root);
  assert.match(message, /api/);

  h.clock += 60000;
  await h.tick();
  assert.equal(readDiscovery(h.root).finishedAt, finishedAt);
});

test('a run that ends with folders left is not a finished look, and the next carries on from there', async t => {
  const h = fixture(t);
  h.stopsEarly = true;
  h.report = 'Useful: More to do.';
  h.agent = () => {
    if (h.calls.length === 1) noteDiscovery(h.root, { rootFolders: ['api', 'site'], finishedFolders: ['api'], repositories: ['api'] });
    else noteDiscovery(h.root, { finishedFolders: ['site'] });
  };
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();
  assert.equal(readDiscovery(h.root).status, 'continuing');
  assert.equal(readDiscovery(h.root).message, undefined, 'nothing is final yet');

  await h.tick();

  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.work(h.calls[1]).folders, { root: ['api', 'site'], finished: ['api'] });
  assert.equal(readDiscovery(h.root).status, 'finished');
  assert.deepEqual(readDiscovery(h.root).repositories, ['api']);
});

test('a run that writes its memory, says one line and stops never counts as done', async t => {
  const h = fixture(t);
  h.stopsEarly = true;
  h.report = 'Continuing read-only project discovery.';
  h.agent = request => writeFileSync(JSON.parse(request.prompt).checkMemory.path, '# Discovery in progress\n');
  writeMode(h.root, { enabled: true, folder: '/repos' });

  for (let tick = 0; tick < 6; tick++) await h.tick();

  assert.equal(h.calls.length, 3, 'it carries on, but only so far');
  const { status, reason, message } = readDiscovery(h.root);
  assert.equal(status, 'unfinished');
  assert.match(reason, /Continuing read-only/);
  assert.match(message, /Continuing read-only/);

  h.clock += 25 * HOUR;
  await h.tick();
  assert.equal(h.calls.length, 4, 'the next day it tries again from a fresh count');
});

test('proposals from a look that never finishes still reach the user', async t => {
  const h = fixture(t);
  h.stopsEarly = true;
  h.agent = offering(h, 'billing');
  writeMode(h.root, { enabled: true, folder: '/repos' });

  for (let tick = 0; tick < 4; tick++) await h.tick();

  assert.equal(readDiscovery(h.root).status, 'unfinished');
  assert.match(readDiscovery(h.root).message, /billing/);
});

test('the first tick starts the weekly clock, and a week later Chat gets the review, with work mode on or off', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: false });
  await h.tick();
  assert.equal(readMode(h.root).lastReviewAt, undefined, 'with no project there is nothing to review');

  chooseProject(h.root, '/repos/api', 'important', h.clock);
  await h.tick();
  assert.ok(readMode(h.root).lastReviewAt);
  assert.equal(readMode(h.root).review, undefined);

  h.clock += 7 * 24 * HOUR;
  await h.tick();
  const { review } = readMode(h.root);
  assert.match(review.message, /^Weekly review: work mode is off/);
  assert.deepEqual(review.stale, []);

  h.clock += HOUR;
  await h.tick();
  assert.equal(readMode(h.root).review.at, review.at, 'once a week');
});

test('once a day, mode on or off and with no model, repeated harness failures reach Chat', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: false });
  for (const ago of [1, 2, 3]) recordEvent(h.root, 'error_shown', { from: 'Send' }, h.clock - ago * HOUR);

  await h.tick();
  const { harnessLines } = readMode(h.root);
  const upkeepAt = lastUpkeep(h.root);
  assert.equal(upkeepAt, new Date(h.clock).toISOString());
  assert.deepEqual(harnessLines.map(({ key }) => key), ['harness:error:send']);
  assert.ok(h.changes > 0);

  for (let count = 0; count < 3; count += 1) recordEvent(h.root, 'error_shown', { from: 'Kill' }, h.clock);
  h.clock += HOUR;
  await h.tick();
  assert.equal(lastUpkeep(h.root), upkeepAt, 'once a day');
  assert.deepEqual(readMode(h.root).harnessLines.map(({ key }) => key), ['harness:error:send']);

  h.clock += 24 * HOUR;
  await h.tick();
  assert.notEqual(lastUpkeep(h.root), upkeepAt);
  assert.deepEqual(h.calls, [], 'it never starts a run');
});

test('a pass that cannot read its events leaves the tick alone, and the next day tries again', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: false });
  mkdirSync(join(h.root, 'runtime', 'events', '2026-06.jsonl'), { recursive: true });
  writeFileSync(join(h.root, 'runtime', 'events', 'notes.txt'), '');

  await assert.doesNotReject(h.tick());

  assert.equal(lastUpkeep(h.root), new Date(h.clock).toISOString());
});

test('stopping work mode during a look tells what it has so far, and starting again carries on', async t => {
  const h = fixture(t);
  h.stopsEarly = true;
  h.agent = () => {
    offering(h, 'billing')();
    noteDiscovery(h.root, { rootFolders: ['api', 'site'], finishedFolders: ['api'] });
    writeMode(h.root, { enabled: false });
  };
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();
  await h.tick();

  assert.equal(h.calls.length, 1);
  assert.equal(readDiscovery(h.root).status, 'unfinished');
  assert.match(readDiscovery(h.root).message, /billing/);

  h.agent = () => noteDiscovery(h.root, { finishedFolders: ['site'] });
  startWork(h.root, undefined, { autoPick: true });
  await h.tick();

  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.work(h.calls[1]).folders.finished, ['api']);
  assert.equal(readDiscovery(h.root).status, 'finished');
});

test('the token limit ends a look part way with the user told, and it resumes when the limit lifts', async t => {
  const h = fixture(t);
  h.stopsEarly = true;
  h.agent = () => {
    offering(h, 'billing')();
    recordTokens(h.root, { lane: 'discover', tokens: 1000000 }, h.clock - 2 * HOUR);
  };
  writeMode(h.root, { enabled: true, folder: '/repos', dailyTokens: 1000000 });

  await h.tick();
  await h.tick();

  assert.equal(h.calls.length, 1);
  assert.equal(readDiscovery(h.root).status, 'unfinished');
  assert.match(readDiscovery(h.root).message, /billing/);

  h.agent = () => {};
  h.stopsEarly = false;
  h.clock += 24 * HOUR;
  await h.tick();

  assert.equal(h.calls.length, 2);
  assert.equal(readDiscovery(h.root).status, 'finished');
});

test('a memory left in progress by an older run reaches the next one, which finishes the look', async t => {
  const h = fixture(t);
  const checkFolder = join(h.root, 'checks', 'work.discover');
  mkdirSync(checkFolder, { recursive: true });
  writeFileSync(join(checkFolder, 'memory.md'), '# Discovery in progress\n\n- api: finished\n- site: waiting on a helper\n');
  h.agent = offering(h, 'site');
  writeMode(h.root, { enabled: true, folder: '/repos', lastDiscoveryAt: hoursAgo(h, 22.6) });

  await h.tick();

  assert.match(JSON.parse(h.calls[0].prompt).checkMemory.text, /in progress/);
  assert.deepEqual(h.purposes(), ['work-discover']);
  assert.equal(readDiscovery(h.root).status, 'finished');
  assert.match(readDiscovery(h.root).message, /site/);
});

test('discovery is given the command that reports where it is', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();

  assert.match(h.work(h.calls[0]).commands.progress, /work progress --home/);
});

test('nothing starts on a project until the user has picked it', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, folder: h.base });
  h.agent = () => proposeProject(h.root, { name: 'api', path: repository(h.base, 'api'), level: 'critical', first: [item] });

  await h.tick();
  await h.tick();
  h.clock += 25 * HOUR;
  await h.tick();

  assert.ok(h.purposes().every(purpose => purpose === 'work-discover'));
  assert.deepEqual(readItems(h.root, 'api'), []);
});

test('discovery is told what is already known so it reads only what is new', async t => {
  const h = fixture(t);
  proposeProject(h.root, { name: 'api', path: '/repos/api', level: 'casual', summary: 'An API.' });
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();

  assert.deepEqual(h.work(h.calls[0]).known, [{ slug: 'api', path: '/repos/api', state: 'proposed' }]);
});

test('a taken project is studied in its own tree, and changes wait until that is done', async t => {
  const h = fixture(t);
  const checkout = repository(h.base, 'api');
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, checkout);
  fileItem(h.root, 'api', item);

  await h.tick();

  assert.deepEqual(h.purposes(), ['work-look']);
  const look = h.calls[0];
  assert.equal(h.work(look).focus, 'study');
  assert.equal(look.cwd, paths(h.root, 'api').lookTree);
  assert.equal(git(look.cwd, 'rev-parse', 'HEAD'), git(checkout, 'rev-parse', 'HEAD'));
  assert.equal(readItems(h.root, 'api')[0].state, 'open');
});

test('after the study the agent looks for work and starts on what is open, on a branch in the project\'s own folder', async t => {
  const h = fixture(t);
  const checkout = repository(h.base, 'api');
  let branchDuringTheRun;
  h.agent = request => {
    study(h.root)(request);
    if (request.purpose === 'work-do') branchDuringTheRun = git(request.cwd, 'branch', '--show-current');
  };
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, checkout);
  fileItem(h.root, 'api', item);

  await h.ticks(4);

  const looks = h.calls.filter(call => call.purpose === 'work-look').map(call => h.work(call).focus);
  assert.deepEqual(looks.slice(0, 2), ['study', 'security']);
  const run = h.calls.find(call => call.purpose === 'work-do');
  assert.ok(run, 'a do run started');
  assert.equal(run.cwd, checkout);
  assert.match(branchDuringTheRun, /^hobkin\/[0-9a-f]{6}-update-rack$/);
  assert.equal(git(checkout, 'branch', '--show-current'), 'main', 'the folder is back where it was');
  assert.deepEqual([h.work(run).item.key, h.work(run).landing, h.work(run).place], ['update:rack', 'off', 'folder']);
  assert.match(h.work(run).projectNotes, /An API/);
  assert.match(h.work(run).commands.item, /work item api --home/);
  // hobkin checks a TLA+ model itself: a look's check is for its project, and an item's for that item.
  const look = h.calls.find(call => call.purpose === 'work-look');
  assert.match(h.work(look).commands.proof, /proof check --project api --home/);
  assert.match(h.work(run).commands.proof, new RegExp(`proof check --project api --item ${h.work(run).item.id} --home`));
});

test('each lens comes up in turn, as often as the priority says', async t => {
  const h = fixture(t);
  h.agent = study(h.root);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'), 'critical');
  await h.tick();
  await h.tick();
  await h.tick();

  h.clock += HOUR / 2;
  await h.tick();
  assert.equal(h.calls.length, 3);

  h.clock += HOUR;
  await h.tick();
  assert.deepEqual(h.calls.map(call => h.work(call).focus), ['study', 'security', 'ideas', 'bugs']);
});

const studied = (h, name) => {
  const slug = name;
  mkdirSync(paths(h.root, slug).directory, { recursive: true });
  writeFileSync(paths(h.root, slug).project, '# What it is\n');
  writeState(h.root, slug, { lastLensAt: new Date(h.clock).toISOString(), lastSignalsAt: new Date(h.clock).toISOString() });
};
const ideaRuns = h => h.calls.filter(call => h.work(call).focus === 'ideas').map(call => h.work(call));
const onProject = (h, level = 'important') => {
  writeMode(h.root, { enabled: true, dailyTokens: 1000000, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'), level);
  studied(h, 'api');
};
const onlyItemsDue = h => {
  onProject(h);
  writeState(h.root, 'api', { lastIdeasAt: new Date(h.clock).toISOString() });
};
const fileOpen = (h, count) => {
  for (let index = 0; index < count; index++) fileItem(h.root, 'api', { ...item, key: `open-${index}` });
};
test('ideas come once a day when a project has nothing else to do', async t => {
  const h = fixture(t);
  onProject(h);

  await h.ticks(2);

  assert.equal(ideaRuns(h).length, 1);
  assert.equal(ideaRuns(h)[0].ideas, 3);
});

test('past half the day\'s tokens, a project gets one idea at most', async t => {
  const h = fixture(t);
  onProject(h);
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 600000 }, h.clock - 2 * HOUR);

  await h.tick();

  assert.equal(ideaRuns(h)[0].ideas, 1);
  assert.deepEqual(ideaRuns(h)[0].tokens, { today: 600000, limit: 1000000 });
});

test('at the daily token limit nothing new starts until tomorrow, urgent or not', async t => {
  const h = fixture(t);
  h.agent = () => {};
  onProject(h, 'critical');
  fileItem(h.root, 'api', item);
  writeState(h.root, 'api', { lastLensAt: null });
  writeMode(h.root, { lastDiscoveryAt: null, folder: '/repos' });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 1000000 }, h.clock - 2 * HOUR);

  await h.tick();
  assert.deepEqual(h.calls, [], 'discovery, looks, ideas and ordinary items all wait');

  fileItem(h.root, 'api', { ...item, key: 'ci:main', kind: 'fix', urgent: true });
  await h.tick();
  assert.deepEqual(h.calls, [], 'urgent work stays inside the daily limit');

  h.clock += 24 * HOUR;
  await h.tick();
  assert.ok(h.calls.length > 0, 'a new day starts again');
});

test('past an hour\'s share new work waits, and urgent work on a critical project does not', async t => {
  const h = fixture(t);
  h.agent = () => {};
  onProject(h, 'critical');
  writeMode(h.root, { dailyTokens: 12000000 });
  fileItem(h.root, 'api', item);
  writeState(h.root, 'api', { lastLensAt: null });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 1000000 }, h.clock);

  await h.tick();
  assert.deepEqual(h.calls, [], 'an hour\'s share of a 12m day is 1m');

  fileItem(h.root, 'api', { ...item, key: 'ci:main', kind: 'fix', urgent: true });
  await h.tick();
  assert.deepEqual(h.calls.map(call => h.work(call).item?.key), ['ci:main'], 'urgent work does not wait for the hour');

  h.clock += 61 * 60000;
  await h.ticks(2);
  assert.ok(h.calls.length > 1, 'the rest starts once the window moves on');
});

const pausedAtLimit = h => {
  h.agent = () => {};
  onProject(h);
  fileItem(h.root, 'api', item);
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 1000000 }, h.clock - 2 * HOUR);
};
const pausedForTheHour = h => {
  h.agent = () => {};
  onProject(h);
  writeMode(h.root, { dailyTokens: 2400000 });
  fileItem(h.root, 'api', item);
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 200000 }, h.clock);
};

test('at the limit work pauses and Hobkin asks for more, saying why and what is waiting', async t => {
  const h = fixture(t);
  pausedAtLimit(h);

  await h.tick();

  assert.deepEqual(h.calls, []);
  assert.equal(readMode(h.root).enabled, true, 'paused, not turned off');
  assert.equal(readItems(h.root, 'api')[0].state, 'open', 'the work is still there');
  const { proposed, reason } = readMode(h.root).allowanceRequest;
  assert.equal(proposed, 2000000);
  assert.match(reason, /^Paused for today: 1m of the 1m daily limit used\./);
  assert.match(reason, /1 item is waiting/);
  assert.match(reason, /Update rack/);
  assert.match(reason, /hourly share 166\.7k until midnight/, 'it says what raising it changes');
  assert.match(reason, /Tomorrow it is back to 1m/);
});

test('at the limit an attention item is waiting like any other', async t => {
  const h = fixture(t);
  h.agent = () => {};
  onProject(h);
  fileItem(h.root, 'api', { key: 'attention:deploy-key', kind: 'attention', title: 'The deploy key expired', brief: 'Deploys fail until it is renewed.' });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 1000000 }, h.clock - 2 * HOUR);

  await h.tick();

  assert.match(readMode(h.root).allowanceRequest.reason, /1 item is waiting, starting with "The deploy key expired"/);
});

test('at the limit an item stuck by an older version is waiting too, because it runs again like anything open', async t => {
  const h = fixture(t);
  h.agent = () => {};
  onProject(h);
  const { id } = fileItem(h.root, 'api', item);
  updateItem(h.root, 'api', id, { state: 'stuck', stuckReason: 'It ended twice without recording an outcome.' });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 1000000 }, h.clock - 2 * HOUR);

  await h.tick();

  assert.match(readMode(h.root).allowanceRequest.reason, /1 item is waiting, starting with "Update rack"/);
});

test('it asks once for each allowance, not on every tick', async t => {
  const h = fixture(t);
  pausedAtLimit(h);
  await h.tick();
  const first = readMode(h.root).allowanceRequest;

  h.clock += 60000;
  await h.tick();

  assert.deepEqual(readMode(h.root).allowanceRequest, first);
});

test('saying yes resumes work at once on the higher allowance', async t => {
  const h = fixture(t);
  pausedAtLimit(h);
  await h.tick();

  answerAllowance(h.root, true, h.clock);
  await h.tick();

  assert.ok(h.calls.length > 0, 'work started again');
});

test('reaching a raised allowance asks again for more', async t => {
  const h = fixture(t);
  pausedAtLimit(h);
  await h.tick();
  answerAllowance(h.root, true, h.clock);
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 1000000 }, h.clock - HOUR - 60000);

  await h.tick();

  assert.equal(readMode(h.root).allowanceRequest.proposed, 4000000);
});

test('saying no keeps it paused for the day without asking again', async t => {
  const h = fixture(t);
  pausedAtLimit(h);
  await h.tick();

  answerAllowance(h.root, false, h.clock);
  h.clock += 60000;
  await h.tick();

  assert.equal(readMode(h.root).allowanceRequest, null);
  assert.deepEqual(h.calls, []);
});

test('with nothing waiting, there is nothing to ask', async t => {
  const h = fixture(t);
  h.agent = () => {};
  onProject(h);
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 1000000 }, h.clock - 2 * HOUR);

  await h.tick();

  assert.equal(readMode(h.root).allowanceRequest ?? null, null);
});

test('an hourly pause tells real numbers once and offers no raise, because it clears by itself', async t => {
  const h = fixture(t);
  pausedForTheHour(h);

  await h.tick();

  const { allowanceRequest, pauseNotice } = readMode(h.root);
  assert.equal(allowanceRequest ?? null, null);
  assert.match(pauseNotice.line, /^Paused for the hour: 200k of the 200k hourly share used\. Today 200k of 2\.4m\. Resumes around/);
  const { id } = pauseNotice;

  h.clock += 60000;
  await h.tick();
  assert.equal(readMode(h.root).pauseNotice.id, id, 'once is enough');
});

test('a run records its fresh and cached tokens apart, and only fresh ones count against the limit', async t => {
  const h = fixture(t);
  h.agent = request => {
    writeFileSync(request.sessionFile, [
      { type: 'session', id: 'one' },
      { type: 'message', message: { role: 'assistant', usage: { input: 700, output: 300, cacheRead: 9000 } } },
    ].map(entry => JSON.stringify(entry)).join('\n'));
  };
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(tokensToday(h.root, h.clock), 1000);
  const { budget: { used, cached } } = planWork(h.root, { now: h.clock });
  assert.deepEqual([used, cached], [1000, 9000]);
});

test('a long run counts while it runs, and adds nothing more when it ends', async t => {
  const release = Promise.withResolvers();
  const turn = input => `${JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { input, output: 0, cacheRead: 100 } } })}\n`;
  const h = fixture(t);
  let session;
  h.agent = async request => {
    session = request.sessionFile;
    writeFileSync(session, turn(500));
    await release.promise;
    appendFileSync(session, turn(300));
  };
  writeMode(h.root, { enabled: true, folder: '/repos' });
  await h.director.tick();
  while (!session) await new Promise(resolve => setTimeout(resolve, 10));

  await h.director.tick();

  const during = planWork(h.root, { now: h.clock, running: h.director.running() }).budget;
  assert.deepEqual([during.used, during.cached], [500, 100]);

  release.resolve();
  await h.settled();
  await new Promise(resolve => setImmediate(resolve));
  const after = planWork(h.root, { now: h.clock, running: h.director.running() }).budget;
  assert.deepEqual([after.used, after.cached], [800, 200]);
});

test('a background Pi run records its session tokens and harness cost', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  const cost = { usd: 0.2, kind: 'estimate', cumulative: true, sessionId: 'work-session' };
  h.agent = request => {
    writeFileSync(request.sessionFile, [
      { type: 'session', id: 'work-session' },
      { type: 'message', message: { role: 'assistant', usage: { input: 100, output: 50 } } },
    ].map(entry => JSON.stringify(entry)).join('\n'));
  };
  h.result = { status: 'completed', text: 'Useful: Done.', cost };

  await h.tick();
  await new Promise(resolve => setImmediate(resolve));

  const run = Object.values(h.runtime.data.runs)[0];
  assert.deepEqual(run.result.cost, cost);
  assert.equal(tokensToday(h.root, h.clock), 150);
});

test('a project gets one do at a time, and small work waits for what is running there', async t => {
  const release = Promise.withResolvers();
  const h = fixture(t);
  h.agent = async request => {
    study(h.root)(request);
    if (request.purpose === 'work-do') await release.promise;
  };
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  fileItem(h.root, 'api', item);
  fileItem(h.root, 'api', { ...item, key: 'second' });
  await h.ticks(2);

  while (!h.calls.some(call => call.purpose === 'work-do')) {
    await h.director.tick();
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const before = h.calls.length;
  await h.director.tick();
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.equal(h.calls.filter(call => call.purpose === 'work-do').length, 1);
  assert.equal(h.calls.length, before, 'small work waits, so the folder stays simple');
  release.resolve();
  await h.settled();
});

const doesItsJob = h => request => {
  const { project: { slug }, item: done } = h.work(request);
  writeFileSync(paths(h.root, slug).project, '# What it is\n');
  signalsKnown(h.root, slug);
  if (done) updateItem(h.root, slug, done.id, { state: 'pr', pr: 'https://example.com/1' });
};

test('level sets model and effort', async t => {
  const h = fixture(t);
  h.agent = doesItsJob(h);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'billing'), 'critical');
  chooseProject(h.root, repository(h.base, 'site'), 'casual');
  // At P2 its item would wait a day behind its study. The level alone sets the model and the effort.
  setProjectPriority(h.root, 'site', 'P0');
  fileItem(h.root, 'billing', item);
  fileItem(h.root, 'site', item);
  await h.ticks(8);

  const run = (slug, purpose) => h.calls.find(call => call.purpose === purpose && h.work(call).project.slug === slug);
  assert.deepEqual([run('billing', 'work-do').model, run('billing', 'work-do').effort], ['fixture/main', 'xhigh']);
  assert.deepEqual([run('billing', 'work-look').effort], ['high']);
  // A casual project is looked at on the checks model, and its code is written on the chat model: never on the checks model.
  assert.deepEqual([run('site', 'work-look').model, run('site', 'work-look').effort], ['fixture/background', 'low']);
  assert.deepEqual([run('site', 'work-do').model, run('site', 'work-do').effort], ['fixture/main', 'medium']);
});

test('a level names the tier of each kind of run, and a tier the user set brings its own model and effort', async t => {
  const h = fixture(t);
  h.agent = doesItsJob(h);
  h.director.config = { ...config, tiers: { high: { model: 'fixture/strong', effort: 'high' }, fast: { model: 'fixture/quick', effort: 'minimal' } } };
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'billing'), 'critical');
  chooseProject(h.root, repository(h.base, 'site'), 'casual');
  setProjectPriority(h.root, 'site', 'P0');
  fileItem(h.root, 'billing', item);
  fileItem(h.root, 'site', item);
  await h.ticks(8);

  const run = (slug, purpose) => h.calls.find(call => call.purpose === purpose && h.work(call).project.slug === slug);
  // Critical: look and do on the high tier. Casual: look on fast, do on mid, which follows the chat model.
  assert.deepEqual([run('billing', 'work-do').model, run('billing', 'work-do').effort], ['fixture/strong', 'high']);
  assert.deepEqual([run('billing', 'work-look').model, run('billing', 'work-look').effort], ['fixture/strong', 'high']);
  assert.deepEqual([run('site', 'work-look').model, run('site', 'work-look').effort], ['fixture/quick', 'minimal']);
  assert.deepEqual([run('site', 'work-do').model, run('site', 'work-do').effort], ['fixture/main', 'medium']);
});

test("the weekly state-machines look runs on the max tier, whatever its project's level, and comes once a week", async t => {
  const h = fixture(t);
  h.agent = doesItsJob(h);
  h.director.config = { ...config, tiers: { max: { model: 'fixture/deepest', effort: 'xhigh' } } };
  writeMode(h.root, { enabled: true, machinesLook: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'site'), 'casual');
  // With the TLA+ tools set up, the look that starts is one readiness counts, and that is what the project's state says.
  mkdirSync(dirname(jarPath(h.root)), { recursive: true });
  writeFileSync(jarPath(h.root), 'not a real jar');
  await h.ticks(8);

  const machines = h.calls.filter(call => call.purpose === 'work-look' && h.work(call).focus === 'state-machines');
  assert.equal(machines.length, 1, 'once, not on every tick');
  assert.equal(readState(h.root, 'site').lastMachinesTlcAt, readState(h.root, 'site').lastMachinesAt);
  assert.deepEqual([machines[0].model, machines[0].effort], ['fixture/deepest', 'xhigh']);
  // The look is told whether its project picks up issues by itself, so it knows whether an issue alone is enough.
  assert.equal(h.work(machines[0]).project.issues, 'off');
  // It pipes the machines it found, with their files, to a command of its own.
  assert.match(h.work(machines[0]).commands.machines, / work machines site --home /);
});

test('each kind of work run carries the tier its model came from, and finding projects, on the chat model, carries none', async t => {
  /** Each harness request's tier beside the tier on the run's own record, by purpose and focus. */
  const tiersOf = h => h.calls.map(call => {
    const record = Object.values(h.runtime.data.runs).find(run => run.harnessId === call.id);
    const focus = call.purpose === 'work-look' ? `:${h.work(call).focus}` : '';
    const project = call.purpose === 'work-discover' ? '' : `${h.work(call).project.slug} `;
    return `${project}${call.purpose}${focus} ${call.tier} ${record.tier}`;
  });

  const finding = fixture(t);
  writeMode(finding.root, { enabled: true, folder: '/repos' });
  await finding.tick();
  assert.deepEqual(tiersOf(finding), ['work-discover undefined undefined']);

  const levels = fixture(t);
  levels.agent = doesItsJob(levels);
  writeMode(levels.root, { enabled: true, lastDiscoveryAt: new Date(levels.clock).toISOString() });
  chooseProject(levels.root, repository(levels.base, 'billing'), 'critical');
  chooseProject(levels.root, repository(levels.base, 'site'), 'casual');
  setProjectPriority(levels.root, 'site', 'P0');
  fileItem(levels.root, 'billing', item);
  fileItem(levels.root, 'site', item);
  await levels.ticks(8);
  const seen = tiersOf(levels);
  for (const expected of ['billing work-look:study high high', 'billing work-do high high', 'site work-look:study fast fast', 'site work-do mid mid']) {
    assert.ok(seen.includes(expected), `${expected} in ${seen.join(', ')}`);
  }

  const machines = fixture(t);
  machines.agent = doesItsJob(machines);
  writeMode(machines.root, { enabled: true, machinesLook: true, lastDiscoveryAt: new Date(machines.clock).toISOString() });
  chooseProject(machines.root, repository(machines.base, 'site'), 'casual');
  await machines.ticks(8);
  assert.ok(tiersOf(machines).includes('site work-look:state-machines max max'));
});

test('a run lands the way its project says, whatever its level, and stays a local branch until the project says otherwise', async t => {
  const h = fixture(t);
  h.agent = doesItsJob(h);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'billing'), 'casual');
  chooseProject(h.root, repository(h.base, 'site'), 'critical');
  // At P2 its item would wait a day behind its study, and how work lands has nothing to do with that.
  setProjectPriority(h.root, 'billing', 'P0');
  setProjectPrMode(h.root, 'billing', 'published');
  fileItem(h.root, 'billing', item);
  fileItem(h.root, 'site', item);
  await h.ticks(8);

  const landingOf = slug => h.work(h.calls.find(call => call.purpose === 'work-do' && h.work(call).project.slug === slug)).landing;
  assert.deepEqual([landingOf('billing'), landingOf('site')], ['published', 'off']);
});

test('the limit on agents holds, and the more critical project goes first', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, agents: 1, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'site'), 'casual');
  chooseProject(h.root, repository(h.base, 'billing'), 'critical');

  await h.tick();

  assert.deepEqual(h.calls.map(call => h.work(call).project.slug), ['billing']);
});

const readyToDo = async h => {
  h.agent = study(h.root);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  fileItem(h.root, 'api', item);
  await h.ticks(2);
  writeState(h.root, 'api', { lastIdeasAt: new Date(h.clock).toISOString() });
};
const doRuns = h => h.calls.filter(call => call.purpose === 'work-do');

for (const priority of ['P1', 'P2']) {
  test(`${priority} starts eligible work after its former daily allowance`, async t => {
    const h = fixture(t);
    await readyToDo(h);
    setProjectPriority(h.root, 'api', priority);
    const weekly = { priority: 'P3', at: new Date(h.clock - HOUR).toISOString() };
    const history = [weekly, ...Array.from({ length: 4 }, () => ({ priority, at: weekly.at }))];
    writeMode(h.root, { countedStarts: history });
    const before = doRuns(h).length;

    await h.tick();

    assert.equal(doRuns(h).length, before + 1);
    assert.deepEqual(readMode(h.root).countedStarts, history);
  });
}

/** A do run that ends the way an agent ends it, by recording its branch. */
const endsOnABranch = h => request => {
  if (request.purpose !== 'work-do') return;
  updateItem(h.root, 'api', readItems(h.root, 'api')[0].id, { state: 'branch', branch: 'hobkin/rack' });
};

async function offeredDrafts(h) {
  await readyToDo(h);
  const offered = [];
  h.director.onDraftDone = draft => offered.push(draft);
  return offered;
}

test('nothing new starts while the main chat compacts, and the queue carries on by itself after', async t => {
  const h = fixture(t);
  await readyToDo(h);
  const started = doRuns(h).length;

  h.runtime.workWaitsForChat = true;
  await h.tick();
  assert.equal(doRuns(h).length, started);

  h.runtime.workWaitsForChat = false;
  await h.tick();
  assert.equal(doRuns(h).length, started + 1);
});

test('a work agent takes the user\'s words while it works, by its schedule, and not once it has finished', async t => {
  const h = fixture(t);
  await readyToDo(h);
  const heard = [];
  const ready = Promise.withResolvers();
  const finish = Promise.withResolvers();
  h.agent = async (request, { onReady }) => {
    if (request.purpose !== 'work-do') return;
    onReady(async message => { heard.push(message); return { disposition: 'queued' }; });
    ready.resolve();
    await finish.promise;
  };
  h.director.tick();
  await ready.promise;

  assert.deepEqual((await h.runner.messageCheck({})).running.map(({ scheduleId }) => scheduleId), ['work.api.do']);
  const queued = await h.runner.messageCheck({ scheduleId: 'work.api.do', message: 'Use the new client.' });
  finish.resolve();
  await h.settled();
  assert.deepEqual(queued, { scheduleId: 'work.api.do', status: 'queued' });
  assert.deepEqual(heard, ['Use the new client.']);
  await assert.rejects(h.runner.messageCheck({ scheduleId: 'work.api.do', message: 'Too late.' }), /not running/);
});

/** What an older hobkin, which ran work in terminal panes, wrote down as it closed for an agent it left at work, and a new hobkin on that home. */
async function leftInAPane(t, { reported = null } = {}) {
  const first = fixture(t);
  await readyToDo(first);
  const [{ id, title }] = readItems(first.root, 'api');
  updateItem(first.root, 'api', id, { state: reported ? 'branch' : 'doing', branch: 'hobkin/rack' });
  const report = join(first.base, 'report.md');
  if (reported) writeFileSync(report, reported);
  writeJson(join(first.root, 'work', 'handed.json'), [{
    harnessId: '11111111-2222-4333-8444-555555555555', slug: 'api', lane: 'do', item: id, title: `api: ${title}`, level: 'important', kind: 'do', estimate: {},
    model: 'fixture/main', effort: 'high', sessionFile: join(first.root, 'jobs', 'left.jsonl'), paneId: 'w1:p9', report, paneKind: 'pi', bound: false,
    startedAt: new Date(first.clock - HOUR).toISOString(), place: { cwd: join(first.base, 'api') },
  }]);
  return { next: fixture(t, undefined, first), id };
}

test('an agent an older hobkin left at work as it closed is settled from its report, with no new run for it', async t => {
  const { next } = await leftInAPane(t, { reported: 'Useful: Finished.\n' });
  const offered = [];
  next.director.onDraftDone = draft => offered.push(draft);

  await next.tick();
  await next.settled();

  assert.equal(next.calls.filter(call => call.purpose === 'work-do').length, 0, 'no new run was started for it');
  assert.equal(offered.length, 1);
  assert.equal(next.director.running().length, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(next.root, 'work', 'handed.json'), 'utf8')), [], 'it is picked up only once');
});

test('one with no report waits at the end of the queue for the user, since hobkin cannot see it end', async t => {
  const { next, id } = await leftInAPane(t);

  await next.tick();
  await next.settled();

  assert.deepEqual(readItems(next.root, 'api').map(({ state, attempts }) => [state, attempts]), [['open', 0]]);
  assert.ok(readMode(next.root).queueSkipped.includes(`item:api:${id}`));
  assert.deepEqual(JSON.parse(readFileSync(join(next.root, 'work', 'handed.json'), 'utf8')), []);
});

test('by default a finished branch gets no review and goes straight to landing', async t => {
  const h = fixture(t);
  const offered = await offeredDrafts(h);
  const [{ id }] = readItems(h.root, 'api');
  h.agent = endsOnABranch(h);

  await h.tick();
  await h.settled();

  assert.equal(readItems(h.root, 'api')[0].state, 'branch');
  assert.deepEqual(offered, [{ slug: 'api', id, title: 'Update rack', project: 'api' }]);
});

test('a note from the user is carried to its run, then cleared', async t => {
  const h = fixture(t);
  await offeredDrafts(h);
  const [{ id }] = readItems(h.root, 'api');
  updateItem(h.root, 'api', id, { state: 'branch', branch: 'hobkin/rack' });
  askAgent(h.root, 'api', id, 'Keep the old flag.');
  h.agent = endsOnABranch(h);

  await h.tick();
  await h.settled();

  assert.equal(h.work(doRuns(h).at(-1)).item.workNote, 'Keep the old flag.');
  assert.equal(readItems(h.root, 'api')[0].workNote, null);
});

test('a review that fails keeps its mark, so the next try is still that review', async t => {
  const h = fixture(t);
  await offeredDrafts(h);
  const [{ id }] = readItems(h.root, 'api');
  updateItem(h.root, 'api', id, { state: 'branch', branch: 'hobkin/rack' });
  requestReview(h.root, 'api', id);
  h.result = { status: 'failed', cost: null, error: 'The tests would not start.' };

  await h.tick();

  const [tried] = readItems(h.root, 'api');
  assert.deepEqual([tried.state, tried.reviewAsked, tried.attempts], ['open', true, 1]);
});

test('a rebase is no new draft, so it asks nothing', async t => {
  const h = fixture(t);
  const offered = await offeredDrafts(h);
  updateItem(h.root, 'api', readItems(h.root, 'api')[0].id, { kind: 'pr-fix' });
  h.agent = endsOnABranch(h);

  await h.tick();

  assert.deepEqual(offered, []);
});

test('a do run that ends without recording an outcome goes straight back in the queue, and the next run carries on from its branch knowing what it said', async t => {
  const h = fixture(t);
  await readyToDo(h);
  h.report = 'Useful: The parser is done.\n\nThe rest is on the branch.';

  await h.tick();

  const [tried] = readItems(h.root, 'api');
  assert.deepEqual([tried.state, tried.attempts, tried.lastError], ['open', 1, 'Useful: The parser is done.']);

  h.clock += HOUR;
  await h.tick();

  const { item: next } = h.work(doRuns(h).at(-1));
  assert.deepEqual([next.branch, next.attempts, next.lastError], [tried.branch, 1, tried.lastError]);
});

test('a run that said nothing still leaves the next one a reason', async t => {
  const h = fixture(t);
  await readyToDo(h);
  h.report = '';

  await h.tick();

  assert.equal(readItems(h.root, 'api')[0].lastError, 'The run ended without recording an outcome.');
});

test('a run that failed gives its error, ahead of anything it wrote', async t => {
  const h = fixture(t);
  await readyToDo(h);
  h.result = { status: 'failed', cost: null, text: 'Useful: Nearly there.', error: 'The tests would not start.' };

  await h.tick();

  assert.equal(readItems(h.root, 'api')[0].lastError, 'The tests would not start.');
});

const sessionLine = `${JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { input: 10, output: 10 } } })}\n`;
const goesQuiet = async request => {
  writeFileSync(request.sessionFile, sessionLine);
  await waitForAbort(request);
};

test('what a run spent is recorded against its own id, once its session can be counted', async t => {
  const h = fixture(t);
  await readyToDo(h);
  h.agent = request => { writeFileSync(request.sessionFile, sessionLine); };

  await h.tick();

  const spent = readEvents(h.root).filter(({ type }) => type === 'run_tokens').at(-1);
  assert.match(spent.id, /^work:api:do:/);
  assert.deepEqual([spent.tokens, spent.cached], [20, 0]);
});

test('each line of the token record carries the item its run worked on, and a look names none', async t => {
  const h = fixture(t);
  await readyToDo(h);
  h.agent = request => { writeFileSync(request.sessionFile, sessionLine); };

  await h.tick();

  const [{ id }] = readItems(h.root, 'api');
  assert.equal(tokenEvents(h.root).findLast(({ lane }) => lane === 'do').item, id);
  const looks = tokenEvents(h.root).filter(({ lane }) => lane === 'look');
  assert.ok(looks.length && looks.every(line => !('item' in line)), JSON.stringify(looks));
});

const untilStarted = async h => {
  await h.director.tick();
  while (!h.calls.length) await new Promise(resolve => setTimeout(resolve, 10));
  await h.director.tick();
};

test('a run whose session stops growing for an hour is a failed try, and its item goes straight back in the queue', async t => {
  const h = fixture(t);
  onlyItemsDue(h);
  fileItem(h.root, 'api', item);
  h.agent = goesQuiet;
  await untilStarted(h);

  h.clock += 59 * 60000;
  await h.director.tick();
  assert.equal(h.calls[0].signal.aborted, false, 'an hour has not gone by');

  h.clock += 60000;
  await h.tick();

  assert.equal(h.calls[0].signal.aborted, true);
  const [{ state, attempts, lastError }] = readItems(h.root, 'api');
  assert.deepEqual([state, attempts, lastError], ['open', 1, 'It went quiet for an hour.']);
  assert.deepEqual(readMode(h.root).queueSkipped, [], 'this is not the user cancelling it');
  assert.deepEqual(h.director.running(), [], 'its worker is free');
});

test('a session that grows starts the hour again', async t => {
  const h = fixture(t);
  onlyItemsDue(h);
  fileItem(h.root, 'api', item);
  h.agent = goesQuiet;
  await untilStarted(h);

  h.clock += 59 * 60000;
  appendFileSync(h.calls[0].sessionFile, sessionLine);
  await h.director.tick();
  h.clock += 59 * 60000;
  await h.director.tick();

  assert.equal(h.calls[0].signal.aborted, false);
  await h.runner.kill(h.director.running()[0].id);
  await h.settled();
});

test('a run with no session to read is left alone, however long it goes on', async t => {
  const h = fixture(t);
  onlyItemsDue(h);
  fileItem(h.root, 'api', item);
  const release = Promise.withResolvers();
  let signal;
  h.agent = async request => {
    ({ signal } = request);
    await release.promise;
  };
  await h.director.tick();
  while (!signal) await new Promise(resolve => setTimeout(resolve, 10));

  await h.director.tick();
  h.clock += 5 * HOUR;
  await h.director.tick();

  assert.equal(signal.aborted, false);
  release.resolve();
  await h.settled();
});

test('closing Hobkin on a quiet run keeps its item to resume, with nothing against it', async t => {
  const h = fixture(t);
  onlyItemsDue(h);
  fileItem(h.root, 'api', item);
  h.agent = goesQuiet;
  await untilStarted(h);
  h.runner.kill = async () => true;
  h.clock += HOUR;
  await h.director.tick();

  await h.runner.stop();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(readItems(h.root, 'api').map(({ state, attempts }) => [state, attempts]), [['doing', 0]]);
});

test('an item keeps coming round however many runs fail, each one knowing why the last did', async t => {
  const h = fixture(t);
  await readyToDo(h);
  // At P1 four runs a day is all it gets, and six tries in six hours is what this is about.
  setProjectPriority(h.root, 'api', 'P0');
  h.result = { status: 'failed', cost: null, error: 'The tests would not start.\nAnd a second line.' };

  for (let run = 0; run < 6; run++) {
    writeState(h.root, 'api', { lastLensAt: new Date(h.clock).toISOString() });
    await h.tick();
    h.clock += HOUR;
  }

  assert.equal(doRuns(h).length, 6);
  const [{ state, attempts, lastError }] = readItems(h.root, 'api');
  assert.deepEqual([state, attempts, lastError], ['open', 6, 'The tests would not start.']);
  assert.equal(h.work(doRuns(h).at(-1)).item.attempts, 5);
});

test('a do run is told where its PR description goes, and the folder for it is ready', async t => {
  const h = fixture(t);
  onlyItemsDue(h);
  const { id } = fileItem(h.root, 'api', item);
  let folderMode;
  h.agent = request => { folderMode = statSync(dirname(h.work(request).item.prFile)).mode & 0o777; };

  await h.tick();

  assert.equal(h.work(doRuns(h)[0]).item.prFile, prFile(h.root, 'api', id));
  assert.equal(folderMode, 0o700);
});

test('a fix writes to the description of the work it ships, not to one of its own', async t => {
  const h = fixture(t);
  onlyItemsDue(h);
  const { id } = fileItem(h.root, 'api', { key: 'ship:hobkin/old', kind: 'pr-fix', title: 'Rebase hobkin/old', brief: 'It conflicts.' });
  updateItem(h.root, 'api', id, { ships: 'abc123', branch: 'hobkin/old' });

  await h.tick();

  assert.equal(h.work(doRuns(h)[0]).item.prFile, prFile(h.root, 'api', 'abc123'));
});

test('an attention item is ordinary work, so a do run starts on it', async t => {
  const h = fixture(t);
  onlyItemsDue(h);
  const { id } = fileItem(h.root, 'api', { key: 'attention:deploy-key', kind: 'attention', title: 'The deploy key expired', brief: 'Deploys fail until it is renewed.' });

  await h.tick();

  assert.deepEqual(doRuns(h).map(call => h.work(call).item.id), [id]);
});

test('a folder that cannot be used only sends the run to a worktree', async t => {
  const h = fixture(t);
  const checkout = repository(h.base, 'api');
  const origin = withOrigin(h.base, checkout);
  const elsewhere = join(h.base, 'elsewhere');
  execFileSync('git', ['clone', '-q', origin, elsewhere]);
  git(elsewhere, 'config', 'user.email', 'other@example.com');
  git(elsewhere, 'config', 'user.name', 'Other');
  git(elsewhere, 'commit', '-q', '--allow-empty', '-m', 'theirs');
  git(elsewhere, 'push', '-q', 'origin', 'main');
  git(checkout, 'commit', '-q', '--allow-empty', '-m', 'mine');
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, checkout);
  studied(h, 'api');
  writeState(h.root, 'api', { lastIdeasAt: new Date(h.clock).toISOString() });
  const filed = fileItem(h.root, 'api', item);

  await h.tick();

  assert.deepEqual(doRuns(h).map(call => [call.cwd, h.work(call).place]), [[itemTree(h.root, 'api', filed), 'tree']]);
});

test('a do run that records its PR leaves the item alone', async t => {
  const h = fixture(t);
  h.agent = request => {
    study(h.root)(request);
    if (request.purpose === 'work-do') updateItem(h.root, 'api', h.work(request).item.id, { state: 'pr', pr: 'https://example.com/1' });
  };
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  fileItem(h.root, 'api', item);

  await h.ticks(3);

  assert.equal(readItems(h.root, 'api')[0].state, 'pr');
});

test('turning work mode off lets a running agent finish, starts nothing new and keeps every item', async t => {
  const finish = Promise.withResolvers();
  const h = fixture(t);
  h.agent = async (request) => {
    study(h.root)(request);
    if (request.purpose !== 'work-do') return;
    await finish.promise;
    updateItem(h.root, 'api', h.work(request).item.id, { state: 'pr', pr: 'https://example.com/1' });
  };
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  fileItem(h.root, 'api', item);
  fileItem(h.root, 'api', { ...item, key: 'second' });
  await h.ticks(2);
  await h.director.tick();
  while (!h.calls.some(call => call.purpose === 'work-do')) await new Promise(resolve => setTimeout(resolve, 20));

  writeMode(h.root, { enabled: false });
  await h.director.tick();
  assert.equal(h.calls.at(-1).signal.aborted, false, 'the agent was left to finish');
  assert.equal(h.director.running().length, 1);

  finish.resolve();
  await h.settled();
  await h.tick();

  assert.equal(h.calls.filter(call => call.purpose === 'work-do').length, 1, 'the second item waits');
  assert.deepEqual(readItems(h.root, 'api').map(({ state }) => state), ['pr', 'open']);
  assert.equal(readMode(h.root).enabled, false);
});

test('starting again picks up where stopping left off', async t => {
  const h = fixture(t);
  h.agent = study(h.root);
  writeMode(h.root, { enabled: false, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  fileItem(h.root, 'api', item);
  await h.tick();
  assert.deepEqual(h.calls, []);

  writeMode(h.root, { enabled: true });
  await h.tick();

  assert.deepEqual(h.purposes(), ['work-look']);
});

test('closing Hobkin keeps an item to resume, and cancelling one sends it to the skipped end of the queue', async t => {
  const h = fixture(t);
  h.agent = async request => {
    study(h.root)(request);
    if (request.purpose === 'work-do') await waitForAbort(request);
  };
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  fileItem(h.root, 'api', item);
  fileItem(h.root, 'api', { ...item, key: 'second' });
  await h.ticks(2);
  await h.director.tick();
  while (!h.calls.some(call => call.purpose === 'work-do')) await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(await h.runner.kill(h.director.running().find(run => run.lane === 'do').id), true);
  await h.settled();
  await new Promise(resolve => setImmediate(resolve));

  const [cancelled] = readItems(h.root, 'api');
  assert.deepEqual(readItems(h.root, 'api').map(({ state }) => state), ['open', 'open']);
  assert.deepEqual(readMode(h.root).queueSkipped, [`item:api:${cancelled.id}`], 'a cancelled item stays in sight and does not start again by itself');
  assert.equal(cancelled.attempts, 0, 'stopping it was the user\'s choice, so it is not a try that failed');

  while (doRuns(h).length < 2) {
    await h.director.tick();
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(h.work(doRuns(h)[1]).item.key, 'second');
  await h.runner.stop();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(readItems(h.root, 'api').map(({ state }) => state), ['open', 'doing'], 'closing keeps the item to resume');
});

test('a look that fails shows on its project until one works', async t => {
  const h = fixture(t);
  let broken = true;
  h.agent = async request => {
    if (broken) throw Error('The clone is gone.');
    study(h.root)(request);
  };
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));

  await h.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(readState(h.root, 'api').lookError, /The clone is gone/);

  broken = false;
  h.clock += 20 * 60000;
  await h.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readState(h.root, 'api').lookError, null);
});

test('a background Pi run is tracked by its app job and session', async t => {
  const h = fixture(t);
  const release = Promise.withResolvers();
  h.agent = () => release.promise;
  t.after(() => release.resolve());
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));

  await h.director.tick();
  while (!Object.keys(h.runtime.data.runs).length) await new Promise(resolve => setTimeout(resolve, 20));

  const [run] = Object.values(h.runtime.data.runs);
  assert.deepEqual([run.status, run.harness, run.work.slug, run.work.lane], ['running', 'pi', 'api', 'look']);
  assert.equal(h.director.running()[0].id, run.id);
  assert.equal(h.director.running()[0].sessionFile, join(h.root, 'jobs', `${run.harnessId}.jsonl`));
  release.resolve();
  await h.settled();
});

test('work runs do not take a place from ordinary checks', async t => {
  const release = Promise.withResolvers();
  const h = fixture(t);
  h.agent = async () => { await release.promise; };
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'one'));
  chooseProject(h.root, repository(h.base, 'two'));
  chooseProject(h.root, repository(h.base, 'three'));
  while (h.calls.length < 2) {
    await h.director.tick();
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  assert.equal(h.runner.scheduledJobCount(await h.runtime.state()), 0);

  release.resolve();
  await h.settled();
});

test('lessons reach a background Pi work agent in its request', async t => {
  const h = fixture(t);
  initialize(h.root, { cwd: h.base });
  setLearning(h.root, true);
  saveState(h.root, { lessons: [{ id: 'a', scope: 'site-audit', code: 'blocked', seen: 5, latest: new Date(h.clock).toISOString() }], proposals: [], pullRequests: {} });
  writeMode(h.root, { enabled: true, folder: h.base, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'billing'));

  await h.director.tick();
  await h.settled?.();
  await Promise.all([...h.runner.jobs.values()]);

  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].prompt, /"learning":\["learned: advice only[^"]*","-site-audit blocked x5: do the rest, name what stopped it"\]/);
});

test('a failed background Pi run records its item error and attempt', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  fileItem(h.root, 'api', item);
  studied(h, 'api');
  writeState(h.root, 'api', { lastIdeasAt: new Date(h.clock).toISOString() });
  h.result = { status: 'failed', cost: null, error: 'The agent exited.' };

  await h.tick();

  assert.deepEqual(readItems(h.root, 'api').map(({ state, attempts, lastError }) => [state, attempts, lastError]), [['open', 1, 'The agent exited.']]);
});

test('an interrupted background Pi run reopens its item without a failed attempt', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  fileItem(h.root, 'api', item);
  studied(h, 'api');
  writeState(h.root, 'api', { lastIdeasAt: new Date(h.clock).toISOString() });
  h.result = { status: 'interrupted', cost: null, error: 'Harness cancelled.' };

  await h.tick();

  const [filed] = readItems(h.root, 'api');
  assert.deepEqual([filed.state, filed.attempts], ['open', 0]);
  assert.deepEqual(readMode(h.root).queueSkipped, [`item:api:${filed.id}`]);
});

test('a run whose folder is gone spends no tokens, however often it comes round', async t => {
  const h = fixture(t);
  const checkout = repository(h.base, 'api');
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, checkout);
  fileItem(h.root, 'api', item);
  studied(h, 'api');
  writeState(h.root, 'api', { lastIdeasAt: new Date(h.clock).toISOString() });
  rmSync(checkout, { recursive: true, force: true });

  for (let run = 0; run < 3; run++) {
    await h.tick();
    h.clock += HOUR;
  }

  assert.deepEqual(readItems(h.root, 'api').map(({ state, attempts }) => [state, attempts]), [['open', 3]]);
  assert.equal(h.calls.length, 0, 'folder preparation failed before the harness could start');
  assert.equal(tokensToday(h.root, h.clock), 0);
});

const brokenProject = h => {
  const checkout = repository(h.base, 'api');
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, checkout);
  studied(h, 'api');
  writeState(h.root, 'api', { lastIdeasAt: new Date(h.clock).toISOString() });
  rmSync(checkout, { recursive: true, force: true });
};

test('a run that fails before it spends anything still leaves its mark, so a broken project is not lifted as left alone', async t => {
  const h = fixture(t);
  brokenProject(h);
  fileItem(h.root, 'api', item);

  assert.match(planWork(h.root, { now: h.clock }).entries[0].why, /^left alone/, 'with no mark it goes ahead of the rest');
  await h.tick();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(tokenEvents(h.root).map(({ slug, lane, kind, tokens, cached, estimated }) => ({ slug, lane, kind, tokens, cached, estimated })), [
    { slug: 'api', lane: 'do', kind: 'do', tokens: 0, cached: 0, estimated: true },
  ]);
  assert.doesNotMatch(planWork(h.root, { now: h.clock }).entries[0].why, /left alone/);
});

test('a max run that never started uses up none of the day\'s max runs, and teaches the plan no cost', async t => {
  const h = fixture(t);
  brokenProject(h);
  const { id } = fileItem(h.root, 'api', item);
  updateItem(h.root, 'api', id, { max: true });

  await h.tick();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(tokenEvents(h.root).length, 1);
  assert.equal(tokenEvents(h.root)[0].level, undefined);
  const { budget, entries } = planWork(h.root, { now: h.clock });
  assert.equal(budget.maxRuns, 0);
  assert.deepEqual(entries[0].estimate, firstGuess.do);
});

test('a folder moved under a run only ended that run, so the item is not sent to the skipped end', async t => {
  const h = fixture(t);
  const checkout = repository(h.base, 'api');
  h.agent = waitForAbort;
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, checkout);
  fileItem(h.root, 'api', item);
  studied(h, 'api');
  writeState(h.root, 'api', { lastIdeasAt: new Date(h.clock).toISOString() });
  await h.director.tick();
  while (!h.director.running()[0]?.folder) await new Promise(resolve => setTimeout(resolve, 10));

  // With the mode off the tick stops the run and starts nothing, so what is on disk is what this run left.
  writeMode(h.root, { enabled: false });
  git(checkout, 'switch', '-q', 'main');
  await h.tick();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(readItems(h.root, 'api').map(({ state, attempts }) => [state, attempts]), [['open', 0]]);
  assert.deepEqual(readMode(h.root).queueSkipped, []);
});

test('the user\'s directions reach every run', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  mkdirSync(paths(h.root, 'api').directory, { recursive: true });
  writeFileSync(paths(h.root, 'api').directions, 'Leave the auth code alone.\n');

  await h.tick();

  assert.match(h.work(h.calls[0]).directions, /Leave the auth code alone/);
  assert.match(readFileSync(paths(h.root, 'api').directions, 'utf8'), /auth/);
});

test('Work descendant accounting recomputes own cumulative usage and genuine activity', { timeout: 10000 }, async t => {
  const { budgetFor } = await import('../src/cli/work/budget.mjs');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'work-descendant-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let clock = Date.parse('2026-06-01T12:00:00Z');
  const kills = [], rows = [];
  const director = new WorkDirector({ root, config, now: () => clock,
    runtime: { ownedLifecycle: { snapshot: id => id === 'synthetic-parent' ? rows : null } },
    runner: { kill: async id => kills.push(id) } });
  const file = join(root, 'parent.jsonl');
  writeFileSync(file, `${JSON.stringify({ id: 'synthetic-session' })}\n${JSON.stringify({ message: { role: 'assistant', usage: { input: 10, output: 2, cacheWrite: 3, cacheRead: 7 } } })}\n`);
  const parent = { id: 'synthetic-parent', sessionFile: file, estimate: { fresh: 100 }, kind: 'look', level: 'important' };
  director.active.set('synthetic', parent);
  const child = (id, parentId, input, status = 'running') => ({ id, parentId, rootId: parent.id, status, lastActivityAt: clock,
    usage: { incomplete: false, sealed: status === 'completed', ...Object.fromEntries(['input', 'output', 'cacheWrite', 'cacheRead'].map(field => [field, { value: field === 'input' ? input : 0, state: 'complete' }])) } });
  rows.push(child('synthetic-child', parent.id, 20), child('synthetic-grandchild', 'synthetic-child', 30));
  rows[0].usage.cacheRead.value = 4;
  rows.push(rows[0], { ...child('foreign-child', parent.id, 999), rootId: 'foreign-parent' });
  director.meterRuns(); director.meterRuns();
  assert.deepEqual([parent.tokens, parent.cached, parent.meter.tokens], [65, 11, 15]);
  assert.equal(budgetFor(root, { dailyTokens: 10000 }, clock, [parent]).reserved, 235);
  clock += HOUR + 1;
  rows[1].lastActivityAt = clock;
  director.meterRuns();
  assert.deepEqual(kills, []);
  clock += HOUR + 1;
  director.meterRuns(); director.meterRuns();
  assert.deepEqual(kills, [parent.id], 'passive reads must not refresh activity');
  rows[0].status = 'failed'; rows[0].usage.incomplete = true;
  rows[1].status = 'completed';
  director.meterRuns();
  assert.equal(parent.tokens, 65, 'terminal incomplete usage retains the lower bound');
  assert.equal(director.running().length, 1, 'terminal children do not settle the parent');
});

test('Work descendant admission refreshes reservations and only parent completion settles once', { timeout: 10000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'work-descendant-admission-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ready = Promise.withResolvers(), ending = Promise.withResolvers(), finished = Promise.withResolvers();
  let request, execution, options;
  const rows = [];
  let clock = Date.parse('2026-06-01T12:00:00Z');
  const runner = { jobs: new Map(), inboxes: new Map(), onActivity() {},
    startTracked(admission, effect) { request = admission; execution = effect(new AbortController().signal); return { work: finished.promise }; } };
  const runtime = { state: async () => ({ runs: {} }), ownedLifecycle: { snapshot: id => id === request.id ? rows : null } };
  writeMode(root, { enabled: true, dailyTokens: 12000 });
  const director = new WorkDirector({ root, config, runtime, runner, now: () => clock,
    runHarness: async (parent, callbacks) => {
      options = callbacks;
      writeFileSync(parent.sessionFile, `${JSON.stringify({ id: 'synthetic-parent-session' })}\n${JSON.stringify({ message: { role: 'assistant', usage: { input: 10, output: 0, cacheWrite: 0, cacheRead: 0 } } })}\n`);
      ready.resolve();
      await ending.promise;
      return { id: parent.id, sessionId: 'synthetic-parent-session', status: 'completed' };
    } });
  director.start({ key: 'synthetic-parent', lane: 'look', kind: 'look', title: 'Synthetic parent', cwd: root,
    level: 'important', estimate: { fresh: 100, cached: 20 }, model: 'fixture/local', effort: 'medium', work: () => ({}) });
  await ready.promise;
  const parent = director.running()[0];
  await t.test('synchronous admission', () => {
    const admit = () => options.beforeSpawn({ rootId: request.id, parentId: request.id });
    assert.equal(typeof options.beforeSpawn, 'function');
    director.lastStartAt = clock;
    writeMode(root, { agents: 1, countedStarts: [{ priority: 'P3', at: new Date(clock).toISOString() }] });
    assert.equal(admit(), true, 'parent slot, start gap and P3 count are not charged again');
    assert.equal(options.beforeSpawn({ rootId: 'foreign-root', parentId: request.id }), false);
    for (const change of [{ enabled: false }, { pausedAt: new Date(clock).toISOString() },
      { usagePause: { until: new Date(clock + HOUR).toISOString() } }, { subscriptionPause: { until: new Date(clock + HOUR).toISOString() } }]) {
      writeMode(root, change);
      assert.equal(admit(), false);
      writeMode(root, { enabled: true, pausedAt: null, usagePause: null, subscriptionPause: null });
    }
    parent.declined = true;
    assert.equal(admit(), false);
    parent.declined = false;
    rows.push({ id: 'synthetic-child', rootId: request.id, parentId: request.id, status: 'queued', lastActivityAt: null, usage: null });
    assert.equal(admit(), true);
    assert.equal(parent.childReserved, 100, 'queued helper has its own full reservation');
    rows[0].status = 'running';
    assert.equal(options.beforeSpawn({ rootId: request.id, parentId: 'synthetic-child' }), true);
    rows[0].status = 'unknown';
    assert.equal(admit(), false);
    rows[0].status = 'running';
    writeMode(root, { dailyTokens: 1800 });
    parent.grade = 'P0';
    assert.equal(admit(), false, 'routine look still observes hour share');
    parent.kind = 'study';
    assert.equal(admit(), true, 'existing non-look P0 hour exemption');
    writeMode(root, { dailyTokens: 150 });
    assert.equal(admit(), false, 'P0 cannot bypass daily budget');
    assert.equal(rows.length, 1, 'refusal allocates nothing');
    assert.equal(director.lastStartAt, clock);
    writeMode(root, { dailyTokens: 12000 });
    const project = chooseProject(root, root, 'casual', clock);
    parent.slug = project.slug;
    assert.equal(admit(), true);
    skipProject(root, project.slug);
    assert.equal(admit(), false, 'a newly skipped project is held');
    parent.slug = undefined;
  });
  const complete = value => ({ value, state: 'complete' });
  rows[0] = { id: 'synthetic-child', rootId: request.id, parentId: request.id, status: 'completed', usage: { incomplete: false, sealed: true,
    input: complete(0), output: complete(0), cacheWrite: complete(0), cacheRead: complete(0) } };
  director.meterRuns();
  assert.equal(tokenEvents(root).length, 0, 'child completion is not parent completion');
  rows[0].usage.input = complete(5);
  rows[0].usage.incomplete = true;
  director.meterRun(parent);
  clock += 2 * HOUR;
  director.meterRun(parent); director.meterRun(parent);
  ending.resolve();
  const result = await execution;
  finished.resolve({ ...request, status: 'completed', result });
  await director.closing;
  assert.deepEqual(tokenEvents(root).map(({ tokens, cached, usageIncomplete }) => [tokens, cached, usageIncomplete]), [[15, 0, true]]);
  assert.equal(tokenEvents(root)[0].incompleteEvents['synthetic-child'], new Date(clock - 2 * HOUR).toISOString());
  rows[0].usage.input = complete(999);
  director.meterRuns();
  assert.equal(tokenEvents(root).length, 1, 'late child facts cannot append another settlement');
  assert.equal(director.running().length, 0);
  assert.equal(options.beforeSpawn({ rootId: request.id, parentId: request.id }), false);
});

test('Work descendant empty max settlement does not use the daily max budget', { timeout: 10000 }, async t => {
  const h = fixture(t);
  const sessionId = 'synthetic-max-session';
  const runParent = async (key, input) => {
    h.agent = request => {
      const entries = [{ type: 'session', id: sessionId }];
      if (input !== null) {
        entries.push({
          type: 'message',
          message: { role: 'assistant', usage: { input, output: 0 } },
        });
      }
      writeFileSync(request.sessionFile, `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`);
      h.result = { id: request.id, sessionId, status: 'failed', error: 'No output.' };
    };
    h.director.start({ key, lane: 'do', title: 'Synthetic max parent', purpose: 'work-do', cwd: h.root,
      level: 'max', kind: 'do', model: 'fixture/main', effort: 'xhigh', work: () => ({}) });
    await h.settled();
  };
  await runParent('empty-max', null);
  const [empty] = tokenEvents(h.root);
  assert.deepEqual([empty.kind, empty.level, empty.startedAt, empty.estimated], ['do', undefined, new Date(h.clock).toISOString(), true]);
  assert.equal(planWork(h.root, { now: h.clock }).budget.maxRuns, 0);
  await runParent('measured-max', 10);
  const runs = Object.values(h.runtime.data.runs);
  assert.ok(runs.every(run => run.harnessId === run.result.id && run.result.sessionId === sessionId));
  assert.equal(tokenEvents(h.root)[1].tokens, 10);
  assert.equal(tokenEvents(h.root)[1].level, 'max');
  assert.equal(planWork(h.root, { now: h.clock }).budget.maxRuns, 1);
});

test('two items of one project run at once, each kept and settled on its own', { timeout: 20000 }, async t => {
  const h = fixture(t);
  const checkout = repository(h.base, 'api');
  const gates = new Map();
  h.agent = request => {
    if (request.purpose !== 'work-do') return undefined;
    const gate = Promise.withResolvers();
    gates.set(h.work(request).item.id, gate);
    return gate.promise;
  };
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, checkout);
  fileItem(h.root, 'api', item);
  fileItem(h.root, 'api', { ...item, key: 'update:other', title: 'Update other' });
  const project = readProject(h.root, 'api');
  const [first, second] = readItems(h.root, 'api');

  h.director.startDo(project, first);
  h.director.startDo(project, second);

  assert.equal(h.director.running().filter(run => run.slug === 'api' && run.lane === 'do').length, 2, 'neither run replaced the other');
  assert.deepEqual(h.director.running().map(run => run.item).sort(), [first.id, second.id].sort());
  await new Promise(resolve => setTimeout(resolve, 200));
  gates.get(first.id)?.resolve();
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual(h.director.running().map(run => run.item), [second.id], 'the first run settled and left the second');
  assert.notEqual(readItems(h.root, 'api').find(entry => entry.id === first.id).state, 'doing');
  gates.get(second.id)?.resolve();
  await h.settled();
  assert.deepEqual(h.director.running(), []);
  assert.notEqual(readItems(h.root, 'api').find(entry => entry.id === second.id).state, 'doing');
});

test('a durable hobkin turn takes no worker, and a work run or a routine does', t => {
  const h = fixture(t);
  h.runner.jobs.set('hobkin:deadbeef:1', Promise.resolve());
  assert.equal(h.director.outlook().checks, 0);
  h.runner.jobs.set('work:api:do', Promise.resolve());
  assert.equal(h.director.outlook().checks, 0, 'a work run is counted as a run, not a check');
  h.runner.jobs.set('routine-1', Promise.resolve());
  assert.equal(h.director.outlook().checks, 1);
});
