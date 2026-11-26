import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initialize } from '../src/cli/config.mjs';
import { draftFromChat, sendApproved } from '../src/cli/feedback/outbox.mjs';
import { main } from '../src/cli/main.mjs';
import { fakeServer, provision, receiptFor, reply } from './fixtures/hobkin-api/fake-server.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-feedback-cli-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  provision(root);
  return root;
}

async function run(root, args, dependencies = {}) {
  let text = '';
  const code = await main([...args, '--home', root], { write: chunk => { text += chunk; } }, dependencies);
  return { code, text, json: () => JSON.parse(text) };
}

test('hobkin feedback lists what was sent from /feedback, and list says the same', async t => {
  const root = fixture(t);
  const draft = draftFromChat(root, 'The report list froze');
  await sendApproved(root, draft, { fetch: fakeServer(reply(201, receiptFor(draft.id))).fetch });

  const plain = await run(root, ['feedback']);
  const listed = await run(root, ['feedback', 'list']);

  assert.equal(plain.code, 0);
  assert.deepEqual(plain.json(), listed.json());
  assert.deepEqual(plain.json().reports.map(({ id, state }) => [id, state]), [[draft.id, 'sent']]);
});

test('hobkin feedback off and on change only that setting', async t => {
  const root = fixture(t);
  const before = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));

  assert.equal((await run(root, ['feedback', 'off'])).json().feedback, 'off');
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')), { ...before, feedback: { enabled: false } });
  assert.equal((await run(root, ['feedback'])).json().feedback, 'off');
  assert.equal((await run(root, ['feedback', 'on'])).json().feedback, 'on');
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')), { ...before, feedback: { enabled: true } });
});

test('hobkin feedback delete takes a sent report back through the injected client', async t => {
  const root = fixture(t);
  const draft = draftFromChat(root, 'The report list froze');
  await sendApproved(root, draft, { fetch: fakeServer(reply(201, receiptFor(draft.id))).fetch });
  const server = fakeServer(new Response(null, { status: 204 }));

  const deleted = await run(root, ['feedback', 'delete', draft.id], { fetch: server.fetch });

  assert.deepEqual(deleted.json().from, ['the server', 'this machine']);
  assert.equal(server.calls[0].method, 'DELETE');
  assert.deepEqual((await run(root, ['feedback'])).json().reports, []);
});

test('hobkin feedback refuses what it does not know and changes nothing', async t => {
  const root = fixture(t);
  const before = readFileSync(join(root, 'config.json'), 'utf8');

  for (const args of [['maybe'], ['delete'], ['off', 'now'], ['list', 'all'], ['delete', 'a', 'b']]) {
    await assert.rejects(run(root, ['feedback', ...args]), /^Error: Usage: hobkin feedback/);
  }
  assert.equal(readFileSync(join(root, 'config.json'), 'utf8'), before);
});

test('the usage names the feedback and upload commands', async () => {
  let text = '';
  await main(['--help'], { write: chunk => { text += chunk; } });

  assert.match(text, /feedback \[list \| on \| off \| delete <id>\]/);
  assert.match(text, /telemetry upload \[on \| off \| status\]/);
});
