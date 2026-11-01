import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWatch, watchFolder } from '../src/cli/work/watcher.mjs';
import { chooseProject, dropProject, proposeProject, readDiscovery, readProject, readProjects, readState, recordDiscovery, skipProject } from '../src/cli/work/store.mjs';
import { git, repository, withOrigin } from './helpers/work-fixture.mjs';

const DAY = 86400000;
const start = Date.parse('2026-06-01T12:00:00Z');

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-watch-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  const folder = join(base, 'Poetry');
  mkdirSync(join(root, 'work'), { recursive: true });
  mkdirSync(folder);
  const h = { root, base, folder, clock: start };
  h.watch = () => watchFolder(root, { folder, now: h.clock });
  h.nextDay = async () => {
    h.clock += DAY;
    return h.watch();
  };
  h.proposed = () => readProjects(root).filter(project => project.state === 'proposed').map(project => project.slug);
  return h;
}

/** Commits at a date of the test's choosing, so its clock and the repository's agree. */
function commitAt(repo, at, name = 'change.txt') {
  writeFileSync(join(repo, name), `${at}\n`);
  git(repo, 'add', '.');
  const date = new Date(at).toISOString();
  execFileSync('git', ['-C', repo, 'commit', '-qm', `work at ${date}`], { env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
}

const everything = repo => [git(repo, 'status', '--porcelain=v1', '--branch', '--ignored'), git(repo, 'for-each-ref')].join('\n');

test('the first watch records what is there and proposes nothing, because discovery has covered it', async t => {
  const h = fixture(t);
  repository(h.folder, 'api');
  mkdirSync(join(h.folder, 'notes'));

  await h.watch();

  assert.deepEqual(h.proposed(), []);
  const { at, seen } = readWatch(h.root);
  assert.equal(at, new Date(h.clock).toISOString());
  assert.equal(seen[join(h.folder, 'api')].repository, true);
  assert.equal(seen[join(h.folder, 'notes')].repository, false);
});

test('a new repository is proposed from its git facts alone, and says so', async t => {
  const h = fixture(t);
  await h.watch();
  const path = repository(h.folder, 'fresh-idea');
  commitAt(path, h.clock + 1000);
  writeFileSync(join(path, 'README.md'), '\n# Fresh idea\n\nA tool for fresh ideas.\n');
  git(path, 'add', '.');
  git(path, 'commit', '-qm', 'readme');
  withOrigin(h.base, path);

  await h.nextDay();

  const project = readProject(h.root, 'fresh-idea');
  assert.equal(project.state, 'proposed');
  assert.equal(project.path, path);
  assert.equal(project.summary, 'Fresh idea');
  assert.match(project.found, /Last commit 20\d\d-\d\d-\d\d/);
  assert.match(project.found, /\d+ commits? in 90 days/);
  assert.match(project.found, /origin\.git/);
  assert.match(project.reason, /not looked at in depth/);
});

test('a repository with no remote and few commits is suggested as casual, and never as critical', async t => {
  const h = fixture(t);
  await h.watch();
  repository(h.folder, 'quiet');

  await h.nextDay();

  assert.equal(readProject(h.root, 'quiet').level, 'casual');
});

test('a busy repository with a remote is suggested as important', async t => {
  const h = fixture(t);
  await h.watch();
  const path = repository(h.folder, 'busy');
  for (let index = 0; index < 12; index++) commitAt(path, h.clock - index * DAY, `file-${index}.txt`);
  withOrigin(h.base, path);

  await h.nextDay();

  assert.equal(readProject(h.root, 'busy').level, 'important');
});

test('a folder of projects is looked into one level down, and no further', async t => {
  const h = fixture(t);
  mkdirSync(join(h.folder, 'clients', 'old', 'deep'), { recursive: true });
  await h.watch();
  repository(join(h.folder, 'clients'), 'shop');
  repository(join(h.folder, 'clients', 'old'), 'buried');

  await h.nextDay();

  assert.deepEqual(h.proposed(), ['shop']);
});

test('a new folder is noted and proposed only once it holds a repository', async t => {
  const h = fixture(t);
  await h.watch();
  mkdirSync(join(h.folder, 'scratch'));

  await h.nextDay();

  assert.deepEqual(h.proposed(), []);
  assert.deepEqual(readWatch(h.root).noted.added, ['scratch']);
});

test('a linked worktree, a dot folder and dependencies are not projects', async t => {
  const h = fixture(t);
  const path = repository(h.folder, 'api');
  await h.watch();
  git(path, 'worktree', 'add', '-q', '--detach', join(h.folder, 'api-tree'));
  repository(join(h.folder), '.hidden');
  repository(join(h.folder), 'node_modules');

  await h.nextDay();

  assert.deepEqual(h.proposed(), []);
});

test('a dead repository that appears is noted, and not offered', async t => {
  const h = fixture(t);
  await h.watch();
  const path = repository(h.folder, 'archive');
  git(path, 'commit', '-q', '--amend', '--no-edit', '--date=2020-01-01T00:00:00Z');
  execFileSync('git', ['-C', path, 'commit', '-q', '--amend', '--no-edit'], { env: { ...process.env, GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' } });

  await h.nextDay();

  assert.deepEqual(h.proposed(), []);
  assert.deepEqual(readWatch(h.root).noted.added, ['archive']);
});

test('a repository that came back to life is offered', async t => {
  const h = fixture(t);
  const path = repository(h.folder, 'revived');
  execFileSync('git', ['-C', path, 'commit', '-q', '--amend', '--no-edit', '--date=2020-01-01T00:00:00Z'], { env: { ...process.env, GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' } });
  await h.watch();
  assert.equal(readWatch(h.root).seen[path].recent, 0);

  commitAt(path, h.clock + 1000);
  await h.nextDay();

  assert.deepEqual(h.proposed(), ['revived']);
  assert.match(readProject(h.root, 'revived').reason, /active again/);
});

test('a folder the directions rule out is never proposed or even looked at, by its path or its pattern', async t => {
  const h = fixture(t);
  const ignored = join(h.folder, 'advent-of-code');
  writeFileSync(join(h.root, 'work', 'AGENTS.md'), `Exclude \`${ignored}/\`, including descendants. Ignore other \`advent*\` folders in the discovery root too.\n`);
  await h.watch();
  repository(h.folder, 'advent-of-code');
  repository(h.folder, 'advent-of-code-2025');
  repository(h.folder, 'keeper');

  await h.nextDay();

  assert.deepEqual(h.proposed(), ['keeper']);
  assert.equal(readWatch(h.root).seen[ignored], undefined);
});

test('a project already picked or proposed is not proposed again', async t => {
  const h = fixture(t);
  await h.watch();
  const picked = repository(h.folder, 'picked');
  const waiting = repository(h.folder, 'waiting');
  chooseProject(h.root, picked, 'critical', h.clock);
  proposeProject(h.root, { name: 'waiting', path: waiting, level: 'important', summary: 'Written by discovery.' }, h.clock);

  await h.nextDay();

  assert.equal(readProject(h.root, 'picked').state, 'chosen');
  assert.equal(readProject(h.root, 'waiting').summary, 'Written by discovery.');
});

test('a dropped project stays dropped, whatever it does', async t => {
  const h = fixture(t);
  const path = repository(h.folder, 'old');
  await h.watch();
  chooseProject(h.root, path, 'casual', h.clock);
  dropProject(h.root, 'old', h.clock);
  for (let index = 0; index < 8; index++) commitAt(path, h.clock + index + 1, `file-${index}.txt`);

  await h.nextDay();

  assert.equal(readProject(h.root, 'old').state, 'dropped');
});

test('a skipped project comes back only with clear new activity, and only once', async t => {
  const h = fixture(t);
  const path = repository(h.folder, 'skipped');
  await h.watch();
  proposeProject(h.root, { name: 'skipped', path, level: 'casual' }, h.clock);
  skipProject(h.root, 'skipped', h.clock);
  recordDiscovery(h.root, { startedAt: new Date(h.clock).toISOString(), told: ['skipped'] });

  commitAt(path, h.clock + 1000);
  await h.nextDay();
  assert.equal(readProject(h.root, 'skipped').state, 'skipped', 'one commit is not clear new activity');

  for (let index = 0; index < 5; index++) commitAt(path, h.clock + 1000 + index, `more-${index}.txt`);
  await h.nextDay();
  assert.equal(readProject(h.root, 'skipped').state, 'proposed');
  assert.match(readProject(h.root, 'skipped').reason, /since it was skipped/);
  assert.deepEqual(readDiscovery(h.root).told, [], 'so it reaches Chat again');

  skipProject(h.root, 'skipped', h.clock);
  for (let index = 0; index < 8; index++) commitAt(path, h.clock + 1000 + index, `again-${index}.txt`);
  await h.nextDay();
  assert.equal(readProject(h.root, 'skipped').state, 'skipped', 'it was offered once');
});

test('new commits in a picked project feed the plan and start nothing', async t => {
  const h = fixture(t);
  const path = repository(h.folder, 'picked');
  chooseProject(h.root, path, 'important', h.clock);
  await h.watch();
  assert.equal(readState(h.root, 'picked').newCommits, undefined, 'the first watch has nothing to compare');

  commitAt(path, h.clock + 1000);
  commitAt(path, h.clock + 2000, 'other.txt');
  await h.nextDay();

  assert.equal(readState(h.root, 'picked').newCommits, 2);
  assert.deepEqual(readWatch(h.root).noted.changed, ['picked']);
});

test('a project whose folder sits on a run\'s branch is left for the next watch, so a run does not count as news', async t => {
  const h = fixture(t);
  const path = repository(h.folder, 'picked');
  chooseProject(h.root, path, 'important', h.clock);
  await h.watch();
  git(path, 'switch', '-qc', 'hobkin/abc-fix');
  commitAt(path, h.clock + 1000);

  await h.nextDay();
  assert.equal(readState(h.root, 'picked').newCommits, undefined);

  git(path, 'switch', '-q', 'main');
  await h.nextDay();
  assert.equal(readState(h.root, 'picked').newCommits, undefined, 'main itself did not move');
});

test('a removed folder is noted and nothing happens to it', async t => {
  const h = fixture(t);
  const path = repository(h.folder, 'gone');
  chooseProject(h.root, path, 'casual', h.clock);
  await h.watch();
  rmSync(path, { recursive: true, force: true });

  await h.nextDay();

  assert.deepEqual(readWatch(h.root).noted.removed, ['gone']);
  assert.equal(readProject(h.root, 'gone').state, 'chosen');
});

test('watching changes nothing in any repository', async t => {
  const h = fixture(t);
  const path = repository(h.folder, 'api');
  withOrigin(h.base, path);
  writeFileSync(join(path, 'notes.txt'), 'mine\n');
  const before = everything(path);
  const fetched = readFileSync(join(path, '.git', 'HEAD'), 'utf8');

  await h.watch();
  await h.nextDay();

  assert.equal(everything(path), before);
  assert.equal(readFileSync(join(path, '.git', 'HEAD'), 'utf8'), fetched);
});

test('a folder that cannot be read leaves a quiet watch, not a failure', async t => {
  const h = fixture(t);

  await watchFolder(h.root, { folder: join(h.folder, 'missing'), now: h.clock });

  assert.deepEqual(readWatch(h.root).seen, {});
});

test('a watch of another folder starts from nothing there too', async t => {
  const h = fixture(t);
  await h.watch();
  const other = join(h.base, 'Work');
  mkdirSync(other);
  repository(other, 'client');

  await watchFolder(h.root, { folder: other, now: h.clock + DAY });

  assert.deepEqual(h.proposed(), []);
});
