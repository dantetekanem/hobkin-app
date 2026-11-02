import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chooseProject, fileItem, readItems, updateItem } from '../src/cli/work/store.mjs';
import { ghWithin, readUnmerged, surveyUnmerged, unmergedNow } from '../src/cli/work/unmerged.mjs';
import { branched, git, pull, repository, withOrigin } from './helpers/work-fixture.mjs';

const HOUR = 3600000;
const NOW = Date.parse('2026-06-01T12:00:00Z');
const MERGED_AT = '2026-05-30T09:00:00.000Z';
const iso = time => new Date(time).toISOString();

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-merged-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  const take = name => {
    const checkout = repository(base, name);
    chooseProject(root, checkout, 'important', NOW);
    return checkout;
  };
  return { root, take, checkout: take('api') };
}

const filing = (h, slug) => {
  const key = `fix ${readItems(h.root, slug).length + 1}`;
  return { key, kind: 'fix', title: key, brief: 'Evidence, who benefits, the first change, the proof.' };
};
function item(h, change, slug = 'api') {
  const { id } = fileItem(h.root, slug, filing(h, slug), NOW);
  return updateItem(h.root, slug, id, change, NOW);
}
const read = (h, { id }, slug = 'api') => readItems(h.root, slug).find(entry => entry.id === id);

const url = number => pull(number).url;
const merged = (number, details = {}) => pull(number, { state: 'MERGED', mergedAt: MERGED_AT, ...details });
const closed = (number, details = {}) => pull(number, { state: 'CLOSED', ...details });

const survey = (h, pulls, now = NOW) => surveyUnmerged(h.root, { now, gh: async () => JSON.stringify(pulls) });
const surveyWithNoGh = (h, now = NOW) => surveyUnmerged(h.root, { now, gh: async () => { throw Error('This repository has no remote.'); } });

const mergeHere = (checkout, branch) => git(checkout, 'merge', '-q', '--no-ff', '--no-edit', branch);

test('a merged PR closes the item that names it, with the date GitHub gives', async t => {
  const h = workspace(t);
  const shipped = item(h, { state: 'pr', pr: url(1), branch: 'hobkin/renamed-since' });

  const { settled, projects } = await survey(h, [merged(1)], NOW + HOUR);

  assert.deepEqual([read(h, shipped).state, read(h, shipped).mergedAt, read(h, shipped).updatedAt], ['merged', MERGED_AT, iso(NOW + HOUR)]);
  assert.deepEqual(settled, [{ slug: 'api', id: shipped.id, title: shipped.title, state: 'merged' }]);
  assert.equal(projects.api.lastMergeAt, MERGED_AT, 'the weekly review reads this');
});

test('a merged PR closes finished work found by its branch alone', async t => {
  const h = workspace(t);
  const recorded = item(h, { state: 'pr', pr: 'local branch hobkin/1-fix', branch: 'hobkin/1-fix' });
  const finished = item(h, { state: 'branch', branch: 'hobkin/2-fix' });

  await survey(h, [merged(1), merged(2)]);

  assert.deepEqual([recorded, finished].map(entry => read(h, entry).state), ['merged', 'merged']);
  assert.equal(read(h, finished).mergedAt, MERGED_AT);
});

test('a PR closed without merging leaves the work on its branch, and the idea is not filed again', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/1-fix');
  const kept = item(h, { state: 'pr', pr: url(1), branch: 'hobkin/1-fix' });

  const { settled } = await survey(h, [closed(1)]);

  const { state, pr, closedPr, branch, key } = read(h, kept);
  assert.deepEqual({ state, pr, closedPr, branch }, { state: 'branch', pr: null, closedPr: url(1), branch: 'hobkin/1-fix' });
  assert.deepEqual(settled, [{ slug: 'api', id: kept.id, title: kept.title, state: 'branch' }]);
  assert.equal(fileItem(h.root, 'api', { ...filing(h, 'api'), key }, NOW).id, kept.id);
  assert.equal(readItems(h.root, 'api').length, 1);
});

test('a branch kept after its PR closed is still open work, and an empty one is not', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/1-fix');
  git(h.checkout, 'branch', 'hobkin/2-fix');

  const { projects } = await survey(h, [closed(1), closed(2)]);

  assert.deepEqual(projects.api.open.map(unit => [unit.kind, unit.branch]), [['branch', 'hobkin/1-fix']]);
});

test('work kept after its PR closed closes when the user merges the branch and deletes it', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/1-fix');
  const kept = item(h, { state: 'pr', pr: url(1), branch: 'hobkin/1-fix' });
  await survey(h, [closed(1)]);

  mergeHere(h.checkout, 'hobkin/1-fix');
  git(h.checkout, 'branch', '-qd', 'hobkin/1-fix');
  const { settled } = await survey(h, [closed(1)], NOW + HOUR);

  assert.deepEqual([read(h, kept).state, read(h, kept).mergedAt], ['merged', iso(NOW + HOUR)]);
  assert.deepEqual(settled.map(({ state }) => state), ['merged']);
});

test('an item that knew only its PR learns its branch when that PR closes, so a later merge can still find it', async t => {
  const h = workspace(t);
  const kept = item(h, { state: 'pr', pr: url(1) });

  await survey(h, [closed(1)]);
  assert.deepEqual([read(h, kept).state, read(h, kept).branch], ['branch', 'hobkin/1-fix']);

  await survey(h, [merged(2, { headRefName: 'hobkin/1-fix' }), closed(1)], NOW + HOUR);
  assert.equal(read(h, kept).state, 'merged');
});

test('of several closed PRs on a head, an item keeps the one it named', async t => {
  const h = workspace(t);
  const head = { headRefName: 'hobkin/same-head' };
  const kept = item(h, { state: 'pr', pr: url(1), branch: head.headRefName });

  await survey(h, [closed(2, head), closed(1, head)]);

  assert.equal(read(h, kept).closedPr, url(1));
});

test('a head with an open PR is still open, whatever older closed PRs it has', async t => {
  const h = workspace(t);
  const head = { headRefName: 'hobkin/same-head' };
  const byUrl = item(h, { state: 'pr', pr: url(1), branch: head.headRefName });
  const byBranch = item(h, { state: 'pr', pr: 'local branch hobkin/same-head', branch: head.headRefName });
  const urlOnly = item(h, { state: 'pr', pr: url(1) });

  const { settled } = await survey(h, [pull(2, head), closed(1, head)]);

  assert.deepEqual([byUrl, byBranch, urlOnly].map(entry => read(h, entry).state), ['pr', 'pr', 'pr']);
  assert.equal(read(h, byUrl).pr, url(1));
  assert.deepEqual(settled, []);
});

test('an open PR outranks a branch the default branch already holds', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/1-fix');
  mergeHere(h.checkout, 'hobkin/1-fix');
  const inReview = item(h, { state: 'pr', pr: url(1), branch: 'hobkin/1-fix' });

  const { settled } = await survey(h, [pull(1)]);

  assert.equal(read(h, inReview).state, 'pr');
  assert.deepEqual(settled, []);
});

test('merged beats closed, in whichever order GitHub lists them', async t => {
  const h = workspace(t);
  const first = item(h, { state: 'pr', pr: url(1), branch: 'hobkin/first' });
  const second = item(h, { state: 'pr', pr: url(3), branch: 'hobkin/second' });

  await survey(h, [
    closed(1, { headRefName: 'hobkin/first' }), merged(2, { headRefName: 'hobkin/first' }),
    merged(4, { headRefName: 'hobkin/second' }), closed(3, { headRefName: 'hobkin/second' }),
  ]);

  assert.deepEqual([first, second].map(entry => read(h, entry).state), ['merged', 'merged']);
  assert.equal(read(h, first).mergedAt, MERGED_AT);
});

test('the PR an item names speaks first: merged closes it, and still open keeps it', async t => {
  const h = workspace(t);
  const landed = item(h, { state: 'pr', pr: url(1), branch: 'hobkin/one' });
  const going = item(h, { state: 'pr', pr: url(4), branch: 'hobkin/two' });

  await survey(h, [
    pull(2, { headRefName: 'hobkin/one' }), merged(1, { headRefName: 'hobkin/one' }),
    pull(4, { headRefName: 'hobkin/two' }), merged(3, { headRefName: 'hobkin/two' }),
  ]);

  assert.deepEqual([landed, going].map(entry => read(h, entry).state), ['merged', 'pr']);
});

test('a branch the default branch holds closes finished work, dated now because git keeps no date', async t => {
  const h = workspace(t);
  for (const name of ['hobkin/one', 'hobkin/two', 'hobkin/three']) branched(h.checkout, name);
  mergeHere(h.checkout, 'hobkin/one');
  mergeHere(h.checkout, 'hobkin/two');
  const finished = item(h, { state: 'branch', branch: 'hobkin/one' });
  const recorded = item(h, { state: 'pr', pr: 'local branch hobkin/two', branch: 'hobkin/two' });
  const unmerged = item(h, { state: 'branch', branch: 'hobkin/three' });

  const { settled } = await surveyWithNoGh(h);

  assert.deepEqual([finished, recorded].map(entry => [read(h, entry).state, read(h, entry).mergedAt]), [['merged', iso(NOW)], ['merged', iso(NOW)]]);
  assert.equal(read(h, unmerged).state, 'branch');
  assert.deepEqual(settled.map(({ id }) => id), [finished.id, recorded.id]);
});

test('a branch deleted after its merge closes its item, because the last survey saw where it ended', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/merged');
  branched(h.checkout, 'hobkin/thrown-away');
  const landed = item(h, { state: 'branch', branch: 'hobkin/merged' });
  const abandoned = item(h, { state: 'branch', branch: 'hobkin/thrown-away' });
  await surveyWithNoGh(h);

  mergeHere(h.checkout, 'hobkin/merged');
  git(h.checkout, 'branch', '-qd', 'hobkin/merged');
  git(h.checkout, 'branch', '-qD', 'hobkin/thrown-away');
  const { projects } = await surveyWithNoGh(h, NOW + HOUR);

  assert.deepEqual([read(h, landed).state, read(h, landed).mergedAt], ['merged', iso(NOW + HOUR)]);
  assert.equal(read(h, abandoned).state, 'branch');
  assert.equal(projects.api.lastMergeAt, iso(NOW + HOUR));
});

test('a checked-out branch standing in for an unknown default branch proves nothing', async t => {
  const h = workspace(t);
  git(h.checkout, 'branch', '-qm', 'main', 'trunk');
  git(h.checkout, 'switch', '-qc', 'hobkin/one');
  git(h.checkout, 'commit', '-q', '--allow-empty', '-m', 'one');
  const finished = item(h, { state: 'branch', branch: 'hobkin/one' });

  const { projects } = await surveyWithNoGh(h);

  assert.equal(read(h, finished).state, 'branch');
  assert.deepEqual(projects.api.open.map(unit => unit.branch), ['hobkin/one']);
});

test('a new branch with no commits closes nothing unfinished, and neither does a closed PR', async t => {
  const h = workspace(t);
  const unfinished = ['open', 'doing', 'stuck'].map((state, index) => {
    const branch = `hobkin/${index + 1}-fix`;
    git(h.checkout, 'branch', branch);
    return item(h, { state, branch });
  });

  const { settled } = await survey(h, [closed(1), closed(3)]);

  assert.deepEqual(unfinished.map(entry => read(h, entry).state), ['open', 'doing', 'stuck']);
  assert.deepEqual(settled, []);
});

test('a merged PR closes unfinished work too', async t => {
  const h = workspace(t);
  const unfinished = ['open', 'doing', 'stuck'].map((state, index) => item(h, { state, branch: `hobkin/${index + 1}-fix` }));

  const { settled } = await survey(h, [merged(1), merged(2), merged(3)]);

  assert.deepEqual(unfinished.map(entry => read(h, entry).state), ['merged', 'merged', 'merged']);
  assert.equal(settled.length, 3);
});

test('a project that cannot be read closes nothing and keeps what it said, and the others carry on', async t => {
  const h = workspace(t);
  h.take('web');
  branched(h.checkout, 'hobkin/1-fix');
  const unread = item(h, { state: 'pr', pr: url(1), branch: 'hobkin/1-fix' });
  const landed = item(h, { state: 'pr', pr: url(2), branch: 'hobkin/2-fix' }, 'web');
  const { projects: before } = await survey(h, [pull(1)]);

  rmSync(h.checkout, { recursive: true, force: true });
  const { settled, projects } = await survey(h, [merged(1), merged(2)], NOW + HOUR);

  assert.equal(read(h, unread).state, 'pr', 'GitHub answered, but the project could not be read');
  assert.deepEqual(projects.api, before.api);
  assert.deepEqual(settled, [{ slug: 'web', id: landed.id, title: landed.title, state: 'merged' }]);
});

test('a gh that cannot answer closes no PR, because nothing says the PR ended', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/1-fix');
  const inReview = item(h, { state: 'pr', pr: url(1), branch: 'hobkin/1-fix' });

  const { settled } = await surveyWithNoGh(h);

  assert.equal(read(h, inReview).state, 'pr');
  assert.deepEqual(settled, []);
});

test('an item with no branch and no PR is left alone, and so is anything already closed', async t => {
  const h = workspace(t);
  const untouched = item(h, { state: 'open' });
  const finished = ['done', 'dropped', 'declined', 'noted'].map(state => item(h, { state, pr: url(1), branch: 'hobkin/1-fix' }));

  const { settled } = await survey(h, [merged(1)]);

  assert.equal(read(h, untouched).state, 'open');
  assert.deepEqual(finished.map(entry => read(h, entry).state), ['done', 'dropped', 'declined', 'noted']);
  assert.deepEqual(settled, []);
});

test('an item is closed once, so a second survey settles nothing and writes nothing', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/1-fix');
  const landed = item(h, { state: 'pr', pr: url(1), branch: 'hobkin/1-fix' });
  const kept = item(h, { state: 'pr', pr: url(2), branch: 'hobkin/1-fix-kept' });
  const pulls = [merged(1), closed(2, { headRefName: 'hobkin/1-fix-kept' })];
  await survey(h, pulls);
  const first = [landed, kept].map(entry => read(h, entry));

  const { settled } = await survey(h, pulls, NOW + HOUR);

  assert.deepEqual(settled, []);
  assert.deepEqual([landed, kept].map(entry => read(h, entry)), first);
});

test('an item can name a PR on any head, and the survey still counts only hobkin heads', async t => {
  const h = workspace(t);
  const byHand = item(h, { state: 'pr', pr: url(1) });

  const { projects } = await survey(h, [merged(1, { headRefName: 'feature/by-hand' }), pull(2, { headRefName: 'feature/other' })]);

  assert.equal(read(h, byHand).state, 'merged');
  assert.deepEqual(projects.api, { open: [], lastMergeAt: null, trees: 0 });
});

test('what is open now is only a count, for each project and in all', async t => {
  const h = workspace(t);
  h.take('web');
  assert.deepEqual(unmergedNow(h.root), { at: null, open: 0, perProject: {}, pending: {} });
  item(h, { state: 'pr', pr: url(2), branch: 'hobkin/2-fix' });
  item(h, { state: 'pr', pr: url(1), branch: 'hobkin/1-fix' }, 'web');

  await surveyUnmerged(h.root, { now: NOW, gh: async (_args, cwd) => JSON.stringify(cwd.endsWith('web') ? [pull(1)] : [pull(2), pull(3)]) });

  assert.deepEqual(unmergedNow(h.root), { at: iso(NOW), open: 3, perProject: { api: 2, web: 1 }, pending: { api: 1, web: 1 } });
  assert.deepEqual(Object.keys(readUnmerged(h.root)), ['at', 'projects']);
});

test('a fork is asked about its own PRs, because gh left to itself picks the repository it was forked from', async t => {
  const h = workspace(t);
  const origin = withOrigin(dirname(h.checkout), h.checkout);
  git(h.checkout, 'remote', 'add', 'upstream', 'https://github.com/someone/else.git');
  const asked = [];

  await surveyUnmerged(h.root, { now: NOW, gh: async args => { asked.push(args); return '[]'; } });

  assert.deepEqual(asked.map(args => args[args.indexOf('--repo') + 1]), [origin]);
});

test('a repository with no origin asks gh as it always has', async t => {
  const h = workspace(t);
  git(h.checkout, 'remote', 'add', 'upstream', 'https://github.com/someone/else.git');
  const asked = [];

  await surveyUnmerged(h.root, { now: NOW, gh: async args => { asked.push(args); return '[]'; } });

  assert.equal(asked.length, 1);
  assert.equal(asked[0].includes('--repo'), false);
});

test('a gh that hangs is killed instead of holding every survey after it, and the branches are still counted', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/1-fix');
  const bin = join(dirname(h.checkout), 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved}`;
  t.after(() => { process.env.PATH = saved; });
  const started = Date.now();

  await assert.rejects(ghWithin(50)(['pr', 'list'], h.checkout), { killed: true });
  const { projects } = await surveyUnmerged(h.root, { now: NOW, gh: ghWithin(50) });

  assert.ok(Date.now() - started < 5000);
  assert.deepEqual(projects.api.open.map(({ branch }) => branch), ['hobkin/1-fix']);
});

test('closing items writes nothing to the repository', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/1-fix');
  mergeHere(h.checkout, 'hobkin/1-fix');
  item(h, { state: 'branch', branch: 'hobkin/1-fix' });
  const seen = () => [git(h.checkout, 'for-each-ref'), git(h.checkout, 'status', '--porcelain'), git(h.checkout, 'rev-parse', 'HEAD')];
  const before = seen();

  await surveyWithNoGh(h);

  assert.deepEqual(seen(), before);
});
