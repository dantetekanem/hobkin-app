import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { mergeRefreshed, refreshThenMerge } from '../src/cli/work/refresh.mjs';
import { chooseProject, fileItem, readItems, updateItem } from '../src/cli/work/store.mjs';
import { branched, commit, git, repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-refresh-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  return { root, checkout };
}

function finished(h, branch, change = {}) {
  const { id } = fileItem(h.root, 'api', { key: branch, kind: 'fix', title: 'Fix the job spec', brief: 'Evidence and first change.' }, NOW);
  return updateItem(h.root, 'api', id, { state: 'branch', branch, proof: 'The spec passes.', ...change }, NOW);
}

const read = (h, { id }) => readItems(h.root, 'api').find(item => item.id === id);
// What a run that brought the branch up to date leaves behind: the branch finished again, with its proof.
const refreshEnds = (h, item, change = {}) => updateItem(h.root, 'api', item.id, { state: 'branch', workNote: null, proof: 'The spec passes on main.', ...change }, NOW + 2000);

test('refresh and merge sends an agent to bring the branch up to date, and keeps the user\'s word to merge it', t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'job.txt');
  const item = finished(h, 'hobkin/abc');

  const said = refreshThenMerge(h.root, 'api', item.id, { read: 'page', readMs: 900, now: NOW + 1000 });

  const asked = read(h, item);
  assert.equal(asked.state, 'open');
  assert.match(asked.workNote, /up to date with the default branch/);
  assert.deepEqual(asked.mergeWhenFresh, { at: new Date(NOW + 1000).toISOString(), read: 'page', readMs: 900 });
  assert.match(said.message, /"Fix the job spec" on api .* merges it once that run ends well/);
  assert.deepEqual([said.told.did, said.told.title, said.told.line], ['asked to refresh and merge it', 'Fix the job spec', said.message]);
});

test('a refreshed branch merges once its run has ended well, and not before', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'job.txt');
  commit(h.checkout, 'other.txt', 'main moved on\n');
  const item = finished(h, 'hobkin/abc');
  refreshThenMerge(h.root, 'api', item.id, { now: NOW + 1000 });

  assert.deepEqual(await mergeRefreshed(h.root, { now: NOW + 1500 }), [], 'the refresh has not run yet');
  refreshEnds(h, item);
  const merged = await mergeRefreshed(h.root, { now: NOW + 3000 });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].ok, true);
  assert.match(merged[0].told.line, /^After its refresh, merged "Fix the job spec" into main on api\./);
  assert.equal(merged[0].told.did, 'merged it after its refresh');
  assert.equal(read(h, item).state, 'merged');
  assert.equal(read(h, item).mergeWhenFresh, null);
  assert.match(git(h.checkout, 'log', '--format=%s', 'main'), /Merge: Fix the job spec/);
  assert.deepEqual(await mergeRefreshed(h.root, { now: NOW + 4000 }), [], 'a merge happens once');
});

test('a refresh that left something for the user does not merge, and waits for them', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'job.txt');
  const item = finished(h, 'hobkin/abc');
  refreshThenMerge(h.root, 'api', item.id, { now: NOW + 1000 });

  refreshEnds(h, item, { left: 'The rebase dropped a migration. Check it before merging.' });

  assert.deepEqual(await mergeRefreshed(h.root, { now: NOW + 3000 }), []);
  assert.equal(read(h, item).state, 'branch');
});

test('a merge that fails after the refresh says why once, and the card goes back to the user', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'app.txt', 'branch side\n');
  commit(h.checkout, 'app.txt', 'main side\n');
  const item = finished(h, 'hobkin/abc');
  refreshThenMerge(h.root, 'api', item.id, { now: NOW + 1000 });
  refreshEnds(h, item);

  const tried = await mergeRefreshed(h.root, { now: NOW + 3000 });

  assert.equal(tried.length, 1);
  assert.equal(tried[0].ok, false);
  assert.match(tried[0].told.line, /^After its refresh, "Fix the job spec" conflicts with main/);
  assert.equal(read(h, item).state, 'branch');
  assert.equal(read(h, item).mergeWhenFresh, null);
  assert.deepEqual(await mergeRefreshed(h.root, { now: NOW + 4000 }), [], 'it does not try again by itself');
});

test('a refreshed PR merges on its host at whatever head the refresh left', async t => {
  const h = workspace(t);
  const item = finished(h, 'hobkin/8-fix', { state: 'pr', pr: 'https://example.com/pull/8' });
  const calls = [];
  refreshThenMerge(h.root, 'api', item.id, { now: NOW + 1000 });

  refreshEnds(h, item, { state: 'pr' });
  const merged = await mergeRefreshed(h.root, { now: NOW + 3000, gh: async args => { calls.push(args); } });

  assert.equal(merged[0].ok, true);
  assert.deepEqual(calls[0], ['pr', 'merge', 'https://example.com/pull/8', '--merge']);
});

test('only finished work can be refreshed', t => {
  const h = workspace(t);
  const { id } = fileItem(h.root, 'api', { key: 'new', kind: 'fix', title: 'Not started', brief: 'Evidence.' }, NOW);

  assert.throws(() => refreshThenMerge(h.root, 'api', id, { now: NOW }), /"Not started" is open, so there is no branch to refresh\./);
});
