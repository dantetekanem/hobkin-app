import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runWorkCommand, workStatus } from '../src/cli/work/commands.mjs';
import { planWork } from '../src/cli/work/plan.mjs';
import {
  chooseProject, fileItem, paths, pickNext, putBackInQueue, readItems, readMode, readProject, readState, recordTokens, retryItem, skipInQueue, writeMode, writeState,
} from '../src/cli/work/store.mjs';
import { director, HOUR, studied } from './helpers/work-director.mjs';
import { git, repository, withOrigin } from './helpers/work-fixture.mjs';

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

test('a pane that hits a limit on another harness stops work from what it last showed', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  fileItem(h.root, 'api', item('fix'), h.clock);
  writeMode(h.root, { harness: 'codex' });
  h.director.panes = { run: async () => ({ status: 'failed', cost: null, error: 'The agent stopped.\n\nLast lines in the pane:\nUsage limit reached.' }) };

  await h.tick();

  assert.ok(readMode(h.root).usagePause);
});

test('a scheduled check takes a place, and a busy Chat stops new work until it is free', async t => {
  const h = director(t);
  studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);

  h.runtime.mainBusy = true;
  await h.tick();
  assert.deepEqual(h.calls, []);

  h.runtime.mainBusy = false;
  h.runner.jobs.set('check-one', Promise.resolve());
  h.runner.jobs.set('check-two', Promise.resolve());
  await h.director.tick();
  assert.deepEqual(h.calls, [], 'two checks fill the two places');

  h.runner.jobs.clear();
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

test('changes left in the folder at the end keep it where it is, and the tab says so', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  fileItem(h.root, 'api', item('fix'), h.clock);
  h.agent = request => writeFileSync(join(request.cwd, 'app.txt'), 'someone typed here\n');

  await h.tick();

  assert.match(git(checkout, 'branch', '--show-current'), /^hobkin\//);
  assert.equal(readFileSync(join(checkout, 'app.txt'), 'utf8'), 'someone typed here\n');
  assert.match(readState(h.root, 'api').folderNote, /uncommitted changes/);
  assert.match(workStatus(h.root).projects[0].folderNote, /uncommitted changes/);
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

test('a diverged default branch stops the run, changes nothing, costs nothing and says why', async t => {
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

  await h.tick();

  assert.deepEqual(h.calls, [], 'no agent started');
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), before);
  assert.equal(git(checkout, 'branch', '--show-current'), 'main');
  assert.match(readState(h.root, 'api').folderNote, /diverged from origin/);
  assert.equal(readItems(h.root, 'api')[0].attempts, 0);
  assert.equal(planWork(h.root, { now: h.clock }).entries[0].waiting, 'main has diverged from origin');

  h.clock += HOUR;
  await h.tick();
  assert.match(readState(h.root, 'api').folderNote, /diverged/, 'it tries again later, and still will not force it');
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

// Stopping when nothing is being merged, with a fake `gh`.

const pullRequest = (number, details = {}) => ({
  number,
  title: `PR ${number}`,
  url: `https://example.com/pull/${number}`,
  state: 'OPEN',
  isDraft: false,
  createdAt: '2026-05-20T00:00:00Z',
  mergedAt: null,
  additions: 12,
  deletions: 3,
  changedFiles: 2,
  reviewDecision: 'REVIEW_REQUIRED',
  statusCheckRollup: [{ conclusion: 'SUCCESS' }],
  headRefName: `hobkin/${number}-fix`,
  ...details,
});
const pulls = (count, from = 1, details = {}) => Array.from({ length: count }, (_, index) => pullRequest(from + index, details));

test('thirty open with none merged stops looks and items everywhere, and what is running finishes', async t => {
  const h = director(t);
  for (const name of ['one', 'two', 'three', 'four', 'five', 'six']) {
    studied(h, name);
    fileItem(h.root, name, item(`fix ${name}`), h.clock);
  }
  h.gh = async (_args, cwd) => JSON.stringify(cwd.endsWith('six') ? [] : pulls(6, Number(cwd.length) * 100));
  writeMode(h.root, { lastDiscoveryAt: new Date(h.clock).toISOString() });

  await h.tick();
  const started = h.calls.length;

  assert.ok(readMode(h.root).mergeStop, 'thirty open across five projects');
  assert.match(readMode(h.root).mergeStop.line, /30 unmerged and none merged/);

  await h.ticks(3);

  assert.equal(h.calls.length, started, 'nothing new starts');
  assert.equal(workStatus(h.root).pause.kind, 'merges');
});

test('a merge is the signal that work is moving again', async t => {
  const h = director(t);
  studied(h, 'one');
  writeMode(h.root, { unmergedLimit: 4 });
  let list = pulls(4);
  h.gh = async () => JSON.stringify(list);

  await h.tick();
  assert.ok(readMode(h.root).mergeStop);

  list = [pullRequest(1, { state: 'MERGED', mergedAt: new Date(h.clock).toISOString() }), ...pulls(3, 2)];
  h.clock += HOUR;
  await h.tick();

  assert.equal(readMode(h.root).mergeStop, null);
});

test('saying keep going starts the count again, and it asks about a new stop only when one happens', async t => {
  const h = director(t);
  studied(h, 'one');
  writeMode(h.root, { unmergedLimit: 4 });
  h.gh = async () => JSON.stringify(pulls(4));
  await h.tick();
  const stopped = readMode(h.root).mergeStop;

  await runWorkCommand(h.root, ['resume']);
  h.clock += HOUR;
  await h.tick();

  assert.ok(stopped);
  assert.equal(readMode(h.root).mergeStop, null, 'the same thirty do not stop it again');
});

test('one project cannot fill the whole limit: a fifth of it holds that project and no other', async t => {
  const h = director(t);
  studied(h, 'busy', 'critical');
  studied(h, 'quiet', 'casual');
  fileItem(h.root, 'busy', item('more for busy'), h.clock);
  fileItem(h.root, 'quiet', item('more for quiet'), h.clock);
  h.gh = async (_args, cwd) => JSON.stringify(cwd.endsWith('busy') ? pulls(6) : []);

  await h.tick();
  h.calls.length = 0;
  h.clock += HOUR;
  writeState(h.root, 'busy', { lastLensAt: new Date(h.clock).toISOString() });
  await h.tick();

  const plan = planWork(h.root, { now: h.clock });
  assert.equal(readMode(h.root).mergeStop ?? null, null);
  assert.equal(plan.unmerged.each, 6);
  assert.deepEqual(plan.unmerged.full, ['busy']);
  assert.match(plan.entries.find(entry => entry.slug === 'busy')?.waiting ?? '6 unmerged here', /6 unmerged here/);
});

test('a repository with no remote counts its unmerged branches, and one merged by hand stops counting', async t => {
  const h = director(t);
  const checkout = studied(h, 'local');
  writeMode(h.root, { unmergedLimit: 2 });
  for (const name of ['one', 'two']) {
    git(checkout, 'switch', '-qc', `hobkin/${name}`);
    writeFileSync(join(checkout, `${name}.txt`), `${name}\n`);
    git(checkout, 'add', '.');
    git(checkout, 'commit', '-qm', name);
    git(checkout, 'switch', '-q', 'main');
  }

  await h.tick();

  assert.ok(readMode(h.root).mergeStop, 'two branches at a limit of two');
  assert.equal(JSON.parse(readFileSync(join(h.root, 'work', 'unmerged.json'), 'utf8')).projects.local.open[0].size.files, 1);

  git(checkout, 'merge', '-q', '--no-ff', '--no-edit', 'hobkin/one');
  h.clock += HOUR;
  await h.tick();

  assert.equal(readMode(h.root).mergeStop, null);
});

test('a PR and its branch are one piece of work, and a closed PR is not open work', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  git(checkout, 'branch', 'hobkin/1-fix');
  git(checkout, 'branch', 'hobkin/2-fix');
  h.gh = async () => JSON.stringify([pullRequest(1), pullRequest(2, { state: 'CLOSED' })]);

  await h.tick();

  const { projects } = JSON.parse(readFileSync(join(h.root, 'work', 'unmerged.json'), 'utf8'));
  assert.deepEqual(projects.api.open.map(unit => [unit.kind, unit.branch, unit.review, unit.ci]), [['pr', 'hobkin/1-fix', 'REVIEW_REQUIRED', 'passing']]);
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

test('run now puts a row first, even ahead of what the plan would pick, and skips the gap between starts', async t => {
  const h = director(t);
  studied(h, 'top', 'critical');
  studied(h, 'low', 'casual');
  fileItem(h.root, 'top', item('top fix'), h.clock);
  const low = fileItem(h.root, 'low', item('low fix', { impact: 'low', effort: 'medium' }), h.clock);
  writeMode(h.root, { startGapMs: 300000 });
  h.director.lastStartAt = h.clock - 1000;
  pickNext(h.root, `item:low:${low.id}`);

  await h.tick();

  assert.deepEqual(h.calls.map(call => h.work(call).item.title), ['low fix']);
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

test('a stuck item says why, and running it again starts it from nothing', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  const filed = fileItem(h.root, 'api', item('fix'), h.clock);
  h.result = { status: 'failed', cost: null, error: 'The clone is gone.\nAnd more.' };
  await h.ticks(2);

  const [stuck] = workStatus(h.root).attention;
  assert.equal(stuck.reason, 'The clone is gone.');

  h.result = undefined;
  retryItem(h.root, 'api', filed.id, h.clock);
  await h.tick();

  assert.equal(h.calls.length, 3);
  assert.equal(readItems(h.root, 'api')[0].stuckReason, null);
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

test('max runs on Claude Opus at max effort, whatever harness is set, and asks for no permission to skip anything', async t => {
  const h = director(t);
  studied(h, 'api', 'max');
  fileItem(h.root, 'api', item('fix'), h.clock);
  paneWith(h);

  await h.tick();

  const [run] = h.panes;
  assert.deepEqual([run.kind, run.model, run.effort, run.bound], ['claude', 'claude-opus-5-5', 'max', true]);
  assert.ok(run.claudeSession);
  assert.equal(JSON.stringify(run).includes('dangerously'), false);
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

test('max needs a pane, so outside Herdr it waits and says so', async t => {
  const h = director(t);
  studied(h, 'api', 'max');
  fileItem(h.root, 'api', item('fix'), h.clock);

  await h.tick();

  assert.deepEqual(h.calls, []);
  assert.equal(planWork(h.root, { now: h.clock, panes: false }).entries[0].waiting, 'needs Herdr');
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
  h.director.panes = { run: async () => ({ status: 'failed', cost: null, error: 'The agent stopped.\n\nLast lines in the pane:\nUsage limit reached.' }) };

  await h.tick();

  const { usagePause, claudePause } = readMode(h.root);
  assert.equal(usagePause ?? null, null);
  assert.ok(claudePause);
  const { entries, next } = planWork(h.root, { now: h.clock, panes: true });
  assert.equal(entries[0].waiting, 'Claude usage limit');
  assert.equal(next.slug, 'other');
});

test('a Claude pane waiting on an approval shows as waiting', async t => {
  const h = director(t);
  studied(h, 'api', 'max');
  fileItem(h.root, 'api', item('fix'), h.clock);
  const release = Promise.withResolvers();
  let tell;
  paneWith(h, ({ onStatus }) => {
    tell = onStatus;
    return release.promise;
  });

  await h.director.tick();
  while (!tell) await new Promise(resolve => setTimeout(resolve, 10));
  tell('blocked');

  assert.match(workStatus(h.root, h.director.outlook()).running[0].note, /approval/);

  tell('working');
  assert.equal(workStatus(h.root, h.director.outlook()).running[0].note ?? null, null);
  release.resolve();
  await h.settled();
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
