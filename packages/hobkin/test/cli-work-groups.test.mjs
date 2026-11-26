import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvalGroups, groupPlan, landingWay, shownTitle } from '../src/cli/work/groups.mjs';

// A row as Decisions and Done get it: finished on its branch, up to date with its base, nothing in its way, and proved.
const row = (item, details = {}) => ({
  slug: 'site',
  project: 'website',
  item,
  title: `Work ${item}`,
  head: `${item}-head`,
  gap: 'land',
  conflict: false,
  behind: 0,
  proved: true,
  safety: null,
  ...details,
});
const other = (item, details = {}) => row(item, { slug: 'api', project: 'finboard-api', ...details });
const groupsOf = rows => approvalGroups(rows).map(({ name, rows: members }) => [name, members.map(({ item }) => item)]);

test('work with proof and nothing in its way is ready to merge, graded or not, and a grade from an older commit holds nothing back', () => {
  const rows = [
    row('unrated'),
    row('safe', { safety: { grade: 'safe', rating: 'A' } }),
    row('older', { safety: { grade: 'risky', rating: 'D', stale: true } }),
    row('pr', { pr: 'https://example.com/pull/1', behind: null }),
  ];

  assert.deepEqual(groupsOf(rows), [['merge', ['unrated', 'safe', 'older', 'pr']]]);
});

test('a branch behind its base is refreshed then merged, and what one yes cannot carry needs the user', () => {
  const rows = [
    row('behind', { behind: 3 }),
    row('conflict', { conflict: true, gap: 'rebase' }),
    row('unknown', { conflict: null }),
    row('unproved', { proved: false }),
    row('medium', { safety: { grade: 'medium', rating: 'C' } }),
    row('risky', { safety: { grade: 'risky', rating: 'D' } }),
    row('left', { left: 'Rotate the key at Google first.' }),
    row('holds', { holds: 2 }),
    row('unread', { pr: 'https://example.com/pull/2', behind: null, unread: 'the last survey did not read its head' }),
    row('headless', { head: null }),
    row('behind-unproved', { behind: 2, proved: false }),
  ];

  assert.deepEqual(groupsOf(rows), [
    ['refresh', ['behind']],
    ['needs', ['conflict', 'unknown', 'unproved', 'medium', 'risky', 'left', 'holds', 'unread', 'headless', 'behind-unproved']],
  ]);
});

test('inside a group a project\'s rows sit together, in the order its first row came, so the most urgent stays on top', () => {
  const rows = [row('one'), other('two'), row('three'), other('four'), other('five', { behind: 1 }), row('six', { behind: 1 })];

  assert.deepEqual(groupsOf(rows), [['merge', ['one', 'three', 'two', 'four']], ['refresh', ['five', 'six']]]);
});

test('a PR lands on its host, a branch behind its base after its refresh, and any other branch on this machine', () => {
  assert.equal(landingWay(row('local')), 'merge');
  assert.equal(landingWay(row('pr', { pr: 'https://example.com/pull/1', behind: null })), 'mergePr');
  assert.equal(landingWay(row('behind', { behind: 2 })), 'refreshMerge');
});

test('a title shows without the Review locally: a batch put in front of it, and any other title stays whole', () => {
  assert.equal(shownTitle('Review locally: Patch four build dependencies'), 'Patch four build dependencies');
  assert.equal(shownTitle('Review the busy-fetch retry proposal'), 'Review the busy-fetch retry proposal');
  assert.equal(shownTitle('Keep the review locally: notes'), 'Keep the review locally: notes');
  assert.equal(shownTitle('Review locally: '), 'Review locally: ', 'nothing would be left to show');
});

test('a group\'s confirmation lists every row it carries out, by project, numbered in the order they go, with the titles shown', () => {
  const rows = [row('one', { title: 'Review locally: Work one' }), other('two', { pr: 'https://example.com/pull/2', behind: null }), row('three')];
  const [{ name, rows: members }] = approvalGroups(rows);

  const { projects } = groupPlan(name, members);

  assert.deepEqual(projects.map(({ project, steps }) => [project, steps.map(({ number, title }) => [number, title])]), [
    ['website', [[1, 'Work one'], [2, 'Work three']]],
    ['finboard-api', [[3, 'Work two']]],
  ]);
});
