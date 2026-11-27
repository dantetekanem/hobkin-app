import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { canonicalInput, freshNonce, signedHeaders, signRequest } from '../src/cli/remote/sign.mjs';

// A byte-for-byte copy of hobkin-api's docs/signature-v1.json, the server's own known-answer vector.
// Node generated it and the server's Ruby tests check it, so a changed copy fails here before it can drift from the server.
const FIXTURE = new URL('./fixtures/hobkin-api/signature-v1.json', import.meta.url);
const PINNED_SHA256 = '8c8e54c981e7496abc1634a2f04376bf54656922cf5e6166dbd01251799553f7';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const fixtureBytes = () => readFileSync(FIXTURE);
const vector = () => JSON.parse(fixtureBytes());
const requestOf = fixture => ({
  secret: fixture.secret,
  installationId: fixture.installation_id,
  keyId: fixture.key_id,
  method: fixture.method,
  target: fixture.target,
  timestamp: fixture.timestamp,
  nonce: fixture.nonce,
  idempotencyKey: fixture.idempotency_key,
  body: Buffer.from(fixture.body, 'utf8'),
});

test('the vector is the pinned copy of the server fixture', () => {
  assert.equal(createHash('sha256').update(fixtureBytes()).digest('hex'), PINNED_SHA256);
});

test('signing the vector gives its signature exactly', () => {
  assert.equal(signRequest(requestOf(vector())), vector().signature);
});

test('the canonical input is nine lines in order, with no newline after the last', () => {
  const fixture = vector();
  const lines = canonicalInput(requestOf(fixture)).split('\n');

  assert.deepEqual(lines, [
    'hobkin-v1',
    fixture.installation_id,
    fixture.key_id,
    'POST',
    '/api/v1/feedback',
    '1793750000',
    '00000000000000000000000000000001',
    fixture.idempotency_key,
    createHash('sha256').update(fixture.body).digest('hex'),
  ]);
});

test('a bodyless request hashes empty bytes and leaves the idempotency line empty', () => {
  const { body, idempotencyKey, ...rest } = requestOf(vector());
  const input = canonicalInput({ ...rest, method: 'delete', target: '/api/v1/feedback/44444444-4444-4444-8444-444444444444' });

  assert.ok(input.endsWith(`\n\n${EMPTY_SHA256}`));
  assert.equal(input.split('\n')[3], 'DELETE');
});

test('the query string is signed as given, with nothing decoded or sorted', () => {
  const request = { ...requestOf(vector()), target: '/api/v1/templates?b=2&a=%2F' };

  assert.equal(canonicalInput(request).split('\n')[4], '/api/v1/templates?b=2&a=%2F');
  assert.notEqual(signRequest(request), signRequest({ ...request, target: '/api/v1/templates?a=%2F&b=2' }));
});

test('the secret is the bytes its hex names, and anything but 64 lowercase hex characters is refused without being echoed', () => {
  const request = requestOf(vector());
  const hexAsText = createHmac('sha256', request.secret).update(canonicalInput(request)).digest('hex');

  assert.notEqual(signRequest(request), hexAsText);
  for (const secret of [request.secret.toUpperCase(), 'not hex', request.secret.slice(2), `${request.secret}00`]) {
    assert.throws(() => signRequest({ ...request, secret }), error => /secret/i.test(error.message) && !error.message.includes(secret));
  }
});

test('the headers carry the vector values and its signature, and a bodyless request has no idempotency key', () => {
  const fixture = vector();

  assert.deepEqual(signedHeaders(requestOf(fixture)), {
    'X-Hobkin-Installation-Id': fixture.installation_id,
    'X-Hobkin-Key-Id': fixture.key_id,
    'X-Hobkin-Timestamp': '1793750000',
    'X-Hobkin-Nonce': '00000000000000000000000000000001',
    'Idempotency-Key': fixture.idempotency_key,
    'X-Hobkin-Signature': fixture.signature,
  });
  assert.equal('Idempotency-Key' in signedHeaders({ ...requestOf(fixture), idempotencyKey: '', body: undefined, method: 'DELETE' }), false);
});

test('every nonce is 16 fresh random bytes as 32 lowercase hex characters', () => {
  const nonces = new Set(Array.from({ length: 50 }, () => freshNonce()));

  assert.equal(nonces.size, 50);
  for (const nonce of nonces) assert.match(nonce, /^[0-9a-f]{32}$/);
});
