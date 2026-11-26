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

  assert.deepEqual(today, { merged: 1, decided: 2, asked: 1, good: true }, 'the card that asks how to tackle the pile is not a decision of its own');
  assert.equal(streak, 2, 'today and yesterday: answering a question two days ago made no good day');
});

test('a day that needed fewer decisions than the day before is a good day, with nothing merged', t => {
  const root = dataRoot(t);
  asked(root, daysAgo(3), 3);
  asked(root, daysAgo(2), 1);

  assert.deepEqual(winsNow(root, NOW), { today: { merged: 0, decided: 0, asked: 0, good: false }, streak: 2 }, 'two days ago went from 3 to 1, and yesterday to none');
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

  assert.deepEqual(winsNow(root, NOW), { today: { merged: 0, decided: 0, asked: 0, good: false }, streak: 1 });
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
  assert.deepEqual(today, { merged: 1, decided: 0, asked: 0, good: true });
  assert.equal(streak, 1);
  assert.equal(days.length, 3);
  assert.deepEqual(days.at(-1).merged, 1);
});
