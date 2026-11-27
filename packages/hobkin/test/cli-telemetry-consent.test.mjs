import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initialize, setTelemetryUpload, telemetryUploadEnabled } from '../src/cli/config.mjs';
import { recordEvent } from '../src/cli/events.mjs';
import { credentialsFile } from '../src/cli/remote/credentials.mjs';
import { sendTelemetry, uploadNotice, uploadStatus } from '../src/cli/telemetry/sender.mjs';
import { fakeServer, provision, reply, TEST_CREDENTIALS } from './fixtures/hobkin-api/fake-server.mjs';

const NOW = Date.parse('2026-11-03T12:00:00Z');

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-consent-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  return root;
}

const enrolled = reply(201, {
  installation_id: TEST_CREDENTIALS.installation_id,
  key_id: TEST_CREDENTIALS.key_id,
  secret: TEST_CREDENTIALS.secret,
});
const received = call => reply(201, { id: '77777777-7777-4777-8777-777777777777', batch_id: call.headers['Idempotency-Key'], status: 'received', received_at: '2026-11-03T12:00:01Z' });
const options = server => ({ fetch: server.fetch, now: () => NOW, sleep: async () => {} });

test('a new home sends nothing and enrolls nothing until the user says yes', async t => {
  const root = home(t);
  const server = fakeServer(enrolled);

  assert.equal(telemetryUploadEnabled(root), false);
  recordEvent(root, 'app_opened', {}, NOW);
  assert.deepEqual(await sendTelemetry(root, options(server)), { sent: 0 });
  assert.deepEqual(server.calls, [], 'not even an enrollment');
  assert.equal(existsSync(credentialsFile(root)), false);
  assert.equal(uploadStatus(root).upload, 'off');
  assert.equal(uploadNotice(root, NOW), null, 'Chat is told nothing');

  // The yes: the next pass enrolls, and upload begins from then.
  setTelemetryUpload(root, true);
  assert.equal(telemetryUploadEnabled(root), true);
  await sendTelemetry(root, options(server));
  assert.deepEqual(server.calls.map(call => call.url), ['https://api.hobkin.dev/api/v1/enrollments']);
  assert.equal(existsSync(credentialsFile(root)), true);
});

test('a home enrolled before hobkin asked keeps sending as it did, until the user says no', async t => {
  const root = home(t);
  provision(root);
  const server = fakeServer(received);

  assert.equal(telemetryUploadEnabled(root), true, 'never asked, and enrolled already');
  await sendTelemetry(root, options(server));
  recordEvent(root, 'app_opened', {}, NOW);
  assert.deepEqual(await sendTelemetry(root, options(server)), { sent: 1 });

  setTelemetryUpload(root, false);
  assert.equal(telemetryUploadEnabled(root), false);
  recordEvent(root, 'tab_opened', { tab: 'reports' }, NOW);
  assert.deepEqual(await sendTelemetry(root, options(server)), { sent: 0 });
  assert.equal(server.calls.length, 1);
});

test('a configuration hobkin cannot read sends nothing, enrolled or not', async t => {
  const root = home(t);
  provision(root);
  writeFileSync(join(root, 'config.json'), '{ not json');

  assert.equal(telemetryUploadEnabled(root), false);
});
