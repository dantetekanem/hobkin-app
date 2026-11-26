import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEvent } from '../src/cli/events.mjs';
import { main } from '../src/cli/main.mjs';
import { recordCardAction } from '../src/cli/work/card-actions.mjs';
import { chooseProject, fileItem, updateItem } from '../src/cli/work/store.mjs';
import { winsNow, yesterdayLine } from '../src/cli/work/wins.mjs';

const HOUR = 3600000;
// Local times, because a day of wins is the user's own day.
const NOW = new Date(2026, 10, 3, 18, 0).getTime();
const daysAgo = days => new Date(2026, 10, 3 - days, 12, 0).getTime();
const iso = time => new Date(time).toISOString();

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-wins-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function merged(root, slug, title, at) {
  const { id } = fileItem(root, slug, { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, at - HOUR);
  updateItem(root, slug, id, { state: 'merged', landed: { sha: title, at: iso(at), route: 'key', read: 'page' } }, at);
}

const site = root => chooseProject(root, '/repos/site', 'important', daysAgo(30)).slug;

const asked = (root, at, count = 1, source = 'routine') => {
  for (let index = 0; index < count; index += 1) recordEvent(root, 'decision_filed', { id: `${at}-${index}`, source }, at);
};

test('wins count what merged, not what the user answered, and how many good days in a row', t => {
  const root = dataRoot(t);
  const slug = site(root);
  merged(root, slug, 'One', NOW - HOUR);
  merged(root, slug, 'Two', daysAgo(1));
  merged(root, slug, 'Old', daysAgo(5));
  recordEvent(root, 'decision_answered', { source: 'routine' }, NOW - 2 * HOUR);
  recordEvent(root, 'decision_answered', { source: 'pending' }, NOW - 2 * HOUR);
  recordCardAction(root, { did: 'said no', project: 'site', item: 'x', title: 'X', line: 'Said no to "X" on site.' }, NOW - HOUR / 6);
  recordEvent(root, 'decision_answered', { source: 'work' }, daysAgo(2));
  asked(root, NOW - 3 * HOUR);
  asked(root, NOW - 3 * HOUR, 1, 'pending');

  const { today, streak } = winsNow(root, NOW);

  assert.deepEqual(today, { merged: 1, decided: 2, asked: 1, good: true, soFar: true }, 'the card that asks how to tackle the pile is not a decision of its own');
  assert.equal(streak, 2, 'today and yesterday: answering a question two days ago made no good day');
});

test('a day that needed fewer decisions than the day before is a good day, with nothing merged', t => {
  const root = dataRoot(t);
  asked(root, daysAgo(3), 3);
  asked(root, daysAgo(2), 1);

  const { today, streak } = winsNow(root, NOW);
  assert.deepEqual(today, { merged: 0, decided: 0, asked: 0, good: null, soFar: true });
  assert.equal(streak, 2, 'two days ago went from 3 to 1, and yesterday to none');
});

test('today is so far: fewer questions than yesterday makes it good only once the day is over', t => {
  const root = dataRoot(t);
  asked(root, daysAgo(1), 3);
  const justAfterMidnight = new Date(2026, 10, 3, 0, 30).getTime();
  yesterdayLine(root, justAfterMidnight);

  const early = winsNow(root, justAfterMidnight);
  assert.deepEqual([early.today.good, early.today.soFar, early.streak], [null, true, 0], 'none asked yet is not yet fewer');

  asked(root, NOW, 1);
  const tomorrow = new Date(2026, 10, 4, 9, 0).getTime();
  const later = winsNow(root, tomorrow);
  assert.deepEqual(later.days.at(-2), { day: '2026-11-03', merged: 0, decided: 0, asked: 1, good: true, soFar: false });
  assert.equal(later.streak, 1);
  assert.equal(yesterdayLine(root, tomorrow), 'Yesterday: hobkin needed 1 decision from you, down from 3.');
});

test('the window gets the last seven days, oldest first, each good or not, with today last and so far', t => {
  const root = dataRoot(t);
  merged(root, site(root), 'Two', daysAgo(1));

  const { days } = winsNow(root, NOW);

  assert.deepEqual(days.map(({ day }) => day), ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
  assert.deepEqual(days.map(({ good }) => good), [false, false, false, false, false, true, null]);
  assert.deepEqual(days.map(({ soFar }) => soFar), [false, false, false, false, false, false, true]);
});

test('a group\'s yes counts each card it answered, and the line that sums them up is no decision of its own', t => {
  const root = dataRoot(t);
  for (const item of ['a', 'b']) {
    recordCardAction(root, { did: 'merged it locally', project: 'site', item, title: item, line: `Merged "${item}" into main on site.` }, NOW - HOUR);
  }
  recordCardAction(root, { did: 'summed up a group', line: 'Merged all 2 here, with nothing pushed.', heard: true }, NOW - HOUR);

  const { today } = winsNow(root, NOW);

  assert.equal(today.decided, 2);
});

test('with nothing done yet today, the streak still counts up to yesterday', t => {
  const root = dataRoot(t);
  merged(root, site(root), 'Two', daysAgo(1));

  const { today, streak } = winsNow(root, NOW);
  assert.deepEqual(today, { merged: 0, decided: 0, asked: 0, good: null, soFar: true });
  assert.equal(streak, 1);
});

test('Chat hears about yesterday once a day, and the first look only remembers', t => {
  const root = dataRoot(t);
  merged(root, site(root), 'Two', daysAgo(1));
  merged(root, site(root), 'Three', daysAgo(2));
  asked(root, daysAgo(1));
  asked(root, daysAgo(2), 2);
  recordEvent(root, 'decision_answered', { source: 'routine' }, daysAgo(1));

  assert.equal(yesterdayLine(root, daysAgo(1) + HOUR), null, 'the first look only remembers');
  assert.equal(yesterdayLine(root, NOW), 'Yesterday: 1 merged. hobkin needed 1 decision from you, down from 2. 2 days in a row.');
  assert.equal(yesterdayLine(root, NOW + HOUR), null, 'once a day');
});

test('a day that only answered questions says nothing, and one that needed none after some says so', t => {
  const answering = dataRoot(t);
  recordEvent(answering, 'decision_answered', { source: 'routine' }, daysAgo(1));
  yesterdayLine(answering, daysAgo(1));
  assert.equal(yesterdayLine(answering, NOW), null);

  const quiet = dataRoot(t);
  asked(quiet, daysAgo(2), 3);
  yesterdayLine(quiet, daysAgo(1));
  assert.equal(yesterdayLine(quiet, NOW), 'Yesterday: hobkin needed no decisions from you, down from 3.');
});

test('hobkin wins prints each day, today and the streak as JSON', async t => {
  const root = dataRoot(t);
  merged(root, site(root), 'One', Date.now() - 60000);
  let text = '';

  assert.equal(await main(['wins', '--days', '3', '--home', root], { write: chunk => { text += chunk; } }), 0);

  const { today, streak, days } = JSON.parse(text);
  assert.deepEqual(today, { merged: 1, decided: 0, asked: 0, good: true, soFar: true });
  assert.equal(streak, 1);
  assert.equal(days.length, 3);
  assert.deepEqual(days.at(-1).merged, 1);
});
