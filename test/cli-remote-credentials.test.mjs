import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspect } from 'node:util';
import { checkBaseUrl, credentialsFile, DEFAULT_BASE_URL, enrollment, readCredentials } from '../src/cli/remote/credentials.mjs';
import { provision, TEST_CREDENTIALS } from './fixtures/hobkin-api/fake-server.mjs';

function dataRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-remote-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const secretsIn = text => [TEST_CREDENTIALS.secret, TEST_CREDENTIALS.installation_id, TEST_CREDENTIALS.key_id].filter(value => text.includes(value));

test('a machine with no remote.json is not enrolled, and looking creates nothing', t => {
  const root = dataRoot(t);

  assert.equal(readCredentials(root), null);
  assert.deepEqual(enrollment(root), { enrolled: false });
  assert.equal(existsSync(join(root, 'runtime')), false);
});

test('provisioned credentials read back, and none of them shows in JSON or inspection', t => {
  const root = dataRoot(t);
  provision(root);

  const credentials = readCredentials(root);

  assert.equal(credentials.installationId, TEST_CREDENTIALS.installation_id);
  assert.equal(credentials.keyId, TEST_CREDENTIALS.key_id);
  assert.equal(credentials.secret, TEST_CREDENTIALS.secret);
  assert.equal(credentials.baseUrl, 'https://api.example.test');
  assert.deepEqual(secretsIn(JSON.stringify(credentials)), []);
  assert.deepEqual(secretsIn(inspect(credentials, { showHidden: true, depth: 5 })), []);
  assert.deepEqual(enrollment(root), { enrolled: true, sendsTo: 'https://api.example.test' });
});

test('without a base_url the server is the local default', t => {
  const root = dataRoot(t);
  const { base_url, ...withoutBase } = TEST_CREDENTIALS;
  provision(root, withoutBase);

  assert.equal(DEFAULT_BASE_URL, 'http://127.0.0.1:3100');
  assert.equal(readCredentials(root).baseUrl, DEFAULT_BASE_URL);
});

test('a remote.json others can read is refused, and so is one that is not a plain file', t => {
  const root = dataRoot(t);
  const file = provision(root);
  chmodSync(file, 0o644);

  assert.throws(() => readCredentials(root), /0600/);
  assert.equal(enrollment(root).enrolled, false);
  assert.match(enrollment(root).problem, /0600/);

  rmSync(file);
  const elsewhere = join(root, 'elsewhere.json');
  writeFileSync(elsewhere, JSON.stringify(TEST_CREDENTIALS), { mode: 0o600 });
  symlinkSync(elsewhere, file);
  assert.throws(() => readCredentials(root), /regular file/);
});

test('malformed credentials are refused, and no error repeats what the file holds', t => {
  const root = dataRoot(t);
  const broken = [
    `{"secret":"${TEST_CREDENTIALS.secret}", oops`,
    { ...TEST_CREDENTIALS, installation_id: 'AAAAAAAA-1111-4111-8111-111111111111' },
    { ...TEST_CREDENTIALS, key_id: 'not-a-uuid' },
    { ...TEST_CREDENTIALS, secret: TEST_CREDENTIALS.secret.slice(2) },
    { ...TEST_CREDENTIALS, secret: TEST_CREDENTIALS.secret.toUpperCase() },
    { ...TEST_CREDENTIALS, extra: true },
    { installation_id: TEST_CREDENTIALS.installation_id, key_id: TEST_CREDENTIALS.key_id },
    [],
  ];
  for (const value of broken) {
    provision(root, value);
    assert.throws(() => readCredentials(root), error => /remote\.json/.test(error.message) && !secretsIn(error.message).length
      && !error.message.includes(TEST_CREDENTIALS.secret.slice(2)) && !error.message.includes('not-a-uuid'));
  }
});

test('HTTPS is required, except plain HTTP on this machine', () => {
  for (const [given, origin] of [
    ['https://api.example.test', 'https://api.example.test'],
    ['https://api.example.test/', 'https://api.example.test'],
    ['https://api.example.test:8443', 'https://api.example.test:8443'],
    ['http://127.0.0.1:3100', 'http://127.0.0.1:3100'],
    ['http://127.8.9.10:3100/', 'http://127.8.9.10:3100'],
    ['http://localhost:3100', 'http://localhost:3100'],
    ['http://[::1]:3100', 'http://[::1]:3100'],
  ]) assert.equal(checkBaseUrl(given), origin);

  for (const refused of [
    'http://api.example.test',
    'http://192.168.1.20:3100',
    'http://127.0.0.1.example.test',
    'https://user:pass@api.example.test',
    'https://api.example.test/hobkin',
    'https://api.example.test/?key=1',
    'https://api.example.test/#x',
    'ftp://api.example.test',
    'not a url',
    42,
  ]) assert.throws(() => checkBaseUrl(refused), /base_url/);
});

test('an insecure base_url keeps the machine unenrolled', t => {
  const root = dataRoot(t);
  provision(root, { ...TEST_CREDENTIALS, base_url: 'http://api.example.test' });

  assert.throws(() => readCredentials(root), /HTTPS/);
  assert.equal(enrollment(root).enrolled, false);
  assert.equal(credentialsFile(root), join(root, 'runtime', 'remote.json'));
});
