import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBinding } from '../src/cli/schedules.mjs';
import { runWorkCommand, workStatus } from '../src/cli/work/commands.mjs';
import { planWork } from '../src/cli/work/plan.mjs';
import {
  chooseProject, fileItem, paths, pendingCancels, pickNext, putBackInQueue, readItems, readMode, readProject, readState, recordTokens, requestCancel, retryItem, skipInQueue, updateItem, writeMode, writeState,
} from '../src/cli/work/store.mjs';
import { prepareTree } from '../src/cli/work/tree.mjs';
import { unmergedNow } from '../src/cli/work/unmerged.mjs';
import { director, HOUR, studied } from './helpers/work-director.mjs';
import { WorkDirector } from '../src/cli/work/director.mjs';
import { branched, git, pull, repository, withOrigin } from './helpers/work-fixture.mjs';

const brief = 'Evidence, who benefits, the first change, the proof.';
const item = (key, details = {}) => ({ key, kind: 'fix', title: key, brief, impact: 'high', effort: 'small', ...details });
const untilAborted = request => new Promise(resolve => {
  if (request.signal.aborted) resolve();
  request.signal.addEventListener('abort', resolve, { once: true });
});

test('twenty chosen projects start only the top of the plan, spaced out, and the rest wait their turn', async t => {
  const h = director(t);
  const release = Promise.withResolvers();
  h.agent = () => release.promise;
  writeMode(h.root, { startGapMs: 300000 });
  const names = Array.from({ length: 20 }, (_, index) => `project-${index}`);
  for (const [index, name] of names.entries()) {
    studied(h, name, index === 13 ? 'critical' : 'casual');
    fileItem(h.root, name, item(`fix ${name}`), h.clock);
  }

  await h.director.tick();
  while (!h.calls.length) await new Promise(resolve => setTimeout(resolve, 10));
  await h.director.tick();
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.equal(h.calls.length, 1, 'one start on a tick, and the gap holds the next one back');
  assert.equal(h.work(h.calls[0]).project.slug, 'project-13', 'the critical project goes first');

  h.clock += 300000;
  await h.director.tick();
  while (h.calls.length < 2) await new Promise(resolve => setTimeout(resolve, 10));

  h.clock += 300000;
  await h.director.tick();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(h.calls.length, 2, 'two agents is the default, however many are waiting');
  assert.equal(workStatus(h.root, { ...h.director.outlook(), now: h.clock }).queued, 18);

  release.resolve();
  await h.settled();
});

const hitsTheLimit = h => request => {
  writeFileSync(request.sessionFile, `${JSON.stringify({
    type: 'message',
    message: { role: 'assistant', stopReason: 'error', errorMessage: 'You have hit your ChatGPT usage limit (pro plan). Try again in ~40 min.', usage: { input: 100, output: 0 } },
  })}\n`);
  h.result = { status: 'failed', cost: null, error: 'Pi did not finish a response (error).' };
};

test('a usage limit stops every start at once, costs the project nothing and clears by itself', async t => {
  const h = director(t);
  studied(h, 'one', 'critical');
  studied(h, 'two', 'important');
  const { id } = fileItem(h.root, 'one', item('first'), h.clock);
  fileItem(h.root, 'two', item('second'), h.clock);
  h.agent = hitsTheLimit(h);

  await h.tick();

  assert.equal(h.calls.length, 1);
  const { usagePause } = readMode(h.root);
  assert.equal(Date.parse(usagePause.until), h.clock + 40 * 60000, 'it took the time the provider gave');
  assert.match(usagePause.reason, /usage limit/);
  const [filed] = readItems(h.root, 'one');
  assert.deepEqual([filed.state, filed.attempts], ['doing', 0], 'no failure counts against the project');

  h.calls.length = 0;
  h.clock += 60000;
  await h.ticks(3);

  assert.equal(h.calls.length, 0, 'nothing retries and nothing else starts');
  assert.equal(readMode(h.root).pauseNotice.line.includes('usage limit'), true, 'Chat hears about it');
  const { id: told } = readMode(h.root).pauseNotice;
  await h.tick();
  assert.equal(readMode(h.root).pauseNotice.id, told, 'once');

  h.result = undefined;
  h.agent = async () => {};
  h.clock += 40 * 60000;
  await h.tick();

  assert.equal(h.work(h.calls[0]).item.id, id, 'the same item carries on');
  assert.equal(readMode(h.root).usagePause, null, 'a run that works clears it');
});

test('a look cut off by a usage limit comes round again, with no error on the project', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  const earlier = new Date(h.clock - 100 * HOUR).toISOString();
  writeState(h.root, 'api', { lastLensAt: earlier, lensIndex: 2 });
  h.agent = hitsTheLimit(h);

  await h.tick();

  const state = readState(h.root, 'api');
  assert.deepEqual([state.lastLensAt, state.lensIndex, state.lookError ?? null], [earlier, 2, null]);
});

test('a pane that fails on a limit on another harness stops work', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  fileItem(h.root, 'api', item('fix'), h.clock);
  writeMode(h.root, { harness: 'codex' });
  h.director.panes = { run: async () => ({ status: 'failed', cost: null, error: 'Usage limit reached.\n\nLast lines in the pane:\nThe agent stopped.' }) };

  await h.tick();

  assert.ok(readMode(h.root).usagePause);
});

test('the words of a limit in a pane\'s last lines stop nothing, because a pane can be showing anything', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  fileItem(h.root, 'api', item('fix'), h.clock);
  writeMode(h.root, { harness: 'claude' });
  h.director.panes = { run: async () => ({ status: 'failed', cost: null, error: 'The agent stopped.\n\nLast lines in the pane:\nAdded a test for the rate limit.' }) };

  await h.tick();

  assert.equal(readMode(h.root).usagePause ?? null, null);
  assert.deepEqual(readItems(h.root, 'api').map(({ state, attempts }) => [state, attempts]), [['open', 1]], 'it is an ordinary failed try');
});

test('a scheduled check takes a place', async t => {
  const h = director(t);
  studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);

  h.runner.jobs.set('check-one', Promise.resolve());
  h.runner.jobs.set('check-two', Promise.resolve());
  await h.director.tick();
  assert.deepEqual(h.calls, [], 'two checks fill the two places');

  h.runner.jobs.clear();
  await h.tick();
  assert.equal(h.calls.length, 1);
});

test('work starts while Chat is busy, because nothing waits for the main chat', async t => {
  const h = director(t);
  studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);
  h.runtime.mainBusy = true;

  await h.tick();

  assert.equal(h.calls.length, 1);
});

test('a harness that cannot be measured is charged its estimate, marked so nothing learns from it', async t => {
  const h = director(t);
  studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);
  writeMode(h.root, { harness: 'codex' });
  h.director.panes = { run: async () => ({ status: 'completed', text: 'Useful: Done.', cost: null }) };

  await h.tick();

  const [event] = readFileSync(join(h.root, 'work', 'tokens.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual([event.tokens, event.estimated, event.kind, event.level], [1000000, true, 'do', 'important']);
});

// In the project's own folder, on real repositories.

test('a clean folder runs on a branch in place, and comes back with the work left on that branch', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);
  let during;
  h.agent = request => {
    during = { cwd: request.cwd, branch: git(request.cwd, 'branch', '--show-current') };
    writeFileSync(join(request.cwd, 'new.txt'), 'the agent\n');
    git(request.cwd, 'add', 'new.txt');
    git(request.cwd, 'commit', '-qm', 'agent work');
  };

  await h.tick();

  assert.equal(during.cwd, checkout);
  assert.match(during.branch, /^hobkin\//);
  assert.equal(git(checkout, 'branch', '--show-current'), 'main');
  assert.equal(existsSync(join(checkout, 'new.txt')), false);
  assert.equal(git(checkout, 'log', '-1', '--format=%s', during.branch), 'agent work');
  assert.equal(existsSync(paths(h.root, 'api').doTree), false, 'no worktree was needed');
});

test('a dirty folder falls back to a worktree, says so, and nothing in the folder changes', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  writeFileSync(join(checkout, 'app.txt'), 'half-finished\n');
  writeFileSync(join(checkout, 'notes.txt'), 'mine\n');
  const before = git(checkout, 'status', '--porcelain=v1', '--branch');
  fileItem(h.root, 'api', item('fix'), h.clock);
  const release = Promise.withResolvers();
  h.agent = () => release.promise;

  await h.startedRun();

  assert.equal(h.calls[0].cwd, paths(h.root, 'api').doTree);
  assert.equal(h.work(h.calls[0]).place, 'tree');
  assert.match(h.director.running()[0].note, /uncommitted changes/);
  release.resolve();
  await h.settled();
  assert.equal(git(checkout, 'status', '--porcelain=v1', '--branch'), before);
  assert.equal(readFileSync(join(checkout, 'app.txt'), 'utf8'), 'half-finished\n');
});

test('a user on another branch keeps it, and the run takes a worktree', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  git(checkout, 'switch', '-qc', 'my-work');
  fileItem(h.root, 'api', item('fix'), h.clock);

  await h.tick();

  assert.equal(h.calls[0].cwd, paths(h.root, 'api').doTree);
  assert.equal(git(checkout, 'branch', '--show-current'), 'my-work');
});

test('the user switching branches mid-run stops the run, and the item stays in the queue', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();
  while (!h.director.running()[0]?.folder) await new Promise(resolve => setTimeout(resolve, 10));

  git(checkout, 'switch', '-qc', 'my-work');
  writeFileSync(join(checkout, 'mine.txt'), 'theirs\n');
  await h.tick();

  assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(git(checkout, 'branch', '--show-current'), 'my-work', 'nothing moved them back');
  assert.equal(readFileSync(join(checkout, 'mine.txt'), 'utf8'), 'theirs\n');
  const [filed] = readItems(h.root, 'api');
  assert.deepEqual([filed.state, filed.attempts], ['open', 0]);
  assert.match(readState(h.root, 'api').folderNote, /left the run's branch/);
  assert.deepEqual(workStatus(h.root).folderLines.map(({ line }) => line), ['api\'s folder left the branch for "fix" while it ran, so that run stopped. Nothing was forced.']);
});

const insideARebase = (checkout, branch) => {
  writeFileSync(join(checkout, 'app.txt'), 'the run\n');
  git(checkout, 'commit', '-qam', 'the run');
  git(checkout, 'switch', '-q', 'main');
  writeFileSync(join(checkout, 'app.txt'), 'main moved on\n');
  git(checkout, 'commit', '-qam', 'main moved on');
  git(checkout, 'switch', '-q', branch);
  assert.throws(() => execFileSync('git', ['-C', checkout, 'rebase', 'main'], { stdio: 'ignore' }));
};

test('a run rebasing in the folder keeps going, because a rebase reads as no branch and the folder has not moved', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();
  while (!h.director.running()[0]?.folder) await new Promise(resolve => setTimeout(resolve, 10));
  insideARebase(checkout, h.director.running()[0].folder.branch);
  assert.equal(git(checkout, 'branch', '--show-current'), '');

  await h.director.tick();

  assert.equal(h.calls[0].signal.aborted, false);
  git(checkout, 'rebase', '--abort');
  await h.runner.kill(h.director.running()[0].id);
  await h.settled();
});

test('a pr-fix item always runs in a worktree, because a rebase must never be left in the user\'s folder', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  git(checkout, 'branch', 'hobkin/old');
  const filed = fileItem(h.root, 'api', item('Rebase hobkin/old', { kind: 'pr-fix' }), h.clock);
  updateItem(h.root, 'api', filed.id, { branch: 'hobkin/old' }, h.clock);
  const release = Promise.withResolvers();
  h.agent = () => release.promise;

  await h.startedRun();

  assert.deepEqual([h.calls[0].cwd, h.work(h.calls[0]).place], [paths(h.root, 'api').doTree, 'tree']);
  assert.equal(git(h.calls[0].cwd, 'branch', '--show-current'), 'hobkin/old');
  assert.equal(git(checkout, 'branch', '--show-current'), 'main');
  assert.match(h.director.running()[0].note, /this item rebases/);
  release.resolve();
  await h.settled();
});

// A kill waits for its run to end, and a run stuck getting ready does not.

const neverBack = () => new Promise(() => {});
const backSoon = tick => new Promise((resolve, reject) => {
  setTimeout(reject, 5000, Error('The tick is still waiting on the kill.')).unref();
  tick.then(resolve, reject);
});

test('cancelling a run stuck getting ready holds no tick, so checks carry on', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);
  const ready = Promise.withResolvers();
  h.director.place = () => ready.promise;
  await h.director.tick();
  requestCancel(h.root, h.director.running()[0].id);

  await backSoon(h.director.tick());

  assert.deepEqual(pendingCancels(h.root), []);
  ready.resolve({ cwd: checkout });
  await h.settled();
});

test('stopping a run whose folder moved holds no tick', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();
  while (!h.director.running()[0]?.folder) await new Promise(resolve => setTimeout(resolve, 10));
  h.runner.kill = neverBack;
  git(checkout, 'switch', '-qc', 'my-work');

  await backSoon(h.director.tick());

  delete h.runner.kill;
  await h.runner.kill(h.director.running()[0].id);
  await h.settled();
});

test('turning work mode off during a look holds no tick, and tells the look once', async t => {
  const h = director(t);
  writeMode(h.root, { folder: h.base, lastDiscoveryAt: null });
  h.agent = untilAborted;
  await h.startedRun();
  const kills = [];
  h.runner.kill = id => {
    kills.push(id);
    return neverBack();
  };
  writeMode(h.root, { enabled: false });

  await backSoon(h.director.tick());
  await backSoon(h.director.tick());

  assert.equal(kills.length, 1);
  delete h.runner.kill;
  await h.runner.kill(kills[0]);
  await h.settled();
});

test('a kill that fails hurts nothing', async t => {
  const h = director(t);
  studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();
  h.runner.kill = async () => { throw Error('It had already gone.'); };
  requestCancel(h.root, h.director.running()[0].id);

  await h.director.tick();
  await new Promise(resolve => setImmediate(resolve));

  delete h.runner.kill;
  await h.runner.kill(h.director.running()[0].id);
  await h.settled();
});

// A tree holds a branch for as long as it is checked out there, and nothing else can take it until then.

const dirtyFolder = checkout => writeFileSync(join(checkout, 'notes.txt'), 'mine\n');

test('a run in a worktree gives up its branch when it ends, so the user can check that branch out', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  dirtyFolder(checkout);
  fileItem(h.root, 'api', item('fix'), h.clock);
  const tree = paths(h.root, 'api').doTree;
  let during;
  h.agent = request => { during = git(request.cwd, 'branch', '--show-current'); };

  await h.tick();

  assert.equal(h.calls[0].cwd, tree);
  assert.match(during, /^hobkin\//);
  assert.equal(git(tree, 'branch', '--show-current'), '');
  git(checkout, 'switch', '-q', during);
  assert.equal(git(checkout, 'branch', '--show-current'), during);
});

const keptFrom = (checkout, branch) => git(checkout, 'branch', '--list', `${branch}-kept-*`, '--format=%(refname:short)').split('\n').filter(Boolean);

test('a finished run leaves no branch held: what it left uncommitted goes on a side branch, and its own stays as it was', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  dirtyFolder(checkout);
  const filed = fileItem(h.root, 'api', item('fix'), h.clock);
  const tree = paths(h.root, 'api').doTree;
  let branch;
  h.agent = request => {
    branch = git(request.cwd, 'branch', '--show-current');
    writeFileSync(join(request.cwd, 'forgotten.txt'), 'never committed\n');
    updateItem(h.root, 'api', filed.id, { state: 'branch' }, h.clock);
  };

  await h.tick();

  assert.equal(git(tree, 'branch', '--show-current'), '');
  assert.equal(git(checkout, 'rev-parse', branch), git(checkout, 'rev-parse', 'main'), 'a finished local PR stays exactly as it was');
  assert.equal(git(checkout, 'show', `${keptFrom(checkout, branch)[0]}:forgotten.txt`), 'never committed');
  git(checkout, 'switch', '-q', branch);
});

for (const [ending, record] of Object.entries({
  'ended without an outcome': () => {},
  'put its item back itself': (h, id) => updateItem(h.root, 'api', id, { state: 'open' }, h.clock),
})) {
  test(`a run that ${ending} keeps its uncommitted work where it is, and the next run resumes it there`, async t => {
    const h = director(t);
    const checkout = studied(h, 'api');
    dirtyFolder(checkout);
    const filed = fileItem(h.root, 'api', item('fix'), h.clock);
    const tree = paths(h.root, 'api').doTree;
    let branch;
    h.agent = request => {
      branch = git(request.cwd, 'branch', '--show-current');
      writeFileSync(join(request.cwd, 'half.txt'), 'half done\n');
      record(h, filed.id);
    };

    await h.tick();

    assert.equal(git(tree, 'branch', '--show-current'), branch);
    assert.equal(readFileSync(join(tree, 'half.txt'), 'utf8'), 'half done\n');
    assert.deepEqual(keptFrom(checkout, branch), []);

    let found;
    h.agent = request => { found = readFileSync(join(request.cwd, 'half.txt'), 'utf8'); };
    h.clock += HOUR;
    await h.tick();

    assert.equal(found, 'half done\n');
  });
}

test('with auto-pick off a pick passes a started item nobody picked, and what that item left stays on a side branch of its own', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  dirtyFolder(checkout);
  const tree = paths(h.root, 'api').doTree;
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/started' });
  const tip = git(tree, 'rev-parse', 'HEAD');
  writeFileSync(join(tree, 'half.txt'), 'half done\n');
  const started = fileItem(h.root, 'api', item('started'), h.clock);
  updateItem(h.root, 'api', started.id, { state: 'doing', branch: 'hobkin/started' }, h.clock);
  const picked = fileItem(h.root, 'api', item('picked'), h.clock);
  writeMode(h.root, { autoPick: false });
  pickNext(h.root, `item:api:${picked.id}`);

  await h.tick();

  assert.deepEqual(h.calls.map(call => [h.work(call).item.title, call.cwd]), [['picked', tree]]);
  assert.equal(git(checkout, 'show', `${keptFrom(checkout, 'hobkin/started')[0]}:half.txt`), 'half done');
  assert.equal(git(checkout, 'rev-parse', 'hobkin/started'), tip);
});

test('a tree that cannot be released does not hide how the run ended', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  dirtyFolder(checkout);
  const filed = fileItem(h.root, 'api', item('fix'), h.clock);
  h.agent = request => {
    updateItem(h.root, 'api', filed.id, { state: 'branch' }, h.clock);
    rmSync(request.cwd, { recursive: true, force: true });
  };

  await h.tick();

  assert.equal(Object.values(h.runtime.data.runs)[0].status, 'completed');
  assert.equal(readItems(h.root, 'api')[0].state, 'branch');
});

test('the folder stays guarded after work mode is turned off, because the agent keeps working', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();
  while (!h.director.running()[0]?.folder) await new Promise(resolve => setTimeout(resolve, 10));

  writeMode(h.root, { enabled: false });
  await h.director.tick();
  assert.equal(h.calls[0].signal.aborted, false, 'turning it off lets the agent finish');

  git(checkout, 'switch', '-qc', 'my-work');
  await h.tick();

  assert.equal(h.calls[0].signal.aborted, true);
});

test('a folder that vanishes during a run does not hide how the run ended', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);
  h.agent = () => rmSync(checkout, { recursive: true, force: true });

  await h.tick();

  const [filed] = readItems(h.root, 'api');
  assert.deepEqual([filed.state, filed.attempts], ['open', 1]);
});

test('changes left in the folder at the end keep it where it is, and Chat hears it once, by the project and the work', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);
  h.agent = request => writeFileSync(join(request.cwd, 'app.txt'), 'someone typed here\n');

  await h.tick();

  assert.match(git(checkout, 'branch', '--show-current'), /^hobkin\//);
  assert.equal(readFileSync(join(checkout, 'app.txt'), 'utf8'), 'someone typed here\n');
  assert.match(workStatus(h.root).projects[0].folderNote, /uncommitted changes/);
  const lines = workStatus(h.root).folderLines.map(({ line }) => line);
  assert.deepEqual(lines, ['api\'s folder stays on the branch for "fix", because it has uncommitted changes. Nothing in it was changed.']);
});

test('the folder hobkin runs from is never switched, so its work goes to a worktree', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  h.director.ownFolder = checkout;
  fileItem(h.root, 'api', item('fix'), h.clock);
  let during;
  h.agent = request => { during = { cwd: request.cwd, branch: git(checkout, 'branch', '--show-current') }; };

  await h.tick();

  assert.notEqual(during.cwd, checkout);
  assert.equal(during.branch, 'main', 'the folder stayed on its default branch while the run worked');
});

test('a default branch behind origin is brought up to date before a run', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  const origin = withOrigin(h.base, checkout);
  const pusher = join(h.base, 'pusher');
  execFileSync('git', ['clone', '-q', origin, pusher]);
  git(pusher, 'config', 'user.email', 'o@example.com');
  git(pusher, 'config', 'user.name', 'O');
  writeFileSync(join(pusher, 'upstream.txt'), 'new\n');
  git(pusher, 'add', '.');
  git(pusher, 'commit', '-qm', 'upstream');
  git(pusher, 'push', '-q', 'origin', 'main');
  fileItem(h.root, 'api', item('fix'), h.clock);
  let seen;
  h.agent = request => { seen = existsSync(join(request.cwd, 'upstream.txt')); };

  await h.tick();

  assert.equal(seen, true);
  assert.equal(git(checkout, 'rev-parse', 'main'), git(pusher, 'rev-parse', 'HEAD'));
});

test('a diverged default branch sends the run to a worktree from origin, and the user\'s folder stays as it is', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  const origin = withOrigin(h.base, checkout);
  const pusher = join(h.base, 'pusher');
  execFileSync('git', ['clone', '-q', origin, pusher]);
  git(pusher, 'config', 'user.email', 'o@example.com');
  git(pusher, 'config', 'user.name', 'O');
  writeFileSync(join(pusher, 'upstream.txt'), 'new\n');
  git(pusher, 'add', '.');
  git(pusher, 'commit', '-qm', 'upstream');
  git(pusher, 'push', '-q', 'origin', 'main');
  writeFileSync(join(checkout, 'mine.txt'), 'local\n');
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-qm', 'local');
  const before = git(checkout, 'rev-parse', 'HEAD');
  fileItem(h.root, 'api', item('fix'), h.clock);
  let during;
  h.agent = request => {
    during = { cwd: request.cwd, upstream: existsSync(join(request.cwd, 'upstream.txt')), mine: existsSync(join(request.cwd, 'mine.txt')) };
  };

  await h.tick();

  assert.deepEqual(during, { cwd: paths(h.root, 'api').doTree, upstream: true, mine: false });
  assert.equal(h.work(h.calls[0]).place, 'tree');
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), before);
  assert.equal(git(checkout, 'branch', '--show-current'), 'main');
  assert.equal(git(checkout, 'status', '--porcelain'), '');
});

test('a second run on one repository waits when small, and takes a worktree when not', async t => {
  const h = director(t);
  const checkout = studied(h, 'api', 'critical');
  fileItem(h.root, 'api', item('first', { urgent: true, effort: 'small' }), h.clock);
  h.agent = untilAborted;
  await h.startedRun();
  while (!h.director.running()[0]?.folder) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.calls[0].cwd, checkout);

  fileItem(h.root, 'api', item('small second'), h.clock);
  writeState(h.root, 'api', { lastLensAt: null });
  await h.director.tick();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(h.calls.length, 1, 'the look and the item both wait for the folder');

  for (const run of h.director.running()) await h.runner.kill(run.id);
  await h.settled();
});

test('a look stays on the default branch with no branch at all, and one that runs tests takes a worktree', async t => {
  const h = director(t);
  const checkout = studied(h, 'api', 'critical');
  writeState(h.root, 'api', { lastLensAt: null, lensIndex: 0 });

  await h.tick();

  assert.deepEqual([h.work(h.calls[0]).focus, h.calls[0].cwd, h.work(h.calls[0]).place], ['security', checkout, 'folder']);
  assert.match(h.work(h.calls[0]).commands.tree, /work tree api --home/);
  assert.equal(git(checkout, 'branch', '--list'), '* main');

  writeState(h.root, 'api', { lastLensAt: null });
  await h.tick();

  assert.deepEqual([h.work(h.calls[1]).focus, h.calls[1].cwd, h.work(h.calls[1]).place], ['bugs', paths(h.root, 'api').lookTree, 'tree']);
});

test('a look that leaves files behind is reported, and they stay put', async t => {
  const h = director(t);
  const checkout = studied(h, 'api', 'critical');
  writeState(h.root, 'api', { lastLensAt: null, lensIndex: 0 });
  h.agent = request => writeFileSync(join(request.cwd, 'coverage.txt'), 'left behind\n');

  await h.tick();

  assert.match(readState(h.root, 'api').folderNote, /After the look, it has uncommitted changes/);
  assert.equal(existsSync(join(checkout, 'coverage.txt')), true);
});

test('hobkin work tree gives a look that needs tests its worktree', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');

  const { tree } = await runWorkCommand(h.root, ['tree', 'api']);

  assert.equal(tree, paths(h.root, 'api').lookTree);
  assert.equal(git(tree, 'rev-parse', 'HEAD'), git(checkout, 'rev-parse', 'HEAD'));
});

test('a reset keeps every branch, wherever it lives', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  git(checkout, 'branch', 'hobkin/abc-fix');
  mkdirSync(join(h.root, 'checks'), { recursive: true });
  mkdirSync(join(h.root, 'runtime'), { recursive: true });
  writeMode(h.root, { enabled: false });

  await runWorkCommand(h.root, ['reset']);

  assert.equal(git(checkout, 'branch', '--list', 'hobkin/*').trim(), 'hobkin/abc-fix');
});

// What is unmerged, with a fake `gh`.

test('a repository with no remote counts its unmerged branches, and one merged by hand stops counting', async t => {
  const h = director(t);
  const checkout = studied(h, 'local');
  for (const name of ['one', 'two']) {
    git(checkout, 'switch', '-qc', `hobkin/${name}`);
    writeFileSync(join(checkout, `${name}.txt`), `${name}\n`);
    git(checkout, 'add', '.');
    git(checkout, 'commit', '-qm', name);
    git(checkout, 'switch', '-q', 'main');
  }

  await h.tick();

  assert.equal(unmergedNow(h.root).perProject.local, 2);
  assert.equal(JSON.parse(readFileSync(join(h.root, 'work', 'unmerged.json'), 'utf8')).projects.local.open[0].size.files, 1);

  git(checkout, 'merge', '-q', '--no-ff', '--no-edit', 'hobkin/one');
  h.clock += HOUR;
  await h.tick();

  assert.equal(unmergedNow(h.root).perProject.local, 1);
});

test('a PR and its branch are one piece of work, and a closed PR leaves open only what its branch still holds', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  git(checkout, 'branch', 'hobkin/1-fix');
  git(checkout, 'branch', 'hobkin/2-fix');
  branched(checkout, 'hobkin/3-fix');
  h.gh = async () => JSON.stringify([pull(1), pull(2, { state: 'CLOSED' }), pull(3, { state: 'CLOSED' })]);

  await h.tick();

  const { projects } = JSON.parse(readFileSync(join(h.root, 'work', 'unmerged.json'), 'utf8'));
  assert.deepEqual(projects.api.open.map(unit => [unit.kind, unit.branch, unit.review, unit.ci]), [
    ['pr', 'hobkin/1-fix', 'REVIEW_REQUIRED', 'passing'],
    ['branch', 'hobkin/3-fix', undefined, undefined],
  ]);
});

test('the survey runs on its own clock, not on every tick', async t => {
  const h = director(t);
  studied(h, 'api');
  let asked = 0;
  h.gh = async () => { asked++; return '[]'; };

  await h.ticks(3);
  assert.equal(asked, 1);

  h.clock += HOUR;
  await h.tick();
  assert.equal(asked, 2);
});

// The queue the user can steer.

test('run now puts a row first, even ahead of what the plan would pick, once the gap between starts is over', async t => {
  const h = director(t);
  studied(h, 'top', 'critical');
  studied(h, 'low', 'casual');
  fileItem(h.root, 'top', item('top fix'), h.clock);
  const low = fileItem(h.root, 'low', item('low fix', { impact: 'low', effort: 'medium' }), h.clock);
  writeMode(h.root, { startGapMs: 300000 });
  h.director.lastStartAt = h.clock - 1000;
  pickNext(h.root, `item:low:${low.id}`);

  await h.tick();
  assert.deepEqual(h.calls, [], 'a pick waits out the gap too');
  h.clock += 300000;
  await h.tick();

  assert.deepEqual(h.calls.map(call => h.work(call).item.title), ['low fix']);
  assert.deepEqual(readMode(h.root).queueNext, []);
});

test('when the last run started survives a restart, so a new owner keeps the gap', async t => {
  const h = director(t);
  studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);

  await h.tick();
  const reopened = new WorkDirector({ root: h.root, config: {}, runner: h.runner, runtime: h.runtime, now: () => h.clock });

  assert.equal(h.calls.length, 1);
  assert.equal(reopened.lastStartAt, h.clock);
});

test('a pick whose item finished another way leaves the pick list', async t => {
  const h = director(t);
  studied(h, 'api');
  const filed = fileItem(h.root, 'api', item('fix'), h.clock);
  pickNext(h.root, `item:api:${filed.id}`);
  updateItem(h.root, 'api', filed.id, { state: 'done' }, h.clock);

  await h.tick();

  assert.deepEqual(readMode(h.root).queueNext, []);
});

test('a skipped row drops out of auto-pick without being lost, and can be put back', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  const filed = fileItem(h.root, 'api', item('not now'), h.clock);
  const key = `item:api:${filed.id}`;

  skipInQueue(h.root, key);
  await h.tick();

  assert.deepEqual(h.calls, []);
  const status = workStatus(h.root, { now: h.clock });
  assert.equal(status.queued, 0);
  assert.deepEqual(status.plan.map(row => [row.title, row.skipped]), [['not now', true]], 'it stays in sight');

  putBackInQueue(h.root, key);
  await h.tick();
  assert.equal(h.calls.length, 1);
});

test('with auto-pick off work mode stays on and only what is picked runs', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  const filed = fileItem(h.root, 'api', item('fix'), h.clock);

  await runWorkCommand(h.root, ['auto', 'off']);
  await h.ticks(2);

  assert.equal(readMode(h.root).enabled, true);
  assert.deepEqual(h.calls, []);

  await runWorkCommand(h.root, ['run', `item:api:${filed.id}`]);
  await h.tick();
  assert.equal(h.calls.length, 1);

  await assert.rejects(runWorkCommand(h.root, ['auto', 'maybe']), /auto on or auto off/);
  await runWorkCommand(h.root, ['auto', 'on']);
  assert.equal(readMode(h.root).autoPick, true);
});

test('a pick stays inside the budget and a stop', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  const filed = fileItem(h.root, 'api', item('fix'), h.clock);
  pickNext(h.root, `item:api:${filed.id}`);
  writeMode(h.root, { dailyTokens: 1000000 });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 1000000 }, h.clock - 2 * HOUR);

  await h.tick();

  assert.deepEqual(h.calls, []);
});

test('an item that keeps failing says why, and a retry starts it from nothing', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  const filed = fileItem(h.root, 'api', item('fix'), h.clock);
  h.result = { status: 'failed', cost: null, error: 'The clone is gone.\nAnd more.' };
  await h.tick();
  h.clock += HOUR;
  writeState(h.root, 'api', { lastLensAt: new Date(h.clock).toISOString() });
  await h.tick();

  const [tried] = readItems(h.root, 'api');
  assert.deepEqual([tried.state, tried.attempts, tried.lastError], ['open', 2, 'The clone is gone.']);

  h.result = undefined;
  retryItem(h.root, 'api', filed.id, h.clock);
  await h.tick();

  assert.equal(h.calls.length, 3);
  const { attempts, lastError } = h.work(h.calls[2]).item;
  assert.deepEqual([attempts, lastError], [0, null]);
});

// `max`: Claude at its highest effort, whatever harness is set.

const paneWith = (h, spy = () => {}) => {
  h.panes = [];
  h.director.panes = {
    run: async options => {
      h.panes.push(options);
      await spy(options);
      return { status: 'completed', text: 'Useful: Done.', cost: null };
    },
  };
};

test('max runs on Claude Opus at max effort, whatever harness is set', async t => {
  const h = director(t);
  studied(h, 'api', 'max');
  fileItem(h.root, 'api', item('fix'), h.clock);
  paneWith(h);

  await h.tick();

  const [run] = h.panes;
  assert.deepEqual([run.kind, run.model, run.effort, run.bound], ['claude', 'claude-opus-5-5', 'max', true]);
  assert.ok(run.claudeSession);
});

test('an item can be max on a project that is not', async t => {
  const h = director(t);
  studied(h, 'api', 'casual');
  const filed = fileItem(h.root, 'api', item('fix'), h.clock);
  paneWith(h);

  await runWorkCommand(h.root, ['max', 'api', filed.id]);
  await h.tick();

  assert.equal(h.panes[0].kind, 'claude');
});

test('an agent cannot make its own item max', async t => {
  const h = director(t);
  studied(h, 'api', 'casual');
  const send = value => (async function* read() { yield JSON.stringify(value); }());

  const filed = await runWorkCommand(h.root, ['item', 'api'], send({ ...item('fix'), max: true }));
  await runWorkCommand(h.root, ['item', 'api'], send({ id: filed.id, max: true }));

  assert.equal(readItems(h.root, 'api')[0].max, undefined);
});

test('max ranks above critical and looks less often, because each look is the dearest run there is', async t => {
  const h = director(t);
  studied(h, 'critical-one', 'critical');
  studied(h, 'max-one', 'max');
  fileItem(h.root, 'critical-one', item('fix critical'), h.clock);
  fileItem(h.root, 'max-one', item('fix max'), h.clock);

  assert.equal(planWork(h.root, { now: h.clock }).entries[0].slug, 'max-one');

  const nine = new Date(h.clock - 9 * HOUR).toISOString();
  writeState(h.root, 'critical-one', { lastLensAt: nine });
  writeState(h.root, 'max-one', { lastLensAt: nine });
  const looks = planWork(h.root, { now: h.clock }).entries.filter(entry => entry.kind === 'look').map(entry => entry.slug);
  assert.deepEqual(looks, ['critical-one']);
});

test('one max run at a time and six a day, and its count shows', async t => {
  const h = director(t);
  studied(h, 'api', 'max');
  fileItem(h.root, 'api', item('a'), h.clock);
  fileItem(h.root, 'api', item('b', { effort: 'medium' }), h.clock);
  const release = Promise.withResolvers();
  paneWith(h, () => release.promise);

  await h.director.tick();
  while (!h.panes.length) await new Promise(resolve => setTimeout(resolve, 10));
  await h.director.tick();
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.equal(h.panes.length, 1);
  assert.equal(workStatus(h.root, { ...h.director.outlook(), now: h.clock }).maxRuns.running, 1);

  release.resolve();
  await h.settled();
  for (let index = 0; index < 6; index++) recordTokens(h.root, { slug: 'api', lane: 'do', level: 'max', tokens: 1000 }, h.clock - HOUR);

  const { entries } = planWork(h.root, { now: h.clock, panes: true });
  assert.equal(entries[0].waiting, '6 max runs a day');
});

test('outside Herdr max runs on the normal harness and model, at an effort Pi has, and still counts as max', async t => {
  const h = director(t);
  studied(h, 'api', 'max');
  fileItem(h.root, 'api', item('fix'), h.clock);
  h.agent = request => writeFileSync(request.sessionFile, `${JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { input: 10, output: 10 } } })}\n`);

  await h.tick();

  const [run] = h.calls;
  assert.deepEqual([run.harness, run.model, run.effort], ['pi', 'fixture/main', 'xhigh']);
  assert.doesNotThrow(() => validateBinding(run));
  assert.equal(planWork(h.root, { now: h.clock, panes: false }).budget.maxRuns, 1);
});

test('outside Herdr a look on a max project runs on the normal model too', async t => {
  const h = director(t);
  studied(h, 'api', 'max');
  writeState(h.root, 'api', { lastLensAt: null });

  await h.tick();

  const [run] = h.calls;
  assert.deepEqual([run.purpose, run.model, run.effort], ['work-look', 'fixture/main', 'high']);
  assert.doesNotThrow(() => validateBinding(run));
});

test('outside Herdr a max run that hits a limit stops everything, because it ran on what everything else runs on', async t => {
  const h = director(t);
  studied(h, 'api', 'max');
  fileItem(h.root, 'api', item('fix'), h.clock);
  h.agent = hitsTheLimit(h);

  await h.tick();

  const { usagePause, claudePause } = readMode(h.root);
  assert.ok(usagePause);
  assert.equal(claudePause ?? null, null);
});

test('Claude\'s own transcript gives a max run real numbers, counted once for each request', async t => {
  const h = director(t);
  studied(h, 'api', 'max');
  fileItem(h.root, 'api', item('fix'), h.clock);
  paneWith(h, ({ claudeSession }) => {
    const folder = join(h.base, 'claude-projects', '-some-project');
    mkdirSync(folder, { recursive: true });
    const line = (requestId, usage) => JSON.stringify({ type: 'assistant', requestId, message: { usage } });
    const usage = { input_tokens: 10, cache_creation_input_tokens: 200, output_tokens: 30, cache_read_input_tokens: 4000 };
    writeFileSync(join(folder, `${claudeSession}.jsonl`), [line('a', usage), line('a', usage), line('b', usage)].join('\n'));
  });

  await h.tick();

  const [event] = readFileSync(join(h.root, 'work', 'tokens.jsonl'), 'utf8').trim().split('\n').map(text => JSON.parse(text));
  assert.deepEqual([event.tokens, event.cached, event.estimated, event.level], [480, 8000, undefined, 'max']);
});

test('with no transcript to read, a max run counts as an estimate', async t => {
  const h = director(t);
  studied(h, 'api', 'max');
  fileItem(h.root, 'api', item('fix'), h.clock);
  paneWith(h);

  await h.tick();

  const [event] = readFileSync(join(h.root, 'work', 'tokens.jsonl'), 'utf8').trim().split('\n').map(text => JSON.parse(text));
  assert.equal(event.estimated, true);
});

test('Claude\'s usage limit pauses max work and nothing else', async t => {
  const h = director(t);
  studied(h, 'top', 'max');
  studied(h, 'other', 'important');
  fileItem(h.root, 'top', item('max fix'), h.clock);
  fileItem(h.root, 'other', item('other fix'), h.clock);
  h.director.panes = { run: async () => ({ status: 'failed', cost: null, error: 'Usage limit reached.\n\nLast lines in the pane:\nThe agent stopped.' }) };

  await h.tick();

  const { usagePause, claudePause } = readMode(h.root);
  assert.equal(usagePause ?? null, null);
  assert.ok(claudePause);
  const { entries, next } = planWork(h.root, { now: h.clock, panes: true });
  assert.equal(entries[0].waiting, 'Claude usage limit');
  assert.equal(next.slug, 'other');
});

test('a proposal may suggest max and taking it keeps it, while an agent cannot move a chosen project', async t => {
  const h = director(t);
  const path = repository(h.base, 'incident');
  await runWorkCommand(h.root, ['propose'], (async function* read() { yield JSON.stringify({ name: 'incident', path, level: 'max' }); }()));

  assert.equal(readProject(h.root, 'incident').level, 'max');
  chooseProject(h.root, 'incident', 'important', h.clock);
  await runWorkCommand(h.root, ['propose'], (async function* read() { yield JSON.stringify({ name: 'incident', path, level: 'max' }); }()));

  assert.equal(readProject(h.root, 'incident').level, 'important');
});
