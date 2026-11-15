import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientNoticesToPost } from '../src/cli/client-notices.mjs';
import { initialize } from '../src/cli/config.mjs';
import { afterMerges } from '../src/cli/work/after-merge.mjs';
import { cardActionsToPost, recordCardAction } from '../src/cli/work/card-actions.mjs';
import { mergeRefreshed, refreshThenMerge } from '../src/cli/work/refresh.mjs';
import { chooseProject, fileItem, readItems, updateItem, writeMode, writeOwnerView } from '../src/cli/work/store.mjs';
import { closingItems, readyItems } from '../src/cli/work/reads.mjs';
import { branched, commit, git, repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-refresh-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  writeMode(root, { enabled: true });
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

test('a refresh that left something new for the user still merges on their word, and what it left is told in Chat', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'job.txt');
  const item = finished(h, 'hobkin/abc', { left: 'Rename the job.' });
  refreshThenMerge(h.root, 'api', item.id, { now: NOW + 1000 });

  refreshEnds(h, item, { left: 'The rebase dropped a migration. Check it before deploying.' });
  const [merged] = await mergeRefreshed(h.root, { now: NOW + 3000 });
  await afterMerges(h.root, { now: NOW + 4000, gh: async args => assert.fail(`gh was asked ${args.join(' ')}`) });

  assert.equal(merged?.ok, true);
  assert.equal(read(h, item).state, 'merged');
  assert.deepEqual(clientNoticesToPost(h.root).map(({ line }) => line), ['Merged "Fix the job spec" on api. Still for you: The rebase dropped a migration. Check it before deploying.']);
});

test('a merge after its refresh is one line in Chat, with what the refresh left in it', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'job.txt');
  const item = finished(h, 'hobkin/abc');
  refreshThenMerge(h.root, 'api', item.id, { now: NOW + 1000 });

  refreshEnds(h, item, { left: 'Check the migration.' });
  // The app tells each result like an action on a card.
  for (const { told } of await mergeRefreshed(h.root, { now: NOW + 3000 })) recordCardAction(h.root, told, NOW + 3000);
  await afterMerges(h.root, { now: NOW + 4000, gh: async args => assert.fail(`gh was asked ${args.join(' ')}`) });

  const chat = [...cardActionsToPost(h.root, NOW + 4000).map(({ line }) => line), ...clientNoticesToPost(h.root).map(({ line }) => line)];
  assert.deepEqual(chat, ['After its refresh, merged "Fix the job spec" into main on api. Nothing was pushed. Still for you: Check the migration.']);
});

test('an empty left is nothing left, before the refresh and after it, so the refreshed branch merges', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'job.txt');
  const item = finished(h, 'hobkin/abc', { left: '' });
  refreshThenMerge(h.root, 'api', item.id, { now: NOW + 1000 });

  refreshEnds(h, item, { left: '' });
  const [merged] = await mergeRefreshed(h.root, { now: NOW + 3000 });

  assert.equal(merged?.ok, true);
  assert.equal(read(h, item).state, 'merged');
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

test('with work mode off or paused, refresh and merge goes to the main agent to hand to a session, and queues nothing', t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'job.txt');
  const item = finished(h, 'hobkin/abc');
  writeMode(h.root, { enabled: false });

  const off = refreshThenMerge(h.root, 'api', item.id, { now: NOW + 1000 });
  writeMode(h.root, { enabled: true, pausedAt: new Date(NOW).toISOString() });
  const paused = refreshThenMerge(h.root, 'api', item.id, { now: NOW + 1000 });

  assert.equal(read(h, item).state, 'branch');
  assert.equal(read(h, item).mergeWhenFresh, undefined);
  assert.deepEqual(off.handOff, {
    project: 'api',
    item: item.id,
    title: 'Fix the job spec',
    branch: 'hobkin/abc',
    asked: 'Bring the branch up to date with the default branch, run its proof again, then merge it with hobkin work merge.',
    why: 'work mode is off',
  });
  assert.equal(paused.handOff.why, 'work mode is paused');
  assert.match(off.message, /^Work mode is off, so the main agent starts a session to bring "Fix the job spec" on api up to date/);
  assert.equal(off.told.did, 'asked to refresh and merge it');
});

test('only finished work can be refreshed', t => {
  const h = workspace(t);
  const { id } = fileItem(h.root, 'api', { key: 'new', kind: 'fix', title: 'Not started', brief: 'Evidence.' }, NOW);

  assert.throws(() => refreshThenMerge(h.root, 'api', id, { now: NOW }), /"Not started" is open, so there is no branch to refresh\./);
});

test('refresh and merge takes work an agent once called done while its branch still waits, and one the user closed it refuses', t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/said', 'said.txt', 'said\n');
  const said = finished(h, 'hobkin/said', { state: 'done' });
  const closed = finished(h, 'hobkin/closed', { state: 'done', closedByUser: true });

  refreshThenMerge(h.root, 'api', said.id, { now: NOW });

  assert.equal(read(h, said).state, 'open');
  assert.ok(read(h, said).mergeWhenFresh, 'it merges once the refresh ends well');
  assert.throws(() => refreshThenMerge(h.root, 'api', closed.id, { now: NOW }), /is done, so there is no branch to refresh/);
});

test('a refresh handed to the main agent takes its card out of Decisions while a session has it, and brings it back if nothing comes of it', t => {
  const h = workspace(t);
  writeMode(h.root, { enabled: false });
  branched(h.checkout, 'hobkin/fix', 'fix.txt', 'fix\n');
  const item = finished(h, 'hobkin/fix');

  const { handOff } = refreshThenMerge(h.root, 'api', item.id, { now: Date.now() });

  assert.equal(handOff.item, item.id);
  assert.equal(readyItems(h.root)[0].gap, 'closing', 'the card waits out of the list, with the agent');
  assert.deepEqual(closingItems(h.root).map(({ doing }) => doing), ['refreshing it, then merging it']);

  updateItem(h.root, 'api', item.id, { withMainAgent: { until: new Date(Date.now() - 1000).toISOString() } });
  assert.equal(readyItems(h.root)[0].gap, 'land', 'a hand-off that ran out brings the card back');
});

test('a refresh whose run is still going waits to merge, keeps the user\'s word, and merges once the run has ended', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'job.txt');
  commit(h.checkout, 'other.txt', 'main moved on\n');
  const item = finished(h, 'hobkin/abc');
  refreshThenMerge(h.root, 'api', item.id, { now: NOW + 1000 });

  // The run records the branch finished before it ends: for that moment it is both finished and still running.
  refreshEnds(h, item);
  writeOwnerView(h.root, { running: [{ id: 'work:api:do:1', slug: 'api', item: item.id, lane: 'do', title: 'api: Fix the job spec' }] });
  writeFileSync(join(h.root, 'runtime.lock'), '');

  assert.deepEqual(await mergeRefreshed(h.root, { now: NOW + 3000 }), [], 'nothing is tried while its run is going');
  assert.ok(read(h, item).mergeWhenFresh, 'the word to merge is kept');
  assert.equal(read(h, item).state, 'branch');

  writeOwnerView(h.root, { running: [] });
  const merged = await mergeRefreshed(h.root, { now: NOW + 4000 });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].ok, true);
  assert.equal(read(h, item).state, 'merged');
});
