import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import watchUsage from '../src/cli/work/usage-extension.mjs';
import { nextPause, openWindows, overReserve, readSubscription, usageLimitIn, usageWindows } from '../src/cli/work/usage.mjs';
import { writeJson } from './helpers/work-fixture.mjs';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const now = Date.parse('2026-06-01T12:00:00Z');

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-usage-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// A five-hour window that is `elapsed` old, and the week.
const fiveHours = (usedPercent, elapsed = 4 * HOUR) => ({ usedPercent, windowMinutes: 300, resetAt: now + 5 * HOUR - elapsed });
const week = (usedPercent, elapsed = 6 * 24 * HOUR) => ({ usedPercent, windowMinutes: 10080, resetAt: now + 7 * 24 * HOUR - elapsed });

test('with no reading there is nothing to say about the subscription, and nothing stops', () => {
  assert.equal(overReserve(null, now), null);
  assert.deepEqual(openWindows(null, now), []);
  assert.deepEqual(usageWindows(null, now), []);
});

test('a window keeps a reserve however late it is, so chat and checks always have some left', () => {
  assert.equal(overReserve({ primary: fiveHours(69) }, now), null);

  const over = overReserve({ primary: fiveHours(70) }, now);

  assert.deepEqual([over.label, over.usedPercent, over.allowedPercent], ['5h', 70, 70]);
  assert.equal(over.until, fiveHours(70).resetAt);
});

test('a window may not be spent faster than its own clock runs, so a week cannot go on a Monday', () => {
  const monday = { secondary: week(45, 24 * HOUR) };

  const over = overReserve(monday, now);

  assert.equal(over.label, 'week');
  assert.ok(over.allowedPercent > 44 && over.allowedPercent < 45);
  assert.ok(over.until > now && over.until < monday.secondary.resetAt, 'it clears as the week moves on');
  assert.equal(overReserve({ secondary: week(45, 26 * HOUR) }, now), null);
});

test('a window that has reset says nothing about now, and neither does an old reading with no reset time', () => {
  assert.equal(overReserve({ primary: { ...fiveHours(95), resetAt: now - 1 } }, now), null);
  assert.equal(overReserve({ at: new Date(now - 2 * HOUR).toISOString(), primary: { usedPercent: 95 } }, now), null);
  assert.ok(overReserve({ at: new Date(now - MINUTE).toISOString(), primary: { usedPercent: 95 } }, now));
});

test('a plan with no five-hour limit reports only its week', () => {
  assert.deepEqual(usageWindows({ secondary: week(18) }, now), [{ label: 'week', usedPercent: 18 }]);
});

test('Pi\'s words for a usage limit are understood, and ordinary failures are not', () => {
  const words = [
    'You have hit your ChatGPT usage limit (pro plan). Try again in ~40 min.',
    '429: Too many requests',
    'Rate limit reached for requests',
    'subscription_sharing_usage_limit_exceeded',
    'insufficient_quota',
    'Server requested 7200s retry delay (max: 60s)',
  ];
  for (const text of words) assert.ok(usageLimitIn(text, now), text);

  for (const text of ['terminated', 'Pi did not finish a response (error).', 'The clone is gone.', '', null]) {
    assert.equal(usageLimitIn(text, now), null);
  }
});

test('a usage limit that says when it lifts is believed', () => {
  assert.equal(usageLimitIn('You have hit your ChatGPT usage limit. Try again in ~40 min.', now).retryAt, now + 40 * MINUTE);
  assert.equal(usageLimitIn('Server requested 7200s retry delay (max: 60s)', now).retryAt, now + 2 * HOUR);
  assert.equal(usageLimitIn('Rate limit reached', now).retryAt, null);
});

test('a pause that names no time gets longer each time it fails, and stays within reason', () => {
  const failure = { reason: 'Rate limit reached', retryAt: null };
  const first = nextPause(null, failure, now);
  assert.equal(Date.parse(first.until), now + HOUR / 2);

  const second = nextPause(first, failure, Date.parse(first.until) + 1);
  assert.equal(second.strikes, 2);
  assert.equal(Date.parse(second.until) - Date.parse(second.at), HOUR);

  let pause = second;
  for (let index = 0; index < 10; index++) pause = nextPause(pause, failure, Date.parse(pause.until) + 1);
  assert.equal(Date.parse(pause.until) - Date.parse(pause.at), 6 * HOUR);
});

test('a second agent failing during a pause is the same pause, so Chat hears it once', () => {
  const first = nextPause(null, { reason: 'Rate limit reached', retryAt: now + HOUR }, now);

  const again = nextPause(first, { reason: 'Rate limit reached', retryAt: now + 2 * HOUR }, now + MINUTE);

  assert.equal(again.at, first.at);
  assert.equal(again.strikes, 1);
  assert.equal(Date.parse(again.until), now + 2 * HOUR);
});

const piWith = sessionFile => {
  const handlers = {};
  watchUsage({ on: (event, handler) => { handlers[event] = handler; } });
  handlers.session_start({}, { sessionManager: { getSessionFile: () => sessionFile } });
  return handlers;
};

test('the extension keeps what the provider says in its headers, for the owner to read', t => {
  const root = dataRoot(t);
  mkdirSync(join(root, 'jobs'));
  const handlers = piWith(join(root, 'jobs', 'run.jsonl'));

  handlers.after_provider_response({
    status: 200,
    headers: {
      'x-codex-primary-used-percent': '42.5',
      'x-codex-primary-window-minutes': '300',
      'x-codex-primary-reset-at': '1780320000',
      'x-codex-secondary-used-percent': '18',
      'x-codex-secondary-window-minutes': '10080',
      'x-codex-secondary-reset-at': '1780700000',
    },
  });

  const { primary, secondary } = readSubscription(root);
  assert.deepEqual(primary, { usedPercent: 42.5, windowMinutes: 300, resetAt: 1780320000000 });
  assert.deepEqual(secondary, { usedPercent: 18, windowMinutes: 10080, resetAt: 1780700000000 });
});

test('the extension also reads the stream event, the only sign on a WebSocket', t => {
  const root = dataRoot(t);
  mkdirSync(join(root, 'jobs'));
  const handlers = piWith(join(root, 'jobs', 'run.jsonl'));

  handlers.provider_stream_event({
    data: {
      type: 'codex.rate_limits',
      rate_limits: { secondary: { used_percent: 61, window_minutes: 10080, reset_at: 1780700000 } },
    },
  });
  handlers.provider_stream_event({ data: { type: 'response.created' } });

  const reading = readSubscription(root);
  assert.equal(reading.primary, undefined);
  assert.equal(reading.secondary.usedPercent, 61);
  assert.ok(Date.parse(reading.at) > 0);
});

test('other providers say nothing, so an earlier reading stands', t => {
  const root = dataRoot(t);
  mkdirSync(join(root, 'jobs'));
  writeJson(join(root, 'work', 'subscription.json'), { secondary: week(18) });
  const handlers = piWith(join(root, 'jobs', 'run.jsonl'));

  handlers.after_provider_response({ status: 200, headers: { 'content-type': 'text/event-stream' } });

  assert.equal(readSubscription(root).secondary.usedPercent, 18);
});

test('outside a job the extension writes nothing, and it never fails a run', t => {
  const root = dataRoot(t);
  mkdirSync(join(root, 'elsewhere'));
  const handlers = piWith(join(root, 'elsewhere', 'run.jsonl'));
  const event = { status: 200, headers: { 'x-codex-primary-used-percent': '10' } };

  handlers.after_provider_response(event);
  assert.equal(readSubscription(root), null);

  const noFolder = piWith('/nonexistent/jobs/run.jsonl');
  assert.doesNotThrow(() => noFolder.after_provider_response(event));
  assert.throws(() => readFileSync('/nonexistent/work/subscription.json'));
});
