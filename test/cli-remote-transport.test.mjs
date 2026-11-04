import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signRequest } from '../src/cli/remote/sign.mjs';
import { createTransport, FEEDBACK_PATH } from '../src/cli/remote/transport.mjs';
import { fakeServer, reply, TEST_CREDENTIALS } from './fixtures/hobkin-api/fake-server.mjs';

const credentials = {
  installationId: TEST_CREDENTIALS.installation_id,
  keyId: TEST_CREDENTIALS.key_id,
  secret: TEST_CREDENTIALS.secret,
  baseUrl: TEST_CREDENTIALS.base_url,
};
const NOW = Date.parse('2026-11-03T12:00:00Z');
const ID = '33333333-3333-4333-8333-333333333333';
const BODY = Buffer.from('{\n  "schema_version": 1,\n  "message": "Olá 👋"\n}', 'utf8');
const receipt = { id: '55555555-5555-4555-8555-555555555555', client_report_id: ID, status: 'received', received_at: '2026-11-03T12:00:01Z', expires_at: null };

function transport(server, options = {}) {
  const waits = [];
  const sent = createTransport({
    credentials,
    fetch: server.fetch,
    now: () => NOW,
    sleep: async ms => { waits.push(ms); },
    random: () => 1,
    ...options,
  });
  return { send: sent.request, waits };
}

const signatureMatches = (call, target) => call.headers['X-Hobkin-Signature'] === signRequest({
  secret: TEST_CREDENTIALS.secret,
  installationId: call.headers['X-Hobkin-Installation-Id'],
  keyId: call.headers['X-Hobkin-Key-Id'],
  method: call.method,
  target,
  timestamp: call.headers['X-Hobkin-Timestamp'],
  nonce: call.headers['X-Hobkin-Nonce'],
  idempotencyKey: call.headers['Idempotency-Key'] ?? '',
  body: call.body ?? Buffer.alloc(0),
});

test('a create goes signed, as JSON, with its exact bytes and its idempotency key, and no redirect is followed', async () => {
  const server = fakeServer(reply(201, receipt));
  const { send } = transport(server);

  const result = await send({ method: 'post', path: FEEDBACK_PATH, body: BODY, idempotencyKey: ID });

  assert.deepEqual(result, { ok: true, status: 201, json: receipt });
  const [call] = server.calls;
  assert.equal(call.url, 'https://api.example.test/api/v1/feedback');
  assert.equal(call.method, 'POST');
  assert.equal(call.redirect, 'manual');
  assert.deepEqual(call.body, BODY);
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.equal(call.headers['Idempotency-Key'], ID);
  assert.equal(call.headers['X-Hobkin-Timestamp'], String(NOW / 1000));
  assert.match(call.headers['X-Hobkin-Nonce'], /^[0-9a-f]{32}$/);
  assert.ok(signatureMatches(call, '/api/v1/feedback'));
});

test('every retry resends the same bytes and key with a fresh nonce, timestamp and signature', async () => {
  let clock = NOW;
  const server = fakeServer(reply(503, { error: { code: 'unavailable', message: 'unavailable' } }), new TypeError('fetch failed'), reply(201, receipt));
  const { send, waits } = transport(server, { now: () => { clock += 1000; return clock; } });

  const result = await send({ method: 'POST', path: FEEDBACK_PATH, body: BODY, idempotencyKey: ID });

  assert.equal(result.ok, true);
  assert.equal(server.calls.length, 3);
  assert.equal(waits.length, 2);
  for (const call of server.calls) {
    assert.deepEqual(call.body, BODY);
    assert.equal(call.headers['Idempotency-Key'], ID);
    assert.ok(signatureMatches(call, '/api/v1/feedback'));
  }
  assert.equal(new Set(server.calls.map(call => call.headers['X-Hobkin-Nonce'])).size, 3);
  assert.equal(new Set(server.calls.map(call => call.headers['X-Hobkin-Timestamp'])).size, 3);
});

test('Retry-After sets the wait, and a wait too long for now goes back to the caller', async () => {
  const throttled = seconds => reply(429, { error: { code: 'rate_limited', message: 'rate limited' } }, { 'retry-after': String(seconds) });
  const soon = fakeServer(throttled(2), reply(200, receipt));
  const short = transport(soon);
  assert.deepEqual(await short.send({ method: 'POST', path: FEEDBACK_PATH, body: BODY, idempotencyKey: ID }), { ok: true, status: 200, json: receipt });
  assert.deepEqual(short.waits, [2000]);

  const later = fakeServer(throttled(60));
  const long = transport(later);
  const result = await long.send({ method: 'POST', path: FEEDBACK_PATH, body: BODY, idempotencyKey: ID });
  assert.deepEqual(result, { ok: false, status: 429, code: 'rate_limited', message: 'rate limited', retryable: true, retryAfterMs: 60000 });
  assert.equal(later.calls.length, 1);
  assert.deepEqual(long.waits, []);
});

test('validation, authentication and other refusals are never retried', async () => {
  for (const [status, code] of [[400, 'invalid_json'], [401, 'invalid_authentication'], [403, 'forbidden'], [404, 'not_found'], [409, 'idempotency_conflict'], [413, 'payload_too_large'], [415, 'json_required'], [422, 'unsafe_content']]) {
    const server = fakeServer(reply(status, { error: { code, message: code.replaceAll('_', ' ') } }));
    const result = await transport(server).send({ method: 'POST', path: FEEDBACK_PATH, body: BODY, idempotencyKey: ID });

    assert.deepEqual(result, { ok: false, status, code, message: code.replaceAll('_', ' '), retryable: false });
    assert.equal(server.calls.length, 1, `HTTP ${status} is not retried`);
  }
});

test('retries stop after a bounded number of attempts, with bounded waits', async () => {
  const server = fakeServer(reply(502, { error: { code: 'bad_gateway', message: 'bad gateway' } }));
  const { send, waits } = transport(server, { attempts: 3, maxWaitMs: 4000 });

  const result = await send({ method: 'POST', path: FEEDBACK_PATH, body: BODY, idempotencyKey: ID });

  assert.equal(server.calls.length, 3);
  assert.deepEqual(result, { ok: false, status: 502, code: 'bad_gateway', message: 'bad gateway', retryable: true });
  assert.ok(waits.every(ms => ms > 0 && ms <= 4000));
});

test('a network failure that never clears is a retryable result, not a throw', async () => {
  const server = fakeServer(new TypeError('fetch failed'));
  const result = await transport(server, { attempts: 2 }).send({ method: 'POST', path: FEEDBACK_PATH, body: BODY, idempotencyKey: ID });

  assert.deepEqual(result, { ok: false, status: 0, code: 'network', message: 'The server could not be reached.', retryable: true });
  assert.equal(server.calls.length, 2);
});

test('a redirect is refused rather than followed with the credentials', async () => {
  const server = fakeServer(new Response(null, { status: 307, headers: { location: 'https://elsewhere.example.test/' } }));

  const result = await transport(server).send({ method: 'POST', path: FEEDBACK_PATH, body: BODY, idempotencyKey: ID });

  assert.deepEqual(result, { ok: false, status: 307, code: 'redirect', message: 'The server answered with a redirect, which hobkin does not follow.', retryable: false });
  assert.equal(server.calls.length, 1);
});

test('a bodyless delete signs empty bytes and sends no content type or idempotency key', async () => {
  const server = fakeServer(new Response(null, { status: 204 }));
  const path = `${FEEDBACK_PATH}/${receipt.id}`;

  const result = await transport(server).send({ method: 'DELETE', path });

  assert.deepEqual(result, { ok: true, status: 204, json: null });
  const [call] = server.calls;
  assert.equal(call.body, null);
  assert.equal('Content-Type' in call.headers, false);
  assert.equal('Idempotency-Key' in call.headers, false);
  assert.ok(signatureMatches(call, path));
});

test('an error without the error shape still gives a plain result', async () => {
  const server = fakeServer(new Response('<html>Bad gateway</html>', { status: 500 }));

  const result = await transport(server, { attempts: 1 }).send({ method: 'POST', path: FEEDBACK_PATH, body: BODY, idempotencyKey: ID });

  assert.deepEqual(result, { ok: false, status: 500, code: 'http_500', message: 'HTTP 500', retryable: true });
});
