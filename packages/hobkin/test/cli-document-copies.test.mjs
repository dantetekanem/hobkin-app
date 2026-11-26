import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HobkinApplication } from '../src/cli/application.mjs';
import { HobkinRuntime } from '../src/cli/runtime.mjs';
import { atomicJson, initialize, setLearning } from '../src/cli/config.mjs';
import { fakePi } from './helpers/pi-session.mjs';
import { git, repository } from './helpers/work-fixture.mjs';
import { WorkDirector } from '../src/cli/work/director.mjs';

// A real application on a temporary home with the fake main chat, as cli-rebuild.test.mjs opens one. Its clock does not tick.
async function open(t, { learning = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-copies-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  if (learning) setLearning(root, true);
  const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, intervalMs: 3600000, runHarness: async () => ({ status: 'completed', text: 'Useful: done.', cost: null }) });
  t.after(() => app.close());
  return app;
}

const finished = id => ({ id, kind: 'background', scheduleId: 'news', title: 'News', harness: 'pi', status: 'completed', startedAt: '2026-01-02T09:00:00.000Z', finishedAt: '2026-01-02T09:05:00.000Z', result: { status: 'completed', text: 'Useful: the news.' } });

test('with learning on, a tick with nothing new reads no runs, and a run that finished makes it read them once', async t => {
  const app = await open(t, { learning: true });
  await app.learn();
  const state = t.mock.method(app.runtime, 'state');
  await app.learn();
  await app.learn();
  assert.equal(state.mock.callCount(), 0, 'nothing finished and nothing aged');
  await app.runtime.change(document => { document.runs.one = finished('one'); });
  await app.learn();
  assert.equal(state.mock.callCount(), 1, 'a finished run is worth a pass');
  await app.learn();
  assert.equal(state.mock.callCount(), 1);
});

// The runtime alone, as cli-state-copy.test.mjs opens it, so no refresh of an application reads the document meanwhile.
async function runtimeOnly(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-copies-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = await HobkinRuntime.open(root, initialize(root, { cwd: root }), {
    createMain: async () => { throw Error('This test opens no main session.'); },
  });
  t.after(() => runtime.close());
  return runtime;
}

test('a run that ends hands back its final record without reading the whole document again, and a later edit does not change it', async t => {
  const app = { runtime: await runtimeOnly(t) };
  const state = t.mock.method(app.runtime, 'state');
  const request = { id: 'job-1', kind: 'background', title: 'Job', harness: 'pi', scheduleId: 'news' };
  const ended = await app.runtime.dispatch(request, async () => ({ status: 'completed', text: 'Useful: done.', cost: null }));
  assert.equal(ended.status, 'completed');
  assert.equal(ended.result.text, 'Useful: done.');
  assert.equal(state.mock.callCount(), 0, 'the finish already holds the final record');
  ended.status = 'edited';
  assert.equal((await app.runtime.state()).runs['job-1'].status, 'completed');

  // A run stopped by the user ends the same way.
  const release = Promise.withResolvers();
  const stopping = app.runtime.dispatch({ ...request, id: 'job-2' }, async signal => {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    release.resolve();
    return { status: 'interrupted', cost: null };
  });
  while (!app.runtime.active.get('job-2')?.admitted) await new Promise(resolve => setImmediate(resolve));
  const before = state.mock.callCount();
  assert.equal(await app.runtime.cancel('job-2', { source: 'user', reason: 'Not now.' }), true);
  await release.promise;
  assert.equal((await stopping).status, 'interrupted');
  assert.equal(state.mock.callCount(), before, 'the stop reads the run its finish handed back');
});

test('a run\'s harness finds its admission in the run index, without reading the whole document', async t => {
  const app = await open(t);
  await app.runtime.change(document => {
    document.runs['job-3'] = { id: 'job-3', kind: 'background', status: 'running', harnessId: 'h-3', title: 'Job' };
    document.runs['job-old'] = { id: 'job-old', kind: 'background', status: 'completed', harnessId: 'h-3', title: 'Job' };
  });
  const state = t.mock.method(app.runtime, 'state');
  const register = t.mock.method(app.runtime.ownedLifecycle, 'register');
  const harness = app.ownedHarness(async () => ({ status: 'completed', text: 'Useful: done.' }));
  assert.equal((await harness({ id: 'h-3' })).status, 'completed');
  assert.equal(register.mock.calls[0].arguments[0].id, 'job-3', 'the running admission, not an older run of the same harness');
  assert.equal(state.mock.callCount(), 0);
});

test('looking for hobkins to title reads no runs while none is still named by its first message', async t => {
  const app = await open(t);
  await app.runtime.change(document => {
    const createdAt = '2026-01-02T09:00:00.000Z';
    document.hobkins = { named: { id: 'named', state: 'waiting', titleBy: 'user', title: 'Mine', createdAt }, gone: { id: 'gone', state: 'ended', titleBy: 'message', createdAt } };
  });
  const state = t.mock.method(app.runtime, 'state');
  assert.deepEqual(await app.hobkins.toTitle(), []);
  assert.equal(state.mock.callCount(), 0);
  await app.runtime.change(document => { document.hobkins.fresh = { id: 'fresh', state: 'waiting', titleBy: 'message', title: 'Look at the logs', createdAt: '2026-01-02T10:00:00.000Z' }; });
  await app.hobkins.toTitle();
  assert.equal(state.mock.callCount(), 1, 'one named by its first message is worth a look');
});

test('a run in the user\'s folder stops on the next look once the folder leaves its branch, and a rebase or a worktree reads right', async t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-copies-folder-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = repository(base, 'api');
  git(repo, 'switch', '-qc', 'hobkin/one');
  const tree = join(base, 'tree');
  git(repo, 'worktree', 'add', '-q', '-b', 'hobkin/two', tree);
  const killed = [];
  const runs = [{ id: 'one', folder: { repo, branch: 'hobkin/one' } }, { id: 'two', folder: { repo: tree, branch: 'hobkin/two' } }];
  const director = { running: () => runs, killRun: id => killed.push(id) };
  const look = () => WorkDirector.prototype.guardFolders.call(director);

  await look();
  assert.deepEqual(killed, [], 'both are on their own branches');
  git(repo, 'switch', '-q', '--detach');
  await look();
  assert.deepEqual(killed, [], 'no branch, as during a rebase, is no move');
  git(repo, 'switch', '-qc', 'my-work');
  git(tree, 'switch', '-qc', 'theirs');
  await look();
  assert.deepEqual(killed, ['one', 'two']);
  assert.deepEqual(runs.map(run => run.moved), [true, true]);
});

test('a work run that starts reads the previous run of its schedule from the committed document, copying only that run', async t => {
  const { director, studied } = await import('./helpers/work-director.mjs');
  const { fileItem } = await import('../src/cli/work/store.mjs');
  const h = director(t);
  studied(h, 'api');
  fileItem(h.root, 'api', { key: 'fix', kind: 'fix', title: 'Fix it', brief: 'Evidence, who benefits, the first change, the proof.', impact: 'high', effort: 'small' }, h.clock);
  // The document as pi-durable keeps it, frozen through, so a writer would throw.
  const deepFreeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const part of Object.values(value)) deepFreeze(part);
    }
    return value;
  };
  h.runtime.document = async () => deepFreeze(structuredClone(h.runtime.data));
  const state = t.mock.method(h.runtime, 'state');
  await h.startedRun();
  assert.equal(state.mock.callCount(), 0, 'no copy of the whole document');
  assert.equal(h.calls.length, 1, 'and the run started');
  await h.runner.kill(h.director.running()[0].id);
  await h.settled();
});
