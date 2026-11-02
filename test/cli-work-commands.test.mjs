import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { initialize } from '../src/cli/config.mjs';
import { main, parseArguments } from '../src/cli/main.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import {
  chooseProject, fileItem, noteDiscovery, paths, proposeProject, readDiscovery, readItems, readMode, readProjects, writeMode, writeOwnerView, writeState,
} from '../src/cli/work/store.mjs';
import { prepareTree } from '../src/cli/work/tree.mjs';

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-work-cli-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initialize(root, { cwd: root });
  return root;
}

async function work(root, args, input) {
  let text = '';
  const code = await main(['work', ...args, '--home', root], { write: chunk => { text += chunk; } }, {
    input: Readable.from(input === undefined ? [] : [JSON.stringify(input)]),
  });
  return { code, result: JSON.parse(text) };
}

async function refused(root, args, reason) {
  const { code, result } = await work(root, args);
  assert.deepEqual([code, result.ok], [1, false]);
  assert.match(result.message, reason);
}

const proposal ={ name: 'api', path: '/repos/api', level: 'casual', summary: 'An API.', found: 'CI green.', first: [] };
const item = { key: 'update:rack', kind: 'update', title: 'Update rack', brief: 'Rack has an advisory.' };

test('work arguments keep their order and the home option still applies', () => {
  const options = parseArguments(['work', 'choose', '/repos/api', 'critical', '--home', '/tmp/home']);

  assert.deepEqual(options.args, ['choose', '/repos/api', 'critical']);
  assert.equal(options.root, '/tmp/home');
});

test('work on needs a folder the first time, and off sets the mode a running owner picks up', async t => {
  const root = dataRoot(t);

  await refused(root, ['on'], /Say which folder/);
  assert.equal((await work(root, ['on', root])).result.enabled, true);
  assert.equal(readMode(root).enabled, true);
  assert.equal(readMode(root).folder, root);

  assert.equal((await work(root, ['off'])).result.enabled, false);
  assert.equal(readMode(root).enabled, false);
});

test('the harness can be chosen from the command line', async t => {
  const root = dataRoot(t);

  await work(root, ['harness', 'codex']);

  assert.equal(readMode(root).harness, 'codex');
  assert.equal((await work(root, [])).result.harness, 'codex');
});

test('the daily token limit can be set, and status reports the day so far', async t => {
  const root = dataRoot(t);

  await work(root, ['tokens', '250000']);

  const { result } = await work(root, []);
  assert.deepEqual([result.dailyTokens, result.tokensToday], [250000, 0]);
});

test('the number of agents and auto-pick change from the command line, and no key is needed', async t => {
  const root = dataRoot(t);

  await work(root, ['agents', '3']);
  await work(root, ['auto', 'off']);

  const mode = readMode(root);
  assert.deepEqual([mode.agents, mode.autoPick], [3, false]);
  await refused(root, ['agents', '9'], /between 1 and 8/);
  assert.deepEqual((await work(root, ['auto'])).result, { autoPick: false });
});

test('status gives the plan to whoever asks, with fresh and cached tokens apart', async t => {
  const root = dataRoot(t);
  await work(root, ['choose', '/repos/api', 'critical']);

  const { result } = await work(root, []);

  assert.deepEqual(result.plan.map(({ key, kind, grade, item: id, why, waiting }) => [key, kind, grade, id, why, waiting]), [['study:api', 'study', 'P0', null, 'first study, critical', null]]);
  assert.deepEqual([result.tokensToday, result.tokensCached, result.queued], [0, 0, 1]);
  assert.equal(result.subscription.known, false);
  assert.equal(result.agents, 1, 'with nothing known about the subscription, one at a time');
});

test('the allowance can be answered from the command line, so the main agent can act on a yes', async t => {
  const root = dataRoot(t);

  await work(root, ['allow', '5000000']);
  assert.equal((await work(root, [])).result.dailyTokens, 5000000);

  await work(root, ['allow', 'no']);
  assert.ok(readMode(root).declinedOn);
});

test('a request only stands while work mode is on', async t => {
  const root = dataRoot(t);
  writeMode(root, { allowanceRequest: { day: new Date().toDateString(), limit: 100, proposed: 200 } });
  assert.equal((await work(root, [])).result.allowanceRequest, null);

  writeMode(root, { enabled: true });

  assert.equal((await work(root, [])).result.allowanceRequest.proposed, 200);
});

test('an agent proposes a project, and the user takes or skips it', async t => {
  const root = dataRoot(t);

  await work(root, ['propose'], proposal);
  await work(root, ['propose'], { ...proposal, name: 'site', path: '/repos/site' });
  await work(root, ['choose', 'api', 'critical']);
  await work(root, ['skip', 'site']);

  assert.deepEqual(readProjects(root).map(({ slug, state, level }) => [slug, state, level]), [
    ['api', 'chosen', 'critical'],
    ['site', 'skipped', 'casual'],
  ]);
});

test('a proposal can suggest a level, and a priority or a PR mode stays the user\'s word', async t => {
  const root = dataRoot(t);

  await work(root, ['propose'], { ...proposal, priority: 'P0', prMode: 'published' });

  const [project] = readProjects(root);
  assert.deepEqual([project.level, project.priority, project.prMode], ['casual', undefined, undefined]);
});

test('an agent files an item, then updates it by id', async t => {
  const root = dataRoot(t);
  await work(root, ['choose', '/repos/api']);

  const { result: filed } = await work(root, ['item', 'api'], item);
  await work(root, ['item', 'api'], { id: filed.id, state: 'pr', pr: 'https://example.com/1' });

  assert.deepEqual(readItems(root, 'api').map(({ state, pr }) => [state, pr]), [['pr', 'https://example.com/1']]);
});

test('an agent can only record a state the queue can come back from', async t => {
  const root = dataRoot(t);
  await work(root, ['choose', '/repos/api']);
  const { result: filed } = await work(root, ['item', 'api'], item);

  for (const state of ['blocked', 'waiting', 'doing', 'stuck', 'noted', 'declined', 'merged']) {
    const { code, result } = await work(root, ['item', 'api'], { id: filed.id, state, summary: 'Waiting on the user.' });
    assert.deepEqual([code, result.ok], [1, false], state);
    assert.match(result.message, /state must be one of: open, branch, pr, done, dropped/);
  }
  const [unchanged] = readItems(root, 'api');
  assert.deepEqual([unchanged.state, unchanged.summary], ['open', undefined], 'a refused update changes nothing');

  for (const state of ['branch', 'pr', 'done', 'dropped', 'open']) {
    assert.equal((await work(root, ['item', 'api'], { id: filed.id, state })).code, 0, state);
    assert.equal(readItems(root, 'api')[0].state, state);
  }
  assert.equal((await work(root, ['item', 'api'], { id: filed.id, summary: 'No state named.' })).code, 0);
});

test('an agent cannot give an item a grade, filing it or updating it', async t => {
  const root = dataRoot(t);
  await work(root, ['choose', '/repos/api']);

  const { result: filed } = await work(root, ['item', 'api'], { ...item, grade: 'P0' });
  await work(root, ['item', 'api'], { id: filed.id, grade: 'P0' });

  assert.equal(readItems(root, 'api')[0].grade, undefined);
});

test('a discovery agent says where it is, and status carries that and the next look', async t => {
  const root = dataRoot(t);
  writeMode(root, { lastDiscoveryAt: '2026-01-01T00:00:00.000Z' });

  await work(root, ['progress'], { folder: '/repos/api', doing: 'Reading its history', repositories: ['api'] });

  const { result } = await work(root, []);
  assert.deepEqual([result.discovery.current, result.discovery.doing, result.discovery.repositories], ['/repos/api', 'Reading its history', ['api']]);
  assert.equal(result.nextDiscoveryAt, '2026-01-02T00:00:00.000Z');
});

test('status says when a taken project is next looked at, and why its last look failed', async t => {
  const root = dataRoot(t);
  await work(root, ['choose', '/repos/api', 'critical']);
  writeState(root, 'api', { lastLensAt: '2026-01-01T00:00:00.000Z', lookError: 'The clone is gone.' });

  const { result: { projects: [project] } } = await work(root, []);

  assert.equal(project.nextLookAt, '2026-01-01T08:00:00.000Z');
  assert.equal(project.lookError, 'The clone is gone.');
});

test('bare work prints status as JSON', async t => {
  const root = dataRoot(t);
  await work(root, ['propose'], proposal);

  const { result } = await work(root, []);

  assert.equal(result.enabled, false);
  assert.deepEqual(result.projects.map(project => project.slug), ['api']);
});

test('a bad request fails without changing anything', async t => {
  const root = dataRoot(t);

  await refused(root, ['choose', 'missing'], /Unknown project/);
  assert.deepEqual(readProjects(root), []);
});

test('a reset forgets what work mode found, moves everything it held aside, deletes nothing and keeps how it was set up', async t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-reset-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  const repo = join(base, 'api');
  mkdirSync(root);
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git('init', '--quiet', '--initial-branch=main');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'first');
  writeMode(root, { enabled: false, folder: base, harness: 'claude', dailyTokens: 5000000, lastDiscoveryAt: '2026-01-01T00:00:00.000Z' });
  writeFileSync(join(root, 'work', 'AGENTS.md'), 'Ignore the old folders.');
  proposeProject(root, { name: 'api', path: repo, level: 'important', why: 'It ships.', found: 'Recent commits.' });
  chooseProject(root, 'api');
  noteDiscovery(root, { rootFolders: ['api'], finishedFolders: [] });
  const { directory, directions, doTree, lookTree } = paths(root, 'api');
  await prepareTree({ repo, tree: lookTree });
  await prepareTree({ repo, tree: doTree, branch: 'hobkin/abc-fix' });
  writeFileSync(join(doTree, 'half-done.txt'), 'hours of uncommitted work');
  fileItem(root, 'api', item);
  writeFileSync(directions, 'Never touch billing.');
  mkdirSync(join(root, 'checks', 'work.discover'), { recursive: true });
  writeFileSync(join(root, 'checks', 'work.discover', 'memory.md'), 'Halfway through.');
  mkdirSync(join(root, 'runtime'));
  mkdirSync(join(directory, 'prs'));
  writeFileSync(join(directory, 'prs', 'abc123.md'), '# Fix the importer');
  mkdirSync(join(directory, 'trees', 'do-moved-1'));
  writeFileSync(join(directory, 'trees', 'do-moved-1', 'kept.txt'), 'work from a broken tree');

  const { kept: said } = await runWorkCommand(root, ['reset']);

  assert.deepEqual(readProjects(root), []);
  assert.equal(existsSync(directory), false);
  assert.equal(git('worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1, 'the repository keeps no stale tree');
  git('switch', '--quiet', 'hobkin/abc-fix');
  assert.equal(existsSync(join(root, 'checks', 'work.discover')), false, 'the next look starts from nothing');
  assert.equal(readDiscovery(root).status, undefined);
  const mode = readMode(root);
  assert.deepEqual([mode.folder, mode.harness, mode.dailyTokens, mode.lastDiscoveryAt], [base, 'claude', 5000000, null]);
  assert.equal(readFileSync(join(root, 'work', 'AGENTS.md'), 'utf8'), 'Ignore the old folders.');
  const [aside] = readdirSync(join(root, 'runtime')).filter(name => name.startsWith('work-reset-'));
  const moved = join(root, 'runtime', aside);
  assert.equal(said, moved);
  assert.ok(existsSync(join(moved, 'projects.jsonl')), 'the old picks can still be read');
  assert.equal(readFileSync(join(moved, 'api', 'prs', 'abc123.md'), 'utf8'), '# Fix the importer', 'a local PR is work, and git does not hold its description');
  assert.equal(readFileSync(join(moved, 'api', 'trees', 'do-moved-1', 'kept.txt'), 'utf8'), 'work from a broken tree', 'a tree moved aside may hold work');
  assert.equal(readFileSync(join(moved, 'api', 'trees', 'do', 'half-done.txt'), 'utf8'), 'hours of uncommitted work', 'git holds none of this');
  assert.equal(readFileSync(join(moved, 'api', 'directions.md'), 'utf8'), 'Never touch billing.');
  assert.match(readFileSync(join(moved, 'api', 'items.jsonl'), 'utf8'), /Update rack/);
  assert.equal(readFileSync(join(moved, 'work.discover', 'memory.md'), 'utf8'), 'Halfway through.');
});

test('a reset takes a clone of Hobkin\'s own with it, and the branches that are only there', async t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-reset-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  mkdirSync(join(root, 'checks'), { recursive: true });
  mkdirSync(join(root, 'runtime'));
  proposeProject(root, { name: 'api', remote: 'https://example.com/api.git', level: 'important' });
  chooseProject(root, 'api');
  const { clone, doTree } = paths(root, 'api');
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', clone]);
  execFileSync('git', ['-C', clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'first']);
  await prepareTree({ repo: clone, tree: doTree, branch: 'hobkin/only-here' });

  const { forgot, kept } = await runWorkCommand(root, ['reset']);

  assert.equal(forgot, 1);
  assert.equal(execFileSync('git', ['-C', join(kept, 'api', 'repo'), 'branch', '--list', 'hobkin/*', '--format=%(refname:short)'], { encoding: 'utf8' }).trim(), 'hobkin/only-here');
});

test('a reset works with a project that has nothing on disk, or a folder that has gone', async t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-reset-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  mkdirSync(join(root, 'checks'), { recursive: true });
  mkdirSync(join(root, 'runtime'));
  proposeProject(root, { name: 'api', path: join(base, 'gone'), level: 'important' });

  assert.equal((await runWorkCommand(root, ['reset'])).forgot, 1);
  assert.deepEqual(readProjects(root), []);
});

test('a reset refuses while work mode is on, so nothing runs in a tree it moves', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-reset-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeMode(root, { enabled: true, folder: root });

  await assert.rejects(runWorkCommand(root, ['reset']), /work mode off/);
});

test('a reset refuses while an agent is still running with the mode off, says which, and moves nothing', async t => {
  const root = dataRoot(t);
  await work(root, ['choose', '/repos/api']);
  await work(root, ['item', 'api'], item);
  writeOwnerView(root, { running: [{ id: 'work:api:do:1', slug: 'api', lane: 'do', title: 'api: Update rack' }] });
  writeFileSync(join(root, 'runtime.lock'), '');

  await refused(root, ['reset'], /api: Update rack/);

  assert.equal(readProjects(root).length, 1);
  assert.equal(readItems(root, 'api').length, 1);
  assert.equal(existsSync(join(root, 'runtime')), false, 'no folder was even made for it');
});

test('what a closed owner left behind stops no reset, because with no owner nothing can be running', async t => {
  const root = dataRoot(t);
  await work(root, ['choose', '/repos/api']);
  writeOwnerView(root, { running: [{ id: 'work:api:do:1', slug: 'api', lane: 'do', title: 'api: Update rack' }] });

  assert.equal((await work(root, ['reset'])).code, 0);
  assert.deepEqual(readProjects(root), []);
});

