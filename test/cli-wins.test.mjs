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

test('wins count what merged and what the user decided today, and how many days in a row something got done', t => {
  const root = dataRoot(t);
  const slug = site(root);
  merged(root, slug, 'One', NOW - HOUR);
  merged(root, slug, 'Two', daysAgo(1));
  merged(root, slug, 'Old', daysAgo(5));
  recordEvent(root, 'decision_answered', { source: 'routine' }, NOW - 2 * HOUR);
  recordEvent(root, 'decision_answered', { source: 'pending' }, NOW - 2 * HOUR);
  recordCardAction(root, { did: 'said no', project: 'site', item: 'x', title: 'X', line: 'Said no to "X" on site.' }, NOW - HOUR / 6);
  recordEvent(root, 'decision_answered', { source: 'work' }, daysAgo(2));

  const { today, streak } = winsNow(root, NOW);

  assert.deepEqual(today, { merged: 1, decided: 2 }, 'the card that asks how to tackle the pile is not a decision of its own');
  assert.equal(streak, 3, 'today, yesterday and the day before');
});

test('with nothing done yet today, the streak still counts up to yesterday', t => {
  const root = dataRoot(t);
  merged(root, site(root), 'Two', daysAgo(1));

  assert.deepEqual(winsNow(root, NOW), { today: { merged: 0, decided: 0 }, streak: 1 });
});

test('Chat hears about yesterday once a day, and the first look only remembers', t => {
  const root = dataRoot(t);
  merged(root, site(root), 'Two', daysAgo(1));
  recordEvent(root, 'decision_answered', { source: 'routine' }, daysAgo(1));
  recordEvent(root, 'decision_answered', { source: 'routine' }, daysAgo(2));

  assert.equal(yesterdayLine(root, daysAgo(1) + HOUR), null, 'the first look only remembers');
  assert.equal(yesterdayLine(root, NOW), 'Yesterday: 1 merged and 1 decided. 2 days in a row.');
  assert.equal(yesterdayLine(root, NOW + HOUR), null, 'once a day');
});

test('hobkin wins prints each day, today and the streak as JSON', async t => {
  const root = dataRoot(t);
  merged(root, site(root), 'One', Date.now() - 60000);
  let text = '';

  assert.equal(await main(['wins', '--days', '3', '--home', root], { write: chunk => { text += chunk; } }), 0);

  const { today, streak, days } = JSON.parse(text);
  assert.deepEqual(today, { merged: 1, decided: 0 });
  assert.equal(streak, 1);
  assert.equal(days.length, 3);
  assert.deepEqual(days.at(-1).merged, 1);
});
