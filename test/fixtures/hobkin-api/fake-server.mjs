import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The public signature vector's values. None of them is a live credential. */
export const TEST_CREDENTIALS = Object.freeze({
  installation_id: '11111111-1111-4111-8111-111111111111',
  key_id: '22222222-2222-4222-8222-222222222222',
  secret: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  base_url: 'https://api.example.test',
});

export const credentialValues = () => [TEST_CREDENTIALS.secret, TEST_CREDENTIALS.installation_id, TEST_CREDENTIALS.key_id];

/** What provisioning would leave in a test home: runtime/remote.json, private to the user. */
export function provision(root, value = TEST_CREDENTIALS, mode = 0o600) {
  mkdirSync(join(root, 'runtime'), { recursive: true, mode: 0o700 });
  const file = join(root, 'runtime', 'remote.json');
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value), { mode });
  chmodSync(file, mode);
  return file;
}

export const reply = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});

/** A stand-in for the server: each call takes the next answer, and every request is kept with its exact bytes. */
export function fakeServer(...answers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method,
      headers: { ...init.headers },
      body: init.body ? Buffer.from(init.body) : null,
      redirect: init.redirect,
    };
    calls.push(call);

    // The last answer repeats, so a server that stays down needs one.
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(call) : answer.clone();
  };
  return { fetch, calls };
}

export const receiptFor = (id, serverId = '55555555-5555-4555-8555-555555555555') => ({
  id: serverId,
  client_report_id: id,
  status: 'received',
  received_at: '2026-11-03T12:00:01Z',
  expires_at: null,
});
