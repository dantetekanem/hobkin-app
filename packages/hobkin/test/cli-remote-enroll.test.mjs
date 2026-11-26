import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initialize, setTelemetryUpload } from '../src/cli/config.mjs';
import { credentialsFile, enrollment } from '../src/cli/remote/credentials.mjs';
import { sendTelemetry } from '../src/cli/telemetry/sender.mjs';
import { fakeServer, provision, reply } from './fixtures/hobkin-api/fake-server.mjs';

// What the server issues to a new installation. None of it is a live credential.
const ISSUED = Object.freeze({
  installation_id: '33333333-3333-4333-8333-333333333333',
  key_id: '44444444-4444-4444-8444-444444444444',
  secret: 'ab'.repeat(32),
});

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-enroll-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  return root;
}

const options = server => ({ fetch: server.fetch, now: () => Date.parse('2026-11-05T12:00:00Z'), sleep: async () => {} });

test('a machine without a key enrolls with the live server on its first pass and keeps the key private', async t => {
  const root = home(t);
  const server = fakeServer(reply(201, ISSUED));

  await sendTelemetry(root, options(server));

  assert.equal(server.calls.length, 1);
  const [call] = server.calls;
  assert.equal(call.method, 'POST');
  assert.equal(call.url, 'https://api.hobkin.dev/api/v1/enrollments');
  assert.equal(call.redirect, 'error');
  assert.equal(call.body, null);
  assert.equal(Object.keys(call.headers).some(name => /^x-hobkin-/i.test(name)), false);
  assert.equal(statSync(credentialsFile(root)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(credentialsFile(root), 'utf8')), { ...ISSUED, base_url: 'https://api.hobkin.dev' });
  assert.deepEqual(enrollment(root), { enrolled: true, sendsTo: 'https://api.hobkin.dev' });
});

test('a key already in place is never replaced, even one that cannot be used', async t => {
  const root = home(t);
  const file = provision(root, { ...ISSUED, base_url: 'https://api.example.test' }, 0o644);
  const before = readFileSync(file);
  const server = fakeServer(reply(201, ISSUED));

  await sendTelemetry(root, options(server));

  assert.equal(server.calls.length, 0);
  assert.deepEqual(readFileSync(file), before);
});

test('a failed or malformed enrollment leaves no key behind, and a later pass tries again', async t => {
  const root = home(t);
  const server = fakeServer(new Error('offline'), reply(503, { error: {} }), reply(201, { ...ISSUED, secret: 'short' }), reply(201, ISSUED));

  for (let pass = 0; pass < 3; pass += 1) {
    assert.deepEqual(await sendTelemetry(root, options(server)), { sent: 0 });
    assert.equal(existsSync(credentialsFile(root)), false);
  }
  await sendTelemetry(root, options(server));

  assert.equal(server.calls.length, 4);
  assert.equal(enrollment(root).enrolled, true);
});

test('with upload off, nothing leaves this machine, not even an enrollment', async t => {
  const root = home(t);
  setTelemetryUpload(root, false);
  const server = fakeServer(reply(201, ISSUED));

  await sendTelemetry(root, options(server));

  assert.equal(server.calls.length, 0);
  assert.equal(existsSync(credentialsFile(root)), false);
});
