import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { carryOutAnswer } from '../src/cli/answer.mjs';
import { initialize } from '../src/cli/config.mjs';
import { openDecisions } from '../src/cli/decisions.mjs';
import { resumeWork } from '../src/cli/work/controls.mjs';
import { readMode, writeMode } from '../src/cli/work/store.mjs';
import { answerSubscriptionPause, offerSubscriptionPause, retireSubscriptionPause } from '../src/cli/work/subscription.mjs';

const NOW = new Date(2026, 5, 1, 12, 0).getTime();
const HOUR = 3600000;

function home(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-subscription-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  writeMode(root, { enabled: true });
  return root;
}

// The week a third gone and nearly two thirds used, as the user saw it: the clock catches up at 20:09.
const ahead = { label: 'week', usedPercent: 63.6, elapsedPercent: 32.2, until: new Date(2026, 5, 1, 20, 9).getTime() };

test('work ahead of the subscription\'s pace is told in Chat and asked about once a day, with keep working first', t => {
  const root = home(t);

  assert.equal(offerSubscriptionPause(root, ahead, NOW), true);
  assert.equal(offerSubscriptionPause(root, ahead, NOW + HOUR), false, 'once a day for a window');

  const [asked] = openDecisions(root);
  assert.equal(asked.tldr, 'Pause work until 20:09 today to protect the subscription?');
  assert.match(asked.question, /^64% of the week window is used, with 32% of its time gone\. Pause new work until 20:09 today/);
  assert.deepEqual(asked.choices.map(({ label }) => label), ['Keep working', 'Pause until 20:09 today']);
  assert.equal(readMode(root).pauseNotice.line, '64% of the week window is used, with 32% of its time gone. Work keeps going unless you pause it.');
});

test('pausing waits until the time it named, keep working pauses nothing, and resume ends the pause early', t => {
  const root = home(t);

  assert.equal(answerSubscriptionPause(root, 'keep', ahead.until, NOW).message, 'Work keeps going.');
  assert.equal(readMode(root).subscriptionPause, undefined);

  const paused = answerSubscriptionPause(root, 'pause', ahead.until, NOW);
  assert.match(paused.message, /^New work waits until 20:09 today to protect the subscription\./);
  assert.equal(readMode(root).subscriptionPause.until, new Date(ahead.until).toISOString());

  resumeWork(root);
  assert.equal(readMode(root).subscriptionPause, null);
});

test('keep working holds until the time the question named, so the next day asks nothing before then, and after it asks again', async t => {
  const root = home(t);
  const DAY = 24 * HOUR;
  const week = { ...ahead, usedPercent: 81, until: NOW + 4 * DAY };

  offerSubscriptionPause(root, week, NOW);
  const [asked] = openDecisions(root);
  await carryOutAnswer(root, asked.id, { value: 'keep' }, NOW + HOUR);

  assert.equal(offerSubscriptionPause(root, { ...week, usedPercent: 95 }, NOW + DAY), false, 'the next day, further ahead, asks nothing');
  assert.equal(offerSubscriptionPause(root, { ...week, usedPercent: 95 }, NOW + DAY + HOUR), false);
  assert.equal(offerSubscriptionPause(root, { ...week, until: NOW + 6 * DAY }, NOW + 4 * DAY + HOUR), true, 'past that time it asks again');
});

test('hobkin closing a question once the window caught up is no keep working from the user, so a later day asks again', t => {
  const root = home(t);
  const DAY = 24 * HOUR;
  const week = { ...ahead, until: NOW + 4 * DAY };

  offerSubscriptionPause(root, week, NOW);
  retireSubscriptionPause(root, null, NOW + HOUR);

  assert.equal(offerSubscriptionPause(root, week, NOW + DAY), true);
});

test('nothing is asked with work mode off or paused, and a question closes once the window has caught up', t => {
  const root = home(t);
  writeMode(root, { enabled: false });
  assert.equal(offerSubscriptionPause(root, ahead, NOW), false);
  writeMode(root, { enabled: true, pausedAt: new Date(NOW).toISOString() });
  assert.equal(offerSubscriptionPause(root, ahead, NOW), false);

  writeMode(root, { pausedAt: null });
  offerSubscriptionPause(root, ahead, NOW);
  retireSubscriptionPause(root, null, NOW + HOUR);

  assert.deepEqual(openDecisions(root), []);
});
