import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { recordEvent } from '../src/cli/events.mjs';
import { main } from '../src/cli/main.mjs';
import { transportEvent, transportId } from '../src/cli/telemetry/events.mjs';
import { RemoteSender, runUploadCommand, sendTelemetry, uploadStatus } from '../src/cli/telemetry/sender.mjs';
import { fakePi } from './helpers/pi-session.mjs';
import { credentialValues, fakeServer, provision, reply } from './fixtures/hobkin-api/fake-server.mjs';

// A byte-for-byte copy of hobkin-api's docs/telemetry-v1.json, the server's catalog of what it takes.
// Every event this client builds is checked against it, so a changed copy fails here before the client drifts from the server.
const CATALOG = new URL('./fixtures/hobkin-api/telemetry-v1.json', import.meta.url);
const PINNED_SHA256 = '682c45d4f20c83064f6d6ace94f9d146ca2c337b11a0d0341e71da060f1c784d';
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOW = Date.parse('2026-11-03T12:00:00Z');
const SALT = 'a'.repeat(64);

const inRange = (value, [lowest, highest]) => value >= lowest && value <= highest;

/** Whether the catalog takes this value for this fact. */
function factAllowed(key, value) {
  if (key.endsWith('_id')) return UUID.test(value);
  if (catalog.boolean_fields.includes(key)) return typeof value === 'boolean';
  if (catalog.integer_ranges[key]) return Number.isInteger(value) && inRange(value, catalog.integer_ranges[key]);
  if (key === 'usd') return Number.isFinite(value) && inRange(value, catalog.usd_range);
  return catalog.enums[key]?.includes(value) ?? false;
}

/** The server's rules, read from the catalog: why an event would be refused, or null when it would be taken. */
function refusal(event, now = NOW) {
  if (JSON.stringify(Object.keys(event).toSorted()) !== '["event_id","facts","occurred_at","type"]') return 'keys';
  if (!UUID.test(event.event_id)) return 'event_id';

  const allowed = catalog.events[event.type];
  if (!allowed) return `type ${event.type}`;

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(event.occurred_at)) return 'occurred_at';
  if (!inRange(Date.parse(event.occurred_at), [now - 7 * 86400000, now + 300000])) return 'window';

  for (const [key, value] of Object.entries(event.facts)) {
    if (!allowed.includes(key)) return `fact ${key}`;
    if (!factAllowed(key, value)) return `${key}=${value}`;
  }
  return ('template_id' in event.facts) === ('template_version' in event.facts) ? null : 'template pair';
}

const at = (offset = 0) => new Date(NOW + offset).toISOString();
const PRIVATE = ['check:bank-statements:2026-11-03', 'bank-statements', 'secret-project', 'item-42', 'report:bank-statements:1', 'decision-9'];
const localEvents = [
  { at: at(), type: 'app_opened' },
  { at: at(), type: 'app_closed', ms: 5000 },
  { at: at(), type: 'turn_started', id: 'main:2026-11-03:1' },
  { at: at(), type: 'turn_finished', id: 'main:2026-11-03:1', status: 'completed', stopReason: 'toolUse', ms: 900, limited: true },
  { at: at(), type: 'run_started', id: PRIVATE[0], kind: 'background', routine: PRIVATE[1] },
  { at: at(), type: 'run_finished', id: PRIVATE[0], kind: 'background', routine: PRIVATE[1], status: 'no_change', ms: 60000, usd: 0.25, tokens: 1200, triage: 'nothing' },
  { at: at(), type: 'run_finished', id: 'work:1', kind: 'background', lane: 'do', project: PRIVATE[2], item: PRIVATE[3], status: 'completed', triage: 'critical', next: true },
  { at: at(), type: 'run_tokens', id: 'work:1', tokens: 3000, cached: 1000 },
  { at: at(), type: 'decision_filed', id: PRIVATE[5], source: 'routine' },
  { at: at(), type: 'decision_answered', id: PRIVATE[5], source: 'merge', ms: 2500 },
  { at: at(), type: 'decision_recalled', routine: PRIVATE[1] },
  { at: at(), type: 'report_read', id: PRIVATE[4], ms: 4000 },
  { at: at(), type: 'report_messaged', id: PRIVATE[4] },
  { at: at(), type: 'question_shown' },
  { at: at(), type: 'question_ended', how: 'escaped', choice: 2, ms: 800 },
  { at: at(), type: 'notice_posted', source: 'work-pause', tone: 'critical' },
  { at: at(), type: 'error_shown', from: 'Send' },
  { at: at(), type: 'work_paused', pause: 'hand' },
  { at: at(), type: 'work_resumed', pause: 'day' },
  { at: at(), type: 'launch_closed', project: PRIVATE[2], item: PRIVATE[3], outcome: 'trouble' },
  { at: at(), type: 'harness_filed', name: 'refresh', count: 3, project: PRIVATE[2], item: PRIVATE[3] },
  { at: at(), type: 'done_page', project: PRIVATE[2], item: PRIVATE[3], ms: 12000 },
  { at: at(), type: 'done_diff', project: PRIVATE[2], item: PRIVATE[3] },
  { at: at(), type: 'done_merged', project: PRIVATE[2], item: PRIVATE[3] },
  { at: at(), type: 'done_declined', project: PRIVATE[2], item: PRIVATE[3] },
  { at: at(), type: 'done_sent_back', project: PRIVATE[2], item: PRIVATE[3] },
  { at: at(), type: 'tab_opened', tab: 'schedules' },
  { at: at(), type: 'compaction_started', reason: 'threshold' },
  { at: at(), type: 'compaction_finished', reason: 'manual', status: 'completed', ms: 30000 },
  { at: at(), type: 'crash_occurred', component: 'cli', category: 'uncaught_exception', fatal: true },
];
const idFor = (namespace, value) => transportId(SALT, namespace, value);
const mapped = local => transportEvent(local, { eventId: transportId(SALT, 'event', JSON.stringify(local)), idFor });
const factsOf = local => mapped(local)?.facts;

function fixture(t, { enrolled = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-upload-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  atomicJson(join(root, 'config.json'), { ...config, main: { ...config.main, model: 'fixture/local' }, background: { ...config.background, model: 'fixture/check' } });
  if (enrolled) provision(root);
  let clock = NOW;
  return {
    root,
    now: () => clock,
    later: ms => { clock += ms; },
    record: (type, facts = {}, offset = 0) => recordEvent(root, type, facts, clock + offset),
    options: server => ({ fetch: server.fetch, now: () => clock, sleep: async () => {} }),
  };
}

// The first pass on a home only marks where upload begins, so nothing recorded before it ever goes.
const begin = h => sendTelemetry(h.root, h.options(fakeServer(call => batchReceipt(call))));
const batchReceipt = call => reply(201,{ id: '77777777-7777-4777-8777-777777777777', batch_id: call.headers['Idempotency-Key'], status: 'received', received_at: '2026-11-03T12:00:01Z' });
const unavailable = () => reply(503, { error: { code: 'unavailable', message: 'unavailable' } });
const batchOf = call => JSON.parse(call.body.toString('utf8'));
const filesUnder = folder => (existsSync(folder) ? readdirSync(folder, { recursive: true }).map(name => join(folder, name)).filter(file => statSync(file).isFile()) : []);

test('the catalog is the pinned copy of the server file', () => {
  assert.equal(createHash('sha256').update(readFileSync(CATALOG)).digest('hex'), PINNED_SHA256);
});

test('every local event the catalog names becomes an event the server takes, with nothing local in it', () => {
  const events = localEvents.map(mapped);

  assert.deepEqual(events.map(event => event?.type), localEvents.map(({ type }) => type));
  for (const event of events) assert.equal(refusal(event), null, `${event.type}: ${refusal(event)}`);
  const sent = JSON.stringify(events);
  for (const value of PRIVATE) assert.equal(sent.includes(value), false, `${value} stays here`);
  assert.deepEqual(Object.keys(catalog.events).filter(type => !localEvents.some(local => local.type === type)), ['session_started', 'session_finished']);
});

test('local values map to the fixed words, and the rest to unknown or to nothing', () => {
  assert.deepEqual(factsOf({ at: at(), type: 'run_finished', status: 'no_change', triage: 'nothing', kind: 'background', routine: 'x' }), { kind: 'routine', status: 'completed', triage: 'quiet' });
  assert.deepEqual(factsOf({ at: at(), type: 'run_started', kind: 'background', lane: 'look', project: 'p' }), { kind: 'work', lane: 'research' });
  assert.deepEqual(factsOf({ at: at(), type: 'run_started', kind: 'background', lane: 'sideways', project: 'p' }), { kind: 'work', lane: 'unknown' });
  assert.deepEqual(factsOf({ at: at(), type: 'run_finished', status: 'incomplete', triage: 'mystery' }), { triage: 'unknown' });
  assert.deepEqual(factsOf({ at: at(), type: 'turn_finished', stopReason: 'weird', ms: -5, limited: 'yes' }), { stop_reason: 'unknown' });
  assert.deepEqual(factsOf({ at: at(), type: 'question_ended', how: 'escaped', ms: 700.5 }), { how: 'dismissed' });
  assert.deepEqual(factsOf({ at: at(), type: 'notice_posted', source: 'report', tone: 'mystery' }), { source: 'unknown' });
  assert.deepEqual(factsOf({ at: at(), type: 'tab_opened', tab: 'job:check:1' }), { tab: 'unknown' });
  assert.deepEqual(factsOf({ at: at(), type: 'app_closed', ms: 700000000 }), {});
  assert.deepEqual(factsOf({ at: at(), type: 'decision_answered', source: 'outside', ms: 10 }), { source: 'unknown', ms: 10 });
  assert.equal(mapped({ at: at(), type: 'mood_shown', mood: 'happy' }), null);
  assert.equal(mapped({ at: at(), type: 'decision_read', id: 'x', ms: 3 }), null);
  assert.equal(mapped({ at: 'yesterday', type: 'app_opened' }), null);
});

test('one local id gives one transport id across events, and another home gives another', () => {
  const started = mapped({ at: at(), type: 'turn_started', id: 'main:1' });
  const finished = mapped({ at: at(), type: 'turn_finished', id: 'main:1', status: 'completed' });

  assert.equal(started.facts.run_id, finished.facts.run_id);
  assert.notEqual(transportId('b'.repeat(64), 'run', 'main:1'), started.facts.run_id);
  assert.notEqual(transportId(SALT, 'report', 'main:1'), started.facts.run_id);
  assert.match(started.facts.run_id, UUID);
});

test('a pass sends what the stream gained since upload began as one signed batch, and the receipt clears it', async t => {
  const h = fixture(t);
  h.record('app_opened', {}, -1000);
  await begin(h);
  h.record('app_opened');
  h.record('tab_opened', { tab: 'reports' });
  h.record('mood_shown', { mood: 'happy' });
  const server = fakeServer(batchReceipt);

  const result = await sendTelemetry(h.root, h.options(server));

  assert.deepEqual(result, { sent: 2 });
  assert.equal(server.calls.length, 1);
  const [call] = server.calls;
  assert.equal(call.url, 'https://api.example.test/api/v1/telemetry/batches');
  const batch = batchOf(call);
  assert.deepEqual(Object.keys(batch), ['schema_version', 'batch_id', 'app_version', 'events']);
  assert.equal(batch.schema_version, 1);
  assert.equal(call.headers['Idempotency-Key'], batch.batch_id);
  assert.match(batch.batch_id, UUID);
  assert.deepEqual(batch.events.map(({ type }) => type), ['app_opened', 'tab_opened']);
  for (const event of batch.events) assert.equal(refusal(event), null);
  assert.ok(uploadStatus(h.root).lastSentAt);
  assert.deepEqual(await sendTelemetry(h.root, h.options(server)), { sent: 0 });
  assert.equal(server.calls.length, 1);
});

test('a batch holds at most 100 events, and the rest go in the next one', async t => {
  const h = fixture(t);
  await begin(h);
  for (let index = 0; index < 150; index++) h.record('question_shown');
  const server = fakeServer(batchReceipt);

  assert.deepEqual(await sendTelemetry(h.root, h.options(server)), { sent: 100 });
  assert.deepEqual(await sendTelemetry(h.root, h.options(server)), { sent: 50 });
  assert.equal(new Set(server.calls.flatMap(call => batchOf(call).events.map(({ event_id }) => event_id))).size, 150);
});

test('a batch the server could not take goes again later with the same bytes and batch id', async t => {
  const h = fixture(t);
  await begin(h);
  h.record('app_opened');
  const server = fakeServer(unavailable(), unavailable(), unavailable(), batchReceipt);

  assert.equal((await sendTelemetry(h.root, h.options(server))).sent, 0);
  assert.equal(uploadStatus(h.root).waiting.events, 1);
  await sendTelemetry(h.root, h.options(server));
  assert.equal(server.calls.length, 3, 'nothing goes before the batch is due again');

  h.later(2 * 3600000);
  h.record('tab_opened', { tab: 'work' });
  assert.deepEqual(await sendTelemetry(h.root, h.options(server)), { sent: 1 });
  assert.equal(server.calls.length, 4);
  for (const call of server.calls) assert.deepEqual(call.body, server.calls[0].body);
  assert.equal(new Set(server.calls.map(call => call.headers['Idempotency-Key'])).size, 1);
  assert.deepEqual(await sendTelemetry(h.root, h.options(fakeServer(batchReceipt))), { sent: 1 }, 'what came in meanwhile goes next');
});

test('a refused batch is dropped for good, and status says why', async t => {
  const h = fixture(t);
  await begin(h);
  h.record('app_opened');
  const server = fakeServer(reply(422, { error: { code: 'invalid_payload', message: 'invalid payload' } }));

  assert.deepEqual(await sendTelemetry(h.root, h.options(server)), { sent: 0 });
  assert.deepEqual(await sendTelemetry(h.root, h.options(server)), { sent: 0 });

  assert.equal(server.calls.length, 1);
  assert.deepEqual(uploadStatus(h.root).lastError, { status: 422, code: 'invalid_payload', at: at() });
  assert.equal(uploadStatus(h.root).waiting, null);
});

test('events outside the seven days the server takes are left out', async t => {
  const h = fixture(t);
  await begin(h);
  h.record('app_opened', {}, -8 * 86400000);
  h.record('app_opened', {}, 10 * 60000);
  h.record('tab_opened', { tab: 'decisions' });
  const server = fakeServer(batchReceipt);

  await sendTelemetry(h.root, h.options(server));

  assert.deepEqual(batchOf(server.calls[0]).events.map(({ type }) => type), ['tab_opened']);
});

test('off drops what waits and sends nothing, and on starts again from that moment', async t => {
  const h = fixture(t);
  await begin(h);
  h.record('app_opened');
  await sendTelemetry(h.root, h.options(fakeServer(unavailable())));
  assert.equal(uploadStatus(h.root).waiting.events, 1);

  assert.deepEqual(runUploadCommand(h.root, ['off']), {
    upload: 'off',
    message: 'Upload is off. No usage events leave this machine, and what was waiting was dropped. hobkin telemetry upload on turns it back on.',
  });
  h.record('tab_opened', { tab: 'work' });
  const server = fakeServer(batchReceipt);
  assert.deepEqual(await sendTelemetry(h.root, h.options(server)), { sent: 0 });
  assert.equal(server.calls.length, 0);
  assert.equal(uploadStatus(h.root).waiting, null);

  assert.equal(runUploadCommand(h.root, ['on']).upload, 'on');
  assert.deepEqual(await sendTelemetry(h.root, h.options(server)), { sent: 0 }, 'nothing from before goes');
  h.record('tab_opened', { tab: 'reports' });
  assert.deepEqual(await sendTelemetry(h.root, h.options(server)), { sent: 1 });
  assert.deepEqual(batchOf(server.calls[0]).events.map(({ facts }) => facts), [{ tab: 'reports' }]);
});

test('a machine whose enrollment fails sends no usage events and writes nothing', async t => {
  const h = fixture(t, { enrolled: false });
  new RemoteSender({ root: h.root, ...h.options(fakeServer(reply(503, { error: {} }))) });
  h.record('app_opened');
  const server = fakeServer(reply(503, { error: {} }));

  assert.deepEqual(await sendTelemetry(h.root, h.options(server)), { sent: 0 });

  assert.deepEqual(server.calls.map(call => call.url), ['https://api.hobkin.dev/api/v1/enrollments']);
  assert.equal(existsSync(join(h.root, 'telemetry')), false);
  assert.equal(uploadStatus(h.root).enrolled, false);
});

test('status says what goes, to where and how to stop it, and holds no credential', async t => {
  const h = fixture(t);
  await begin(h);
  h.record('app_opened');
  await sendTelemetry(h.root, h.options(fakeServer(batchReceipt)));

  const status = uploadStatus(h.root);

  assert.deepEqual([status.upload, status.enrolled, status.sendsTo], ['on', true, 'https://api.example.test']);
  assert.match(status.message, /https:\/\/api\.example\.test/);
  assert.match(status.message, /hobkin telemetry upload off/);
  assert.match(status.message, /never what you type/);
  assert.deepEqual(status.events, Object.keys(catalog.events).filter(type => !['session_started', 'session_finished'].includes(type)));
  const written = [JSON.stringify(status), ...filesUnder(join(h.root, 'telemetry')).map(file => readFileSync(file, 'utf8'))].join('\n');
  for (const value of credentialValues()) assert.equal(written.includes(value), false);
  for (const file of filesUnder(join(h.root, 'telemetry'))) assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('a tick never waits on the server, and a second tick waits for the first pass', async t => {
  const h = fixture(t);
  const gate = Promise.withResolvers();
  const server = fakeServer(async call => { await gate.promise; return batchReceipt(call); });
  const sender = new RemoteSender({ root: h.root, ...h.options(server) });
  h.record('app_opened');

  assert.equal(sender.tick(), undefined);
  await new Promise(resolve => setImmediate(resolve));
  sender.tick();
  h.later(120000);
  sender.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(server.calls.length, 1);

  gate.resolve();
  await sender.busy;
  assert.equal(uploadStatus(h.root).waiting, null);
});

test('hobkin telemetry upload says where it stands and sets it, and plain hobkin telemetry is still the local rollup', async t => {
  const h = fixture(t);
  const run = async (...args) => {
    let text = '';
    const code = await main([...args, '--home', h.root], { write: chunk => { text += chunk; } });
    return { code, json: JSON.parse(text) };
  };

  assert.equal((await run('telemetry', 'upload', 'status')).json.upload, 'on');
  assert.deepEqual((await run('telemetry', 'upload')).json, (await run('telemetry', 'upload', 'status')).json);
  assert.equal((await run('telemetry', 'upload', 'off')).json.upload, 'off');
  assert.equal(JSON.parse(readFileSync(join(h.root, 'config.json'), 'utf8')).telemetryUpload.enabled, false);
  assert.equal((await run('telemetry', 'upload', 'on')).json.upload, 'on');
  assert.equal(typeof (await run('telemetry')).json.events, 'number');
  assert.equal(typeof (await run('telemetry', '--days', '7')).json.events, 'number');
  for (const args of [['upload', 'maybe'], ['upload', 'on', 'now'], ['download']]) {
    await assert.rejects(run('telemetry', ...args), /^Error: Usage: hobkin telemetry/);
  }
});

test('the app sends its own opening, and the first start that uploads says so once in Chat', async t => {
  const h = fixture(t);
  const server = fakeServer(batchReceipt);
  const open = () => HobkinApplication.open(h.root, { createMain: fakePi(h.root).createMain, fetch: server.fetch, intervalMs: 3600000 });

  const app = await open();
  await app.remote.busy;
  await app.remote.pass();
  const told = app.snapshot.messages.filter(message => /usage events/.test(message.content));
  await app.close();

  assert.equal(told.length, 1);
  assert.match(told[0].content, /hobkin telemetry upload off/);
  assert.ok(server.calls.some(call => batchOf(call).events.some(({ type }) => type === 'app_opened')));
  const again = await open();
  const toldAgain = again.snapshot.messages.filter(message => /usage events/.test(message.content) && message.id !== told[0].id);
  await again.close();
  assert.deepEqual(toldAgain, []);
});
