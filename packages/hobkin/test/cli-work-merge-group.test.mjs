import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { mergeGroup } from '../src/cli/work/merge-group.mjs';
import { chooseProject, fileItem, readItems, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { branched, commit, git, repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-group-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  writeMode(root, { enabled: true });
  return { root, checkout };
}

const branchOf = title => `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;

/** Finished work on a branch of its own, as a group's row asks for it: at the commit its card showed. */
function finished(h, title, change = {}) {
  const branch = branchOf(title);
  branched(h.checkout, branch);
  const { id } = fileItem(h.root, 'api', { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, NOW);
  updateItem(h.root, 'api', id, { state: 'branch', branch, proof: 'The spec passes.', ...change }, NOW);
  return { slug: 'api', item: id, head: git(h.checkout, 'rev-parse', branch), how: 'merge' };
}

const itemOf = (h, { item }) => readItems(h.root, 'api').find(({ id }) => id === item);

test('one yes merges every row in turn, here or on its host, each at the commit its card showed', async t => {
  const h = workspace(t);
  const one = finished(h, 'Work one');
  const two = finished(h, 'Work two');
  const three = { ...finished(h, 'Work three', { state: 'pr', pr: 'https://example.com/pull/3' }), how: 'mergePr' };
  const asked = [];
  // A host that merges what it is asked to, and says so with the merge commit when read after.
  const gh = async args => {
    asked.push(args);
    if (args[1] === 'list') return JSON.stringify([{ url: 'https://example.com/pull/3' }]);
    return args[1] === 'view' ? JSON.stringify({ state: 'MERGED', mergedAt: '2026-06-01T12:00:00Z', mergeCommit: { oid: 'c'.repeat(40) } }) : '';
  };

  const answer = await mergeGroup(h.root, [one, two, three], { gh, now: NOW });

  assert.deepEqual([one, two, three].map(row => itemOf(h, row).state), ['merged', 'merged', 'merged']);
  assert.deepEqual([itemOf(h, one).landed.route, itemOf(h, two).landed.route], ['group', 'group']);
  assert.match(git(h.checkout, 'log', '-1', '--format=%s', 'main'), /Merge: Work two/);
  assert.deepEqual(asked.find(args => args[1] === 'merge'), ['pr', 'merge', 'https://example.com/pull/3', '--merge', '--match-head-commit', three.head]);
  assert.deepEqual(answer.walked, [
    { action: 'merge', slug: 'api', item: one.item },
    { action: 'merge', slug: 'api', item: two.item },
    { action: 'mergePr', slug: 'api', item: three.item },
  ]);
  const [first, second, third, sum] = answer.told;
  assert.deepEqual([first.did, first.title, second.title, third.did], ['merged it locally', 'Work one', 'Work two', 'merged the PR']);
  assert.match(sum.line, /^Merged all 3\b/);
  assert.equal(sum.heard, true, 'each row tells the main agent, so the sum is for Chat alone');
  assert.equal(answer.message, sum.line);
});

test('a row that cannot go says why in Chat, and the rest still go', async t => {
  const h = workspace(t);
  const moved = finished(h, 'Work one');
  git(h.checkout, 'switch', '-q', branchOf('Work one'));
  commit(h.checkout, 'more.txt', 'more\n');
  git(h.checkout, 'switch', '-q', 'main');
  const fine = finished(h, 'Work two');

  const answer = await mergeGroup(h.root, [moved, fine], { now: NOW });

  assert.deepEqual([itemOf(h, moved).state, itemOf(h, fine).state], ['branch', 'merged']);
  const [why, merged, sum] = answer.told;
  assert.deepEqual([why.did, why.project, why.title], ['could not merge it', 'api', 'Work one']);
  assert.match(why.line, /^"Work one" on api moved since it was offered, so nothing merged\./);
  assert.match(merged.line, /^Merged "Work two"/);
  assert.match(sum.line, /^Merged 1 of 2\b/);
  assert.deepEqual(answer.walked.map(({ item }) => item), [fine.item]);
});

test('a row the list has already lost is passed over, and the sum says so', async t => {
  const h = workspace(t);
  const gone = finished(h, 'Work one');
  updateItem(h.root, 'api', gone.item, { state: 'declined' }, NOW);
  const next = finished(h, 'Work two');

  const answer = await mergeGroup(h.root, [gone, next], { now: NOW });

  assert.equal(itemOf(h, gone).state, 'declined');
  assert.equal(itemOf(h, next).state, 'merged');
  assert.equal(answer.told.length, 2, 'one line for the merge, and the sum');
  assert.match(answer.message, /already gone/);
});

test('each row of a refresh group goes to an agent, or with work mode off to the main agent, to hand to a session', async t => {
  const h = workspace(t);
  const queued = { ...finished(h, 'Work one'), how: 'refreshMerge' };
  const handed = { ...finished(h, 'Work two'), how: 'refreshMerge' };

  const sent = await mergeGroup(h.root, [queued], { now: NOW });
  writeMode(h.root, { enabled: false });
  const passed = await mergeGroup(h.root, [handed], { now: NOW });

  assert.equal(itemOf(h, queued).state, 'open');
  assert.ok(itemOf(h, queued).mergeWhenFresh, 'the word to merge it waits on its item');
  assert.deepEqual(sent.handOff, []);
  assert.equal(itemOf(h, handed).state, 'branch');
  assert.deepEqual(passed.handOff.map(({ title, why }) => [title, why]), [['Work two', 'work mode is off']]);
  assert.deepEqual([sent.told[0].did, passed.told[0].did], ['asked to refresh and merge it', 'asked to refresh and merge it']);
});
