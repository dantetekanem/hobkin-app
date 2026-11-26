import assert from 'node:assert/strict';
import { readFileSync, realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { draftFeedback } from '../src/cli/feedback/draft.mjs';
import { deliverFeedback, listFeedback, outboxFolder, saveCrashDraft } from '../src/cli/feedback/outbox.mjs';
import { fakePi } from './helpers/pi-session.mjs';
import { fakeServer, provision, receiptFor, reply } from './fixtures/hobkin-api/fake-server.mjs';

const NOW = Date.parse('2026-11-03T12:00:00Z');

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-crash-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  atomicJson(join(root, 'config.json'), { ...config, main: { ...config.main, model: 'fixture/local' }, background: { ...config.background, model: 'fixture/check' } });
  provision(root);
  return root;
}

/** A crash draft as the old terminal app left one in the outbox, which the application offers at its next start. */
function crash(root, at = NOW) {
  const draft = draftFeedback({ kind: 'crash', message: 'The dashboard stopped on an uncaught error.', now: at, crash: { error_class: 'TypeError', frames: ['hobkin/src/cli/application.mjs:12:5'] } });
  saveCrashDraft(root, draft, at);
  return draft;
}

test('a crash draft waits in the outbox and nothing sends it unasked', async t => {
  const root = fixture(t);
  const draft = crash(root);

  const [report] = listFeedback(root).reports;
  assert.deepEqual([report.kind, report.state], ['crash', 'draft']);
  const server = fakeServer(reply(201, receiptFor(draft.id)));
  await deliverFeedback(root, { fetch: server.fetch, now: () => NOW });
  assert.equal(server.calls.length, 0);
});

test('only the newest three crash drafts are kept, so a crash loop cannot pile them up', t => {
  const root = fixture(t);
  for (let index = 0; index < 5; index++) crash(root, NOW + index * 1000);
  assert.equal(listFeedback(root).reports.length, 3);
});

async function openWith(root, answer) {
  const asked = [];
  const receipts = new Map();
  const server = fakeServer(call => {
    if (!call.url.endsWith('/api/v1/feedback')) return reply(201, { id: '77777777-7777-4777-8777-777777777777', batch_id: call.headers['Idempotency-Key'], status: 'received', received_at: '2026-11-03T12:00:01Z' });
    const id = call.headers['Idempotency-Key'];
    receipts.set(id, receiptFor(id));
    return reply(201, receipts.get(id));
  });
  const fake = fakePi(root);
  const app = await HobkinApplication.open(root, {
    createMain: fake.createMain,
    fetch: server.fetch,
    askQuestion: async request => { asked.push(request); return answer; },
  });
  await app.offering;
  await app.close();
  return { asked, feedbackCalls: server.calls.filter(call => call.url.endsWith('/api/v1/feedback')) };
}

test('the next start offers the crash draft with its exact bytes, and a yes sends them', async t => {
  const root = fixture(t);
  crash(root);
  const [draft] = listFeedback(root).reports;
  const body = readFileSync(join(outboxFolder(root), `${draft.id}.json`), 'utf8');

  const { asked, feedbackCalls } = await openWith(root, 'send');

  assert.equal(asked.length, 1);
  assert.ok(asked[0].question.includes(JSON.parse(body).body));
  assert.match(asked[0].question, /SHA-256 [0-9a-f]{64}$/);
  assert.equal(asked[0].whenQuiet, true);
  assert.equal(feedbackCalls.length, 1);
  assert.deepEqual(feedbackCalls[0].body, Buffer.from(JSON.parse(body).body, 'utf8'));
  assert.equal(listFeedback(root).reports[0].state, 'sent');
});

test("Don't send deletes the crash draft, and putting the question off keeps it for the next start", async t => {
  const root = fixture(t);
  crash(root);

  const later = await openWith(root, null);
  assert.equal(later.feedbackCalls.length, 0);
  assert.equal(listFeedback(root).reports[0].state, 'draft');

  const declined = await openWith(root, 'keep');
  assert.equal(declined.asked.length, 1);
  assert.equal(declined.feedbackCalls.length, 0);
  assert.deepEqual(listFeedback(root).reports, []);

  const nothing = await openWith(root, 'send');
  assert.equal(nothing.asked.length, 0);
});
