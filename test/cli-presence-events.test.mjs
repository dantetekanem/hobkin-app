import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { readEvents, recordEvent, recordPresence } from '../src/cli/events.mjs';
import { transportEvent, transportId } from '../src/cli/telemetry/events.mjs';
import { sendTelemetry } from '../src/cli/telemetry/sender.mjs';
import { fakeServer, provision, reply } from './fixtures/hobkin-api/fake-server.mjs';

const MINUTE_MS = 60000;

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-presence-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// Local times, because a day is the user's day.
const local = (day, hour, minute = 0, second = 0) => new Date(2026, 10, day, hour, minute, second).getTime();
const iso = ms => new Date(ms).toISOString();
const presenceEvents = root => readEvents(root).filter(({ type }) => type === 'presence');

test('the first sighting on a local day is first, kept at the moment the user was seen, with how long they were away', t => {
  const root = dataRoot(t);
  const seenAt = local(25, 8, 12);

  const recorded = recordPresence(root, { lastSeenAt: iso(local(24, 22)), seenAt });

  assert.deepEqual(recorded, { kind: 'first', awayMs: seenAt - local(24, 22) });
  assert.deepEqual(presenceEvents(root), [{ at: iso(seenAt), type: 'presence', kind: 'first', awayMs: seenAt - local(24, 22) }]);
});

test('a first sighting with nothing before it says when, and not how long', t => {
  const root = dataRoot(t);

  assert.deepEqual(recordPresence(root, { lastSeenAt: null, seenAt: local(25, 9) }), { kind: 'first' });
  assert.deepEqual(presenceEvents(root), [{ at: iso(local(25, 9)), type: 'presence', kind: 'first' }]);
});

test('a return after 15 minutes or more away is returned, and a smaller gap records nothing', t => {
  const root = dataRoot(t);
  const left = local(25, 10);

  assert.equal(recordPresence(root, { lastSeenAt: iso(left), seenAt: left + 15 * MINUTE_MS - 1000 }), null);
  assert.equal(recordPresence(root, { lastSeenAt: iso(left), seenAt: left }), null);
  assert.deepEqual(recordPresence(root, { lastSeenAt: iso(left), seenAt: left + 15 * MINUTE_MS }), { kind: 'returned', awayMs: 15 * MINUTE_MS });

  assert.deepEqual(presenceEvents(root).map(({ at, kind, awayMs }) => [at, kind, awayMs]), [[iso(left + 15 * MINUTE_MS), 'returned', 15 * MINUTE_MS]]);
});

test('a clock that moved back records nothing on the same day, and a time that cannot be read is no sighting before', t => {
  const root = dataRoot(t);

  assert.equal(recordPresence(root, { lastSeenAt: iso(local(25, 11)), seenAt: local(25, 10) }), null);
  assert.deepEqual(recordPresence(root, { lastSeenAt: 'not a time', seenAt: local(25, 10) }), { kind: 'first' });
});

test('presence stays on this machine: the upload catalog has no such event, so a pass sends only what it names', async t => {
  const root = dataRoot(t);
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  atomicJson(join(root, 'config.json'), { ...config, main: { ...config.main, model: 'fixture/local' }, background: { ...config.background, model: 'fixture/check' } });
  provision(root);
  const now = local(25, 12);
  const receipt = call => reply(201, { id: '77777777-7777-4777-8777-777777777777', batch_id: call.headers['Idempotency-Key'], status: 'received', received_at: iso(now) });
  const options = server => ({ fetch: server.fetch, now: () => now, sleep: async () => {} });
  await sendTelemetry(root, options(fakeServer(receipt)));

  recordPresence(root, { lastSeenAt: iso(now - 3 * 60 * MINUTE_MS), seenAt: now - 1000 });
  recordEvent(root, 'app_opened', {}, now);
  const server = fakeServer(receipt);

  assert.deepEqual(await sendTelemetry(root, options(server)), { sent: 1 });
  assert.deepEqual(JSON.parse(server.calls[0].body.toString('utf8')).events.map(({ type }) => type), ['app_opened']);
  assert.equal(server.calls[0].body.toString('utf8').includes('presence'), false);
  const idFor = (namespace, value) => transportId('a'.repeat(64), namespace, value);
  assert.equal(transportEvent({ at: iso(now), type: 'presence', kind: 'returned', awayMs: 1000 }, { eventId: idFor('event', 'x'), idFor }), null);
});
