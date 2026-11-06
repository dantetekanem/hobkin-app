import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canShowCard, PRESENT_MS, pendingCard, waitingRows } from '../src/cli/pending.mjs';

const NOW = Date.parse('2026-11-02T15:00:00Z');
const HOUR_MS = 3600000;
const ago = hours => new Date(NOW - hours * HOUR_MS).toISOString();
const safeA = { grade: 'safe', rating: 'A' };
const size = lines => ({ additions: lines, deletions: 0, files: 1 });
const branch = (item, fields = {}) => ({ slug: 'api', project: 'api', item, title: `Fix ${item}`, gap: 'land', conflict: false, size: size(10), proved: false, ...fields });
const report = (id, body, fields = {}) => ({ id, title: 'Mail', scheduleId: 'mail', at: ago(1), outcome: 'completed', body, ...fields });
const decision = (id, fields = {}) => ({ id, from: 'Routine mail', tldr: `Question ${id}`, at: ago(2), answerTo: { kind: 'routine', id: 'mail' }, ...fields });
const card = input => pendingCard({ now: NOW, ...input });
const groupOf = (result, name) => result.groups.find(group => group.name === name);

test('nothing waiting is an empty card with no rows at all', () => {
  assert.deepEqual(card({}), { total: 0, groups: [] });
});

test('a branch with proof and nothing in its way is ready, graded or not, and the fact adds up its lines', () => {
  const result = card({ ready: [
    branch('rated', { safety: safeA, proved: true, size: size(84) }),
    branch('ungraded', { proved: true, size: size(26) }),
    branch('stale', { safety: { ...safeA, stale: true }, proved: true, size: size(11) }),
  ] });

  assert.deepEqual(groupOf(result, 'ready'), { name: 'ready', count: 3, label: 'ready', fact: 'with proof, about 120 lines' });
});

test('an offer makes a branch ready, whatever else the row says', () => {
  const result = card({ ready: [branch('a', { offer: { pattern: 'api/fix/app' } })] });

  assert.equal(groupOf(result, 'ready').count, 1);
});

test('no proof, a poor build, a conflict or a grade below safe at this commit is not ready', () => {
  const result = card({ ready: [
    branch('unproved', { safety: safeA }),
    branch('poor', { safety: safeA, proved: true, quality: { rating: 'C' } }),
    branch('conflict', { safety: safeA, proved: true, gap: 'rebase', conflict: true }),
    branch('medium', { safety: { grade: 'medium', rating: 'B' }, proved: true }),
  ] });

  assert.equal(groupOf(result, 'ready'), undefined);
  assert.equal(groupOf(result, 'read').count, 4);
});

test('branches to read say how much and how far it spreads', () => {
  const result = card({ ready: [
    branch('a', { size: size(9000) }),
    branch('b', { slug: 'site', project: 'site', size: size(5200), gap: 'unlanded' }),
    branch('c', { gap: 'elsewhere', size: size(0) }),
  ] });

  assert.deepEqual(groupOf(result, 'read'), { name: 'read', count: 3, label: 'to read', fact: '14k lines across 2 projects' });
});

test('one project is named, and lines under a thousand stay whole', () => {
  const result = card({ ready: [branch('a', { size: size(120) })] });

  assert.equal(groupOf(result, 'read').fact, '120 lines in api');
});

test('rows an agent is on, or that sit under another branch, ask nothing of the user', () => {
  assert.equal(card({ ready: [branch('a', { gap: 'closing' }), branch('b', { gap: 'stacked' })] }).total, 0);
});

test('only a report with a Next line counts, and only until it is read', () => {
  const result = card({
    reports: [
      report('plain', 'Useful: The bank wrote.', { scheduleId: 'bank' }),
      report('quiet', 'Nothing new.', { scheduleId: 'news' }),
      report('call', 'Useful: The bank wrote.\n\nNext: Reply by Friday.', { scheduleId: 'site' }),
      report('seen', 'Useful: Rent is due.\n\nNext: Pay it.', { scheduleId: 'rent' }),
    ],
    read: new Set(['seen']),
  });

  assert.deepEqual(groupOf(result, 'read'), { name: 'read', count: 1, label: 'to read', fact: '1 report, oldest 1 hour' });
});

test('a routine that says the same thing every day is one call, its newest', () => {
  const result = card({ reports: [
    report('old', 'Useful: One.\n\nNext: Do it.', { at: ago(50) }),
    report('new', 'Useful: Two.\n\nNext: Do it.', { at: ago(2) }),
  ] });

  assert.deepEqual(groupOf(result, 'read'), { name: 'read', count: 1, label: 'to read', fact: '1 report, oldest 2 hours' });
});

test('branches and reports to read share one row', () => {
  const result = card({ ready: [branch('a', { size: size(50) })], reports: [report('call', 'Useful: Two.\n\nNext: Do it.')] });

  assert.equal(groupOf(result, 'read').count, 2);
  assert.equal(groupOf(result, 'read').fact, '50 lines in api, 1 report');
});

test('a launch in trouble stays on the card once its watch closes, until its fix is finished', () => {
  const closed = { slug: 'finboard', project: 'finboard', item: 'abc', stage: 'closed', outcome: 'trouble', note: 'new error' };

  assert.deepEqual(card({ launches: [closed] }).groups.map(({ name }) => name), ['wrong']);
  assert.deepEqual(card({ launches: [{ ...closed, fixed: true }] }).groups, []);
});

test('trouble on a launch went wrong, and it says where and since when', () => {
  const liveAt = new Date(2026, 10, 2, 14, 2).toISOString();
  const result = pendingCard({ now: new Date(2026, 10, 2, 16, 0).getTime(), launches: [
    { slug: 'finboard', project: 'finboard', item: 'abc', stage: 'live', outcome: 'trouble', note: 'new error', liveAt },
    { slug: 'site', project: 'site', item: 'def', stage: 'live', outcome: 'held', note: 'nothing new', liveAt },
  ] });

  assert.deepEqual(groupOf(result, 'wrong'), { name: 'wrong', count: 1, label: 'went wrong', fact: 'finboard, new error since 14:02' });
});

test('a critical or blocked report with a Next line went wrong, and is not also to read', () => {
  const result = card({ reports: [report('bad', 'Critical: The site is down.\n\nNext: Restart it.')] });

  assert.deepEqual(groupOf(result, 'wrong'), { name: 'wrong', count: 1, label: 'went wrong', fact: 'Mail: Restart it.' });
  assert.equal(groupOf(result, 'read'), undefined);
});

test('questions are every open decision and ask, except those about branches that have their rows, or the old card', () => {
  const result = card({
    decisions: [
      decision('routine', { at: ago(72) }),
      decision('land', { answerTo: { kind: 'land' } }),
      decision('offer', { answerTo: { kind: 'merge', slug: 'api', item: 'abc', head: 'f00' } }),
      decision('pair', { answerTo: { kind: 'pair', rows: [] } }),
      decision('card', { answerTo: { kind: 'pending' } }),
    ],
    attention: [
      { kind: 'allowance', title: "Raise today's tokens to 2M?", slug: null, item: null },
      { kind: 'proposal', title: 'finboard', slug: 'finboard', item: null },
      { kind: 'pause', title: 'site is paused by hand.', slug: 'site', item: null },
    ],
    proposals: [{ id: 'abc123', kind: 'refactor', scope: 'mail', at: ago(10) }],
  });

  assert.deepEqual(groupOf(result, 'questions'), { name: 'questions', count: 4, label: 'questions', fact: 'oldest 3 days' });
});

test('with nothing dated the fact names the first question, and one question is singular', () => {
  const result = card({ attention: [{ kind: 'allowance', title: "Raise today's tokens to 2M?", slug: null, item: null }] });

  assert.deepEqual(groupOf(result, 'questions'), { name: 'questions', count: 1, label: 'question', fact: "Raise today's tokens to 2M?" });
});

test('steps only the user can take are counted once, from either place', () => {
  const result = card({
    ready: [branch('key', { gap: 'yours', title: 'Rotate a key' }), branch('left', { left: 'Renew Firebase', title: 'Renew Firebase' })],
    attention: [
      { kind: 'item', title: 'Rotate a key', slug: 'api', item: 'key' },
      { kind: 'item', title: 'Renew Firebase', slug: 'api', item: 'left' },
      { kind: 'item', title: 'Move the DNS', slug: 'site', item: 'dns' },
    ],
  });

  assert.deepEqual(groupOf(result, 'yours'), { name: 'yours', count: 3, label: 'yours', fact: 'Rotate a key, Renew Firebase' });
  assert.equal(result.total, 3);
});

test('rows come in one order, and an empty group has no row', () => {
  const result = card({
    ready: [branch('good', { proved: true }), branch('read')],
    decisions: [decision('one')],
    attention: [{ kind: 'item', title: 'Rotate a key', slug: 'api', item: 'key' }],
  });

  assert.deepEqual(result.groups.map(({ name }) => name), ['ready', 'read', 'questions', 'yours']);
  assert.equal(result.total, 4);
});

test('each thing the card counts is one row to list, by the same rules', () => {
  const given = {
    ready: [
      branch('good', { safety: safeA }),
      branch('read'),
      branch('done', { gap: 'unlanded' }),
      branch('copy', { gap: 'elsewhere', landedOn: 'release' }),
      branch('agent', { gap: 'closing' }),
      branch('under', { gap: 'stacked' }),
      branch('turn', { gap: 'yours', title: 'Turn on HTTPS' }),
      branch('keys', { left: 'Rotate the keys', title: 'Rotate the keys' }),
    ],
    attention: [
      { kind: 'item', title: 'Rotate the keys', slug: 'api', item: 'keys', reason: 'Rotate the keys' },
      { kind: 'item', title: 'Move the DNS', slug: 'site', item: 'dns', reason: 'Point it at the new host.' },
      { kind: 'allowance', title: "Raise today's tokens to 2M?", slug: null, item: null },
      { kind: 'pause', title: 'site is paused by hand.', slug: 'site', item: null },
    ],
    proposals: [{ id: 'abc123', kind: 'refactor', scope: 'mail', at: ago(10) }],
    launches: [{ slug: 'finboard', project: 'finboard', item: 'abc', outcome: 'trouble', note: 'new error' }],
    reports: [
      report('call', 'Useful: The bank wrote.\n\nNext: Reply by Friday.', { scheduleId: 'bank' }),
      report('bad', 'Critical: The site is down.\n\nNext: Restart it.', { scheduleId: 'site' }),
    ],
  };

  const rows = waitingRows({ now: NOW, ...given });

  const items = list => list.map(({ item }) => item);
  assert.deepEqual(items(rows.branches), ['good', 'read', 'done', 'copy']);
  assert.deepEqual(items(rows.yours), ['turn', 'keys', 'dns']);
  assert.equal(rows.yours[1].gap, 'land', 'a step on a finished branch keeps the branch, for its page');
  assert.deepEqual(rows.asks.map(({ kind }) => kind), ['allowance']);
  assert.deepEqual(rows.proposals.map(({ id }) => id), ['abc123']);
  assert.deepEqual(rows.wrong.map(({ key }) => key), ['launch:finboard:abc', 'report:bad']);
  assert.deepEqual(rows.reports.map(({ id }) => id), ['call']);
  const listed = Object.values(rows).reduce((sum, list) => sum + list.length, 0);
  assert.equal(listed, card(given).total, 'nothing the card counts is left out, and nothing is listed twice');
});

const free = { seenAt: NOW - 1000, away: false, occupied: false };

test('the user is there for two minutes after a key, a click or gaining focus', () => {
  assert.equal(canShowCard({ presence: free, busy: false, now: NOW }), true);
  assert.equal(canShowCard({ presence: { ...free, seenAt: NOW - PRESENT_MS + 1 }, busy: false, now: NOW }), true);
  assert.equal(canShowCard({ presence: { ...free, seenAt: NOW - PRESENT_MS }, busy: false, now: NOW }), false);
});

test('a terminal that lost focus, a screen in use or a running turn keeps a question away', () => {
  assert.equal(canShowCard({ presence: { ...free, away: true }, busy: false, now: NOW }), false);
  assert.equal(canShowCard({ presence: { ...free, occupied: true }, busy: false, now: NOW }), false);
  assert.equal(canShowCard({ presence: free, busy: true, now: NOW }), false);
});
