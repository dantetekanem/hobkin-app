import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initialize } from '../src/cli/config.mjs';
import { signRequest } from '../src/cli/remote/sign.mjs';
import {
  deleteFeedback, deliverFeedback, draftFromChat, listFeedback, outboxFolder, runFeedbackCommand, sendApproved, sentFolder,
} from '../src/cli/feedback/outbox.mjs';
import { credentialValues, fakeServer, provision, receiptFor, reply, TEST_CREDENTIALS } from './fixtures/hobkin-api/fake-server.mjs';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const HOUR = 3600000;
const DAY = 24 * HOUR;
const unavailable = () => reply(503, { error: { code: 'unavailable', message: 'unavailable' } });

function fixture(t, { enrolled = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-feedback-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  if (enrolled) provision(root);
  let clock = NOW;
  const options = server => ({ fetch: server.fetch, now: () => clock, sleep: async () => {} });
  return { root, options, later: ms => { clock += ms; }, draft: words => draftFromChat(root, words, { now: () => clock }) };
}

const outboxFile = (root, id) => join(outboxFolder(root), `${id}.json`);
const stateOf = (root, id) => listFeedback(root).reports.find(report => report.id === id)?.state;
const filesUnder = folder => (existsSync(folder) ? readdirSync(folder, { recursive: true }).map(name => join(folder, name)).filter(file => statSync(file).isFile()) : []);

test('a yes sends the exact bytes that were shown, and the receipt files it under sent', async t => {
  const h = fixture(t);
  const draft = h.draft('The report list froze');
  const server = fakeServer(reply(201, receiptFor(draft.id)));

  const result = await sendApproved(h.root, draft, h.options(server));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'sent');
  assert.match(result.message, /55555555-5555-4555-8555-555555555555/);
  const [call] = server.calls;
  assert.deepEqual(call.body, Buffer.from(draft.body, 'utf8'));
  assert.equal(call.headers['Idempotency-Key'], draft.id);
  assert.equal(call.url, 'https://api.example.test/api/v1/feedback');
  assert.deepEqual(readdirSync(outboxFolder(h.root)), []);
  const file = join(sentFolder(h.root), `${draft.id}.json`);
  const sent = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(sent.receipt, receiptFor(draft.id));
  assert.equal(sent.body, draft.body);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(stateOf(h.root, draft.id), 'sent');
});

test('bytes other than the ones shown are neither sent nor saved', async t => {
  const h = fixture(t);
  const draft = h.draft('The report list froze');
  const server = fakeServer(reply(201, receiptFor(draft.id)));

  const result = await sendApproved(h.root, { ...draft, body: draft.body.replace('froze', 'froze!') }, h.options(server));

  assert.deepEqual([result.ok, result.state], [false, 'void']);
  assert.equal(server.calls.length, 0);
  assert.equal(existsSync(outboxFile(h.root, draft.id)), false);
});

test('a report the server cannot take now waits, then goes on a later pass with the same bytes', async t => {
  const h = fixture(t);
  const draft = h.draft('The report list froze');
  const server = fakeServer(unavailable(), unavailable(), unavailable(), reply(201, receiptFor(draft.id)));

  const first = await sendApproved(h.root, draft, h.options(server));
  assert.deepEqual([first.ok, first.state], [false, 'waiting']);
  assert.match(first.message, /tries again/);
  assert.equal(stateOf(h.root, draft.id), 'waiting');

  await deliverFeedback(h.root, h.options(server));
  assert.equal(server.calls.length, 3, 'nothing goes before its next attempt is due');

  h.later(2 * HOUR);
  const [later] = await deliverFeedback(h.root, h.options(server));
  assert.equal(later.state, 'sent');
  assert.equal(server.calls.length, 4);
  for (const call of server.calls) assert.deepEqual(call.body, Buffer.from(draft.body, 'utf8'));
  assert.equal(new Set(server.calls.map(call => call.headers['X-Hobkin-Nonce'])).size, 4);
  assert.equal(stateOf(h.root, draft.id), 'sent');
});

test('a refusal is kept with its reason and never tried again', async t => {
  const h = fixture(t);
  const draft = h.draft('The report list froze');
  const server = fakeServer(reply(422, { error: { code: 'unsafe_content', message: 'unsafe content' } }));

  const result = await sendApproved(h.root, draft, h.options(server));
  assert.deepEqual([result.ok, result.state], [false, 'refused']);
  assert.match(result.message, /unsafe content/);

  h.later(DAY);
  await deliverFeedback(h.root, h.options(server));
  assert.equal(server.calls.length, 1);
  const listed = listFeedback(h.root).reports.find(report => report.id === draft.id);
  assert.deepEqual([listed.state, listed.error], ['refused', { status: 422, code: 'unsafe_content' }]);
});

test('an edit to a waiting report voids its yes, and it never goes', async t => {
  const h = fixture(t);
  const draft = h.draft('The report list froze');
  const server = fakeServer(unavailable(), unavailable(), unavailable(), reply(201, receiptFor(draft.id)));
  await sendApproved(h.root, draft, h.options(server));

  const file = outboxFile(h.root, draft.id);
  const record = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...record, body: record.body.replace('froze', 'was fine') }));
  h.later(2 * HOUR);
  await deliverFeedback(h.root, h.options(server));

  assert.equal(server.calls.length, 3);
  assert.equal(stateOf(h.root, draft.id), 'void');
});

test('off stops new and waiting reports alike, and on lets the waiting ones go', async t => {
  const h = fixture(t);
  const waiting = h.draft('The report list froze');
  const fresh = h.draft('The routines tab is empty');
  const server = fakeServer(unavailable(), unavailable(), unavailable(), reply(201, receiptFor(waiting.id)));
  await sendApproved(h.root, waiting, h.options(server));

  assert.deepEqual(await runFeedbackCommand(h.root, ['off'], h.options(server)), {
    feedback: 'off',
    message: 'Feedback is off. Nothing goes to the server, not even what waits in the outbox. hobkin feedback on turns it back on.',
  });
  assert.throws(() => h.draft('Another thing'), /Feedback is off/);
  const refused = await sendApproved(h.root, fresh, h.options(server));
  assert.deepEqual([refused.ok, refused.state], [false, 'off']);
  assert.equal(existsSync(outboxFile(h.root, fresh.id)), false);
  h.later(2 * HOUR);
  assert.deepEqual(await deliverFeedback(h.root, h.options(server)), []);
  assert.equal(server.calls.length, 3);

  assert.equal((await runFeedbackCommand(h.root, ['on'], h.options(server))).feedback, 'on');
  const [sent] = await deliverFeedback(h.root, h.options(server));
  assert.equal(sent.state, 'sent');
});

test('a machine that is not enrolled cannot draft, and nothing is written', t => {
  const h = fixture(t, { enrolled: false });

  assert.throws(() => h.draft('The report list froze'), /not enrolled/);
  assert.equal(existsSync(join(h.root, 'feedback')), false);
  assert.deepEqual(listFeedback(h.root), { feedback: 'on', enrolled: false, reports: [] });
});

test('list shows each report with its state, newest first, and nothing of the credentials', async t => {
  const h = fixture(t);
  const sent = h.draft('First, sent');
  await sendApproved(h.root, sent, h.options(fakeServer(reply(201, receiptFor(sent.id)))));
  h.later(1000);
  const waiting = h.draft('Second, waiting');
  await sendApproved(h.root, waiting, h.options(fakeServer(unavailable())));
  h.later(1000);
  const refused = h.draft('Third, refused');
  await sendApproved(h.root, refused, h.options(fakeServer(reply(422, { error: { code: 'invalid_payload', message: 'invalid payload' } }))));

  const listed = listFeedback(h.root);

  assert.deepEqual(listed.reports.map(({ state, message }) => [state, message]), [['refused', 'Third, refused'], ['waiting', 'Second, waiting'], ['sent', 'First, sent']]);
  assert.equal(listed.reports[2].serverId, '55555555-5555-4555-8555-555555555555');
  assert.match(listed.reports[1].nextAttemptAt, /^2026-11-03T/);
  const written = [JSON.stringify(listed), ...filesUnder(join(h.root, 'feedback')).map(file => readFileSync(file, 'utf8'))].join('\n');
  for (const value of credentialValues()) assert.equal(written.includes(value), false);
});

test('delete takes a report off this machine, and a sent one off the server too with a signed request', async t => {
  const h = fixture(t);
  const sent = h.draft('Sent and taken back');
  await sendApproved(h.root, sent, h.options(fakeServer(reply(201, receiptFor(sent.id)))));
  const waiting = h.draft('Never went');
  await sendApproved(h.root, waiting, h.options(fakeServer(unavailable())));
  await runFeedbackCommand(h.root, ['off']);

  const quiet = fakeServer(new Response(null, { status: 204 }));
  assert.deepEqual(await deleteFeedback(h.root, waiting.id, h.options(quiet)), { deleted: waiting.id, from: ['this machine'], message: 'Deleted. It never reached the server.' });
  assert.equal(quiet.calls.length, 0);

  const failing = fakeServer(unavailable());
  await assert.rejects(deleteFeedback(h.root, sent.id, h.options(failing)), /could not delete it/);
  assert.equal(stateOf(h.root, sent.id), 'sent');

  const server = fakeServer(new Response(null, { status: 204 }));
  const deleted = await deleteFeedback(h.root, sent.id, h.options(server));
  assert.deepEqual(deleted, { deleted: sent.id, from: ['the server', 'this machine'], message: 'Deleted from the server and from this machine.' });
  const [call] = server.calls;
  const path = '/api/v1/feedback/55555555-5555-4555-8555-555555555555';
  assert.equal(call.url, `https://api.example.test${path}`);
  assert.equal(call.method, 'DELETE');
  const expected = signRequest({
    secret: TEST_CREDENTIALS.secret,
    installationId: TEST_CREDENTIALS.installation_id,
    keyId: TEST_CREDENTIALS.key_id,
    method: 'DELETE',
    target: path,
    timestamp: call.headers['X-Hobkin-Timestamp'],
    nonce: call.headers['X-Hobkin-Nonce'],
    idempotencyKey: '',
    body: Buffer.alloc(0),
  });
  assert.equal(call.headers['X-Hobkin-Signature'], expected);
  assert.deepEqual(listFeedback(h.root).reports, []);
  await assert.rejects(deleteFeedback(h.root, sent.id, h.options(server)), /No feedback has the ID/);
});

test('a sent report the server no longer has is still taken off this machine', async t => {
  const h = fixture(t);
  const sent = h.draft('Gone on the server');
  await sendApproved(h.root, sent, h.options(fakeServer(reply(201, receiptFor(sent.id)))));

  const result = await deleteFeedback(h.root, sent.id, h.options(fakeServer(reply(404, { error: { code: 'not_found', message: 'not found' } }))));

  assert.deepEqual(result, { deleted: sent.id, from: ['this machine'], message: 'Deleted from this machine. The server had no copy for this installation.' });
});

test('a report the server never took is given up after seven days', async t => {
  const h = fixture(t);
  const draft = h.draft('The report list froze');
  const server = fakeServer(unavailable());
  await sendApproved(h.root, draft, h.options(server));

  h.later(8 * DAY);
  const [given] = await deliverFeedback(h.root, h.options(server));

  assert.equal(given.state, 'refused');
  assert.equal(server.calls.length, 3);
  assert.deepEqual(listFeedback(h.root).reports[0].error, { status: 0, code: 'expired' });
});
