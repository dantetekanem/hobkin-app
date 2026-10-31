import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinRunner } from '../src/cli/runner.mjs';
import { WorkDirector } from '../src/cli/work/director.mjs';
import {
  answerAllowance, chooseProject, fileItem, noteDiscovery, paths, proposeProject, readDiscovery, readItems, readMode, readState, recordDiscovery, recordTokens,
  skipProject, startWork, tokensToday, updateItem, writeMode, writeState,
} from '../src/cli/work/store.mjs';

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

function fixture(t, agent = async () => {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-director-')));
  const root = join(base, 'home');
  mkdirSync(root);
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const h = { base, root, clock: Date.parse('2026-06-01T12:00:00Z'), calls: [], changes: 0, agent };
  const runtime = new MemoryRuntime();
  const runner = new HobkinRunner({ runtime, root, config, now: () => new Date(h.clock) });
  h.runtime = runtime;
  h.runner = runner;
  h.director = new WorkDirector({
    root,
    config,
    runner,
    runtime,
    now: () => h.clock,
    onChange: () => { h.changes++; },
    runHarness: async (request, options) => {
      h.calls.push(request);
      await h.agent(request, options);
      // A discovery that does its job reports every root folder finished.
      if (request.purpose === 'work-discover' && !h.stopsEarly) noteDiscovery(root, { rootFolders: ['everything'], finishedFolders: ['everything'] });
      return { status: request.signal.aborted ? 'interrupted' : 'completed', text: h.report ?? 'Useful: Done.' };
    },
  });
  h.settled = async () => {
    await Promise.all([...runner.jobs.values()]);
  };
  h.tick = async () => {
    await h.director.tick();
    await h.settled();
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

test('with no folder named, nothing goes looking', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true });

  await h.tick();

  assert.deepEqual(h.calls, []);
});

test('turning work mode on sends the agent to the folder the user named, once a day', async t => {
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
  assert.deepEqual(h.purposes(), ['work-discover', 'work-discover']);
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
  assert.equal(h.calls.length, 2);
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

test('a daily look with nothing new stays out of Chat once its proposals have been told', async t => {
  const h = fixture(t);
  h.agent = offering(h, 'billing');
  writeMode(h.root, { enabled: true, folder: '/repos' });
  await h.tick();
  assert.match(readDiscovery(h.root).message, /billing/);

  h.clock += 25 * HOUR;
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

test('a run that says it is blocked is told at once instead of paying to find out again', async t => {
  const h = fixture(t);
  h.stopsEarly = true;
  h.report = 'Blocked: The folder cannot be read.';
  writeMode(h.root, { enabled: true, folder: '/repos' });

  await h.tick();
  await h.tick();

  assert.equal(h.calls.length, 1);
  assert.equal(readDiscovery(h.root).status, 'unfinished');
  assert.match(readDiscovery(h.root).message, /cannot be read/);
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

test('after the study the agent looks for work and starts on what is open', async t => {
  const h = fixture(t);
  h.agent = study(h.root);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  fileItem(h.root, 'api', item);

  await h.tick();
  await h.tick();

  const looks = h.calls.filter(call => call.purpose === 'work-look').map(call => h.work(call).focus);
  assert.deepEqual(looks.slice(0, 2), ['study', 'security']);
  const run = h.calls.find(call => call.purpose === 'work-do');
  assert.ok(run, 'a do run started');
  assert.equal(run.cwd, paths(h.root, 'api').doTree);
  assert.match(git(run.cwd, 'branch', '--show-current'), /^hobkin\/[0-9a-f]{6}-update-rack$/);
  assert.deepEqual([h.work(run).item.key, h.work(run).landing], ['update:rack', 'pr']);
  assert.match(h.work(run).projectNotes, /An API/);
  assert.match(h.work(run).commands.item, /work item api --home/);
});

test('each lens comes up in turn, as often as the level says', async t => {
  const h = fixture(t);
  h.agent = study(h.root);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'), 'critical');
  await h.tick();
  await h.tick();
  await h.tick();

  h.clock += 7 * HOUR;
  await h.tick();
  assert.equal(h.calls.length, 3);

  h.clock += 2 * HOUR;
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
const fileOpen = (h, count) => {
  for (let index = 0; index < count; index++) fileItem(h.root, 'api', { ...item, key: `open-${index}` });
};
const keepItemsBusy = h => {
  h.director.startDo = () => {};
};

test('ideas come once a day, and more of them when a project has little to do', async t => {
  const h = fixture(t);
  onProject(h);
  keepItemsBusy(h);

  await h.tick();
  await h.tick();

  assert.equal(ideaRuns(h).length, 1);
  assert.equal(ideaRuns(h)[0].ideas, 3);

  h.clock += 25 * HOUR;
  writeState(h.root, 'api', { lastLensAt: new Date(h.clock).toISOString() });
  fileOpen(h, 2);
  await h.tick();

  assert.equal(ideaRuns(h).length, 2);
  assert.equal(ideaRuns(h)[1].ideas, 1);
});

test('a project with plenty of open work gets no new ideas', async t => {
  const h = fixture(t);
  onProject(h);
  keepItemsBusy(h);
  fileOpen(h, 5);

  await h.tick();

  assert.equal(ideaRuns(h).length, 0);
});

test('past half the day\'s tokens, a project gets one idea at most', async t => {
  const h = fixture(t);
  onProject(h);
  keepItemsBusy(h);
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 600000 }, h.clock - 2 * HOUR);

  await h.tick();

  assert.equal(ideaRuns(h)[0].ideas, 1);
  assert.deepEqual(ideaRuns(h)[0].tokens, { today: 600000, limit: 1000000 });
});

test('at the daily token limit nothing new starts until tomorrow, except urgent work', async t => {
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
  assert.deepEqual(h.calls.map(call => h.work(call).item?.key), ['ci:main']);

  h.clock += 24 * HOUR;
  await h.tick();
  assert.ok(h.calls.length > 1, 'a new day starts again');
});

test('tokens spread across the day: past an hour\'s share, new work waits for the window to move', async t => {
  const h = fixture(t);
  h.agent = () => {};
  onProject(h);
  writeMode(h.root, { dailyTokens: 2400000 });
  fileItem(h.root, 'api', item);
  writeState(h.root, 'api', { lastLensAt: null });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 100000 }, h.clock);

  await h.tick();
  assert.deepEqual(h.calls, [], 'an hour\'s share of a 2.4M day is 100k');

  fileItem(h.root, 'api', { ...item, key: 'ci:main', kind: 'fix', urgent: true });
  await h.tick();
  assert.deepEqual(h.calls.map(call => h.work(call).item?.key), ['ci:main'], 'urgent work does not wait');

  h.clock += 61 * 60000;
  await h.tick();
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
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 100000 }, h.clock);
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
  assert.match(reason, /Work mode paused/);
  assert.match(reason, /1m of today's 1m tokens/);
  assert.match(reason, /1 item is waiting/);
  assert.match(reason, /Update rack/);
  assert.match(reason, /tomorrow/);
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

test('pacing asks too, and says the work picks up on its own', async t => {
  const h = fixture(t);
  pausedForTheHour(h);

  await h.tick();

  const { reason, proposed } = readMode(h.root).allowanceRequest;
  assert.equal(proposed, 4800000);
  assert.match(reason, /this hour's share/);
  assert.match(reason, /as the hour moves on/);
});

test('a request made for the hour gives way when the day runs out', async t => {
  const h = fixture(t);
  pausedForTheHour(h);
  await h.tick();

  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 2300000 }, h.clock - 2 * HOUR);
  await h.tick();

  const { reason, atLimit } = readMode(h.root).allowanceRequest;
  assert.equal(atLimit, true);
  assert.match(reason, /tomorrow/);
});

test('the tokens a run used are recorded when it finishes', async t => {
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

test('a project gets one look and one do at a time', async t => {
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
  await h.tick();

  await h.director.tick();
  await new Promise(resolve => setTimeout(resolve, 300));
  await h.director.tick();
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.equal(h.calls.filter(call => call.purpose === 'work-do').length, 1);
  release.resolve();
  await h.settled();
});

test('level sets model and effort', async t => {
  const h = fixture(t);
  h.agent = request => {
    const { slug } = h.work(request).project;
    writeFileSync(paths(h.root, slug).project, '# What it is\n');
  };
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'billing'), 'critical');
  chooseProject(h.root, repository(h.base, 'site'), 'casual');
  fileItem(h.root, 'billing', item);
  fileItem(h.root, 'site', item);
  await h.tick();
  await h.tick();

  const run = (slug, purpose) => h.calls.find(call => call.purpose === purpose && h.work(call).project.slug === slug);
  assert.deepEqual([run('billing', 'work-do').model, run('billing', 'work-do').effort], ['fixture/main', 'xhigh']);
  assert.deepEqual([run('billing', 'work-look').effort], ['high']);
  assert.deepEqual([run('site', 'work-do').model, run('site', 'work-do').effort], ['fixture/background', 'medium']);
  assert.equal(h.work(run('billing', 'work-do')).landing, 'draft');
});

test('the pool limits runs, and the more critical project goes first', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, pool: 1, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'site'), 'casual');
  chooseProject(h.root, repository(h.base, 'billing'), 'critical');

  await h.tick();

  assert.deepEqual(h.calls.map(call => h.work(call).project.slug), ['billing']);
});

test('a do run that leaves its item unfinished gets one more try, then the item is stuck', async t => {
  const h = fixture(t);
  h.agent = study(h.root);
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  const { id } = fileItem(h.root, 'api', item);
  await h.tick();

  await h.tick();
  assert.deepEqual(readItems(h.root, 'api').map(({ state, attempts }) => [state, attempts]), [['open', 1]]);

  await h.tick();
  assert.deepEqual(readItems(h.root, 'api').map(({ state, attempts }) => [state, attempts]), [['stuck', 2]]);
  assert.equal(h.calls.filter(call => call.purpose === 'work-do' && h.work(call).item.id === id).length, 2);
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

  await h.tick();
  await h.tick();

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
  await h.tick();
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

test('closing Hobkin keeps an item to resume, and cancelling one leaves it for the user', async t => {
  const h = fixture(t);
  h.agent = async request => {
    study(h.root)(request);
    if (request.purpose === 'work-do') await waitForAbort(request);
  };
  writeMode(h.root, { enabled: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  chooseProject(h.root, repository(h.base, 'api'));
  fileItem(h.root, 'api', item);
  fileItem(h.root, 'api', { ...item, key: 'second' });
  await h.tick();
  await h.director.tick();
  while (!h.calls.some(call => call.purpose === 'work-do')) await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(await h.runner.kill(h.director.running().find(run => run.lane === 'do').id), true);
  await h.settled();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(readItems(h.root, 'api').map(({ state }) => state), ['stuck', 'open'], 'a cancelled item does not start again by itself');

  await h.director.tick();
  while (h.calls.filter(call => call.purpose === 'work-do').length < 2) await new Promise(resolve => setTimeout(resolve, 20));
  await h.runner.stop();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(readItems(h.root, 'api').map(({ state }) => state), ['stuck', 'doing'], 'closing keeps the item to resume');
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
  await h.director.tick();
  while (h.calls.length < 2) await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(h.runner.scheduledJobCount(await h.runtime.state()), 0);

  release.resolve();
  await h.settled();
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

  await h.tick();

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
  mkdirSync(paths(h.root, 'api').directory, { recursive: true });
  writeFileSync(paths(h.root, 'api').project, '# What it is\n');
  h.director.panes = { run: async () => ({ status: 'failed', cost: null, error: 'The agent exited.' }) };

  await h.tick();

  assert.deepEqual(readItems(h.root, 'api').map(({ state, attempts }) => [state, attempts]), [['open', 1]]);
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
