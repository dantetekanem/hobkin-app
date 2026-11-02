import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { initialize, setLearning } from '../src/cli/config.mjs';
import { saveState } from '../src/cli/learning/store.mjs';
import { HobkinRunner } from '../src/cli/runner.mjs';
import { firstGuess } from '../src/cli/work/budget.mjs';
import { askAgent, requestReview } from '../src/cli/work/controls.mjs';
import { WorkDirector } from '../src/cli/work/director.mjs';
import { planWork } from '../src/cli/work/plan.mjs';
import {
  answerAllowance, chooseProject, fileItem, noteDiscovery, paths, pickNext, prFile, proposeProject, readDiscovery, readItems, readMode, readState, recordDiscovery, recordTokens,
  setProjectPrMode, skipProject, startWork, tokenEvents, tokensToday, updateItem, writeMode, writeState,
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
  writeMode(root, { startGapMs: 0 });
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

const study = root => (request) => {
  if (request.purpose === 'work-look' && !existsSync(paths(root, 'api').project)) {
    writeFileSync(paths(root, 'api').project, '# What it is\n\nAn API.\n');
  }
};

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

test('a discovery run is told what the user has authorized, as every other run is', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();

  assert.match(h.work(h.calls[0]).authorization, /already authorized everything this run needs/);
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

test('turning work mode on with nothing to show looks at once, whatever the clock says', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: false, folder: '/repos', lastDiscoveryAt: hoursAgo(h, 22.6) });

  startWork(h.root);
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
  startWork(h.root);
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
  startWork(h.root);
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

  startWork(h.root, h.base);
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
  startWork(h.root);
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
  writeState(h.root, slug, { lastLensAt: new Date(h.clock).toISOString() });
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

test('a pane run is costed from its session like any other', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  h.director.panes = {
    run: async options => {
      writeFileSync(options.sessionFile, [
        { type: 'session', id: 'pane-session' },
        { type: 'message', message: { role: 'assistant', usage: { input: 100, output: 50, cost: { total: 0.2 } } } },
      ].map(entry => JSON.stringify(entry)).join('\n'));
      return { status: 'completed', text: 'Useful: Done.', cost: null };
    },
  };

  await h.tick();
  await new Promise(resolve => setImmediate(resolve));

  const run = Object.values(h.runtime.data.runs)[0];
  assert.deepEqual(run.result.cost, { usd: 0.2, kind: 'estimate', cumulative: true, sessionId: 'pane-session' });
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
  if (done) updateItem(h.root, slug, done.id, { state: 'pr', pr: 'https://example.com/1' });
};

test('level sets model and effort', async t => {
  const h = fixture(t);
  h.agent = doesItsJob(h);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'billing'), 'critical');
  chooseProject(h.root, repository(h.base, 'site'), 'casual');
  fileItem(h.root, 'billing', item);
  fileItem(h.root, 'site', item);
  await h.ticks(8);

  const run = (slug, purpose) => h.calls.find(call => call.purpose === purpose && h.work(call).project.slug === slug);
  assert.deepEqual([run('billing', 'work-do').model, run('billing', 'work-do').effort], ['fixture/main', 'xhigh']);
  assert.deepEqual([run('billing', 'work-look').effort], ['high']);
  assert.deepEqual([run('site', 'work-do').model, run('site', 'work-do').effort], ['fixture/background', 'medium']);
});

test('a run lands the way its project says, whatever its level, and stays a local branch until the project says otherwise', async t => {
  const h = fixture(t);
  h.agent = doesItsJob(h);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'billing'), 'casual');
  chooseProject(h.root, repository(h.base, 'site'), 'critical');
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

/** A new hobkin on the same home, with panes that only answer for what was left going. */
function reopened(t, first) {
  const next = fixture(t, undefined, first);
  next.ran = [];
  next.director.panes = {
    awaitHanded: first.director.panes.awaitHanded,
    run: async request => {
      next.ran.push(request);
      return { status: 'completed', text: 'Useful: Done.', cost: null };
    },
    closeLeftovers: async () => {},
  };
  return next;
}

async function agentInAPane(h) {
  await readyToDo(h);
  const started = Promise.withResolvers();
  const report = join(h.base, 'report.md');
  h.director.follow = run => h.followed.push(run);
  h.followed = [];
  h.director.panes = {
    release: () => { h.released = true; },
    run: async ({ signal, onStarted }) => {
      onStarted('w1:p9', report);
      started.resolve();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      return { status: 'interrupted', cost: null, handedOff: true, error: 'Left running.' };
    },
    awaitHanded: async ({ report: file }) => (existsSync(file) ? { status: 'completed', text: readFileSync(file, 'utf8'), cost: null } : { status: 'interrupted', cost: null, paneClosed: true, error: 'Gone.' }),
    closeLeftovers: async () => {},
  };
  h.director.tick();
  await started.promise;
  return report;
}

test('closing with an agent at work leaves it going: written down, followed, its folder and tokens untouched', async t => {
  const h = fixture(t);
  await agentInAPane(h);
  const [{ id }] = readItems(h.root, 'api');
  assert.equal(h.director.agentsInPanes().length, 1);
  const tokensBefore = tokenEvents(h.root).length;

  h.director.handOff();
  await h.runner.stop();
  await h.director.closing;

  const [item] = readItems(h.root, 'api');
  assert.equal(item.state, 'doing', 'it is still that agent\'s');
  assert.equal(h.released, true);
  assert.deepEqual(h.followed.map(({ pane, kind }) => [pane, kind]), [['w1:p9', 'handed']]);
  assert.equal(tokenEvents(h.root).length, tokensBefore);
  assert.deepEqual(JSON.parse(readFileSync(join(h.root, 'work', 'handed.json'), 'utf8')).map(run => run.item), [id]);
});

test('the next hobkin picks a finished agent up and settles it as if it had never left', async t => {
  const first = fixture(t);
  const report = await agentInAPane(first);
  const [{ id }] = readItems(first.root, 'api');
  first.director.handOff();
  await first.runner.stop();
  await first.director.closing;
  updateItem(first.root, 'api', id, { state: 'branch', branch: 'hobkin/rack' });
  writeFileSync(report, 'Useful: Finished.\n');

  const next = reopened(t, first);
  const offered = [];
  next.director.onDraftDone = draft => offered.push(draft);
  writeMode(next.root, { reviewOnFinish: false });

  await next.tick();
  await next.settled();

  assert.equal(next.ran.filter(({ name }) => name.startsWith('work-do')).length, 0, 'no new run was started for it');
  assert.equal(offered.length, 1);
  assert.ok(tokenEvents(next.root).some(event => event.lane === 'do'));
  assert.equal(next.director.running().length, 0);
});

test('an agent that ended with no report goes back in the queue, and is picked up only once', async t => {
  const first = fixture(t);
  await agentInAPane(first);
  first.director.handOff();
  await first.runner.stop();
  await first.director.closing;

  const next = reopened(t, first);
  await next.tick();
  await next.settled();

  assert.equal(readItems(next.root, 'api')[0].state, 'open');
  assert.deepEqual(JSON.parse(readFileSync(join(next.root, 'work', 'handed.json'), 'utf8')), []);
});

test('with no agent in a pane there is nothing to hand off', async t => {
  const h = fixture(t);
  await readyToDo(h);

  h.director.handOff();

  assert.equal(existsSync(join(h.root, 'work', 'handed.json')), false);
});

test('a finished branch gets its review next by itself, and only then can it land', async t => {
  const h = fixture(t);
  const offered = await offeredDrafts(h);
  const [{ id }] = readItems(h.root, 'api');
  h.agent = endsOnABranch(h);

  await h.tick();
  await h.settled();

  assert.equal(h.work(doRuns(h).at(-1)).item.reviewAsked, undefined);
  assert.deepEqual([readItems(h.root, 'api')[0].state, readItems(h.root, 'api')[0].reviewAsked], ['open', true]);
  assert.deepEqual(offered, []);

  await h.tick();
  await h.settled();

  assert.equal(h.work(doRuns(h).at(-1)).item.reviewAsked, true);
  assert.equal(readItems(h.root, 'api')[0].reviewAsked, false);
  assert.deepEqual(offered, [{ slug: 'api', id, title: 'Update rack', project: 'api' }]);
});

test('with reviews off, a finished branch goes straight to landing', async t => {
  const h = fixture(t);
  const offered = await offeredDrafts(h);
  writeMode(h.root, { reviewOnFinish: false });
  h.agent = endsOnABranch(h);

  await h.tick();
  await h.settled();

  assert.equal(readItems(h.root, 'api')[0].state, 'branch');
  assert.equal(offered.length, 1);
});

test('a note from the user is carried to its run, then cleared, and the new commits get their review', async t => {
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
  assert.equal(readItems(h.root, 'api')[0].reviewAsked, true);
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
  writeMode(h.root, { harness: 'claude' });
  const release = Promise.withResolvers();
  let signal;
  h.director.panes = {
    run: async options => {
      ({ signal } = options);
      await release.promise;
      return { status: 'completed', text: 'Useful: Done.', cost: null };
    },
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
  fileItem(h.root, 'api', item);

  await h.tick();

  assert.deepEqual(doRuns(h).map(call => [call.cwd, h.work(call).place]), [[paths(h.root, 'api').doTree, 'tree']]);
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

test('a pane run says which pane it is in', async t => {
  const h = fixture(t);
  const release = Promise.withResolvers();
  h.director.panes = {
    run: async () => {
      await release.promise;
      return { status: 'completed', text: 'Useful: Done.', cost: null };
    },
  };
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));

  await h.director.tick();
  while (!Object.keys(h.runtime.data.runs).length) await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(Object.values(h.runtime.data.runs)[0].work.pane, 'work-look-api');
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

test('lessons reach a work agent in its request, and in the brief of a pane on any harness', async t => {
  const h = fixture(t);
  initialize(h.root, { cwd: h.base });
  setLearning(h.root, true);
  saveState(h.root, { lessons: [{ id: 'a', scope: 'site-audit', code: 'blocked', seen: 5, latest: new Date(h.clock).toISOString() }], proposals: [], pullRequests: {} });
  const briefs = [];
  h.director.panes = {
    run: async options => {
      briefs.push(readFileSync(options.brief, 'utf8'));
      return { status: 'completed', text: 'Nothing new.', cost: null };
    },
  };
  writeMode(h.root, { enabled: true, folder: h.base, harness: 'claude', lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'billing'));

  await h.director.tick();
  await h.settled?.();
  await Promise.all([...h.runner.jobs.values()]);

  assert.equal(briefs.length, 1);
  assert.match(briefs[0], /"learning":\["learned: advice only[^"]*","-site-audit blocked x5: do the rest, name what stopped it"\]/);
});

test('in Herdr, project work runs in panes on the chosen harness while discovery stays hidden', async t => {
  const h = fixture(t);
  const runs = [];
  h.director.panes = {
    run: async options => {
      runs.push({ ...options, briefText: readFileSync(options.brief, 'utf8') });
      return { status: 'completed', text: 'Useful: Done.', cost: null };
    },
  };
  writeMode(h.root, { enabled: true, folder: h.base, harness: 'claude' });
  chooseProject(h.root, repository(h.base, 'api'));

  await h.ticks(2);

  assert.deepEqual(h.purposes(), ['work-discover']);
  assert.equal(runs.length, 1);
  const [look] = runs;
  assert.deepEqual([look.kind, look.name, look.cwd], ['claude', 'work-look-api', paths(h.root, 'api').lookTree]);
  assert.equal(look.effort, 'medium');
  assert.match(look.briefText, /Hobkin background check/);
  assert.match(look.briefText, /look at a project/);
  assert.ok(look.briefText.includes(look.report), 'the brief names where to write the report');
  assert.match(look.briefText, /"focus":"study"/);
});

test('a failed pane run counts against its item like any other', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  fileItem(h.root, 'api', item);
  studied(h, 'api');
  writeState(h.root, 'api', { lastIdeasAt: new Date(h.clock).toISOString() });
  h.director.panes = { run: async () => ({ status: 'failed', cost: null, error: 'The agent exited.' }) };

  await h.tick();

  assert.deepEqual(readItems(h.root, 'api').map(({ state, attempts, lastError }) => [state, attempts, lastError]), [['open', 1, 'The agent exited.']]);
});

test('a pane closed by hand only ended that run, so the item stays in the plan with nothing against it', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  fileItem(h.root, 'api', item);
  studied(h, 'api');
  writeState(h.root, 'api', { lastIdeasAt: new Date(h.clock).toISOString() });
  h.director.panes = { run: async () => ({ status: 'interrupted', cost: null, paneClosed: true, error: 'The pane was closed by hand.' }) };

  await h.tick();

  assert.deepEqual(readItems(h.root, 'api').map(({ state, attempts }) => [state, attempts]), [['open', 0]]);
  assert.deepEqual(readMode(h.root).queueSkipped, []);
});

test('a run that never reached a pane costs nothing, however often it comes round', async t => {
  const h = fixture(t);
  const checkout = repository(h.base, 'api');
  writeMode(h.root, { enabled: true, harness: 'claude', lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, checkout);
  fileItem(h.root, 'api', item);
  studied(h, 'api');
  writeState(h.root, 'api', { lastIdeasAt: new Date(h.clock).toISOString() });
  h.director.panes = { run: async () => assert.fail('No pane should open.') };
  rmSync(checkout, { recursive: true, force: true });

  for (let run = 0; run < 3; run++) {
    await h.tick();
    h.clock += HOUR;
  }

  assert.deepEqual(readItems(h.root, 'api').map(({ state, attempts }) => [state, attempts]), [['open', 3]]);
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
