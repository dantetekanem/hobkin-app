import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize, setFeedback } from '../src/cli/config.mjs';
import { readEvents } from '../src/cli/events.mjs';
import { captureCrashes, CRASH_MESSAGE, errorClass, normalizeFrames } from '../src/cli/feedback/crash.mjs';
import { deliverFeedback, listFeedback, outboxFolder } from '../src/cli/feedback/outbox.mjs';
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

function crash(root, error = new TypeError('Cannot read token=abc123 of /Users/jane/secret.txt'), origin = 'uncaughtException') {
  const events = new EventEmitter();
  const stop = captureCrashes(root, events, { now: () => NOW });
  events.emit('uncaughtExceptionMonitor', error, origin);
  stop();
  return events;
}

const draftBody = root => {
  const [name] = readdirSync(outboxFolder(root));
  return JSON.parse(JSON.parse(readFileSync(join(outboxFolder(root), name), 'utf8')).body);
};

test('frames inside the package are rewritten, and every other frame is dropped', () => {
  const stack = [
    "TypeError: Cannot read properties of undefined (reading 'token=abc')",
    '    at render (file:///opt/hobkin/src/cli/ui.mjs:120:15)',
    '    at /opt/hobkin/src/cli/application.mjs:300:7',
    '    at async Promise.all (index 0)',
    '    at Object.<anonymous> (/Users/jane/Projects/private-repo/index.js:1:1)',
    '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
    '    at TUI.doRender (file:///opt/hobkin/node_modules/@earendil-works/pi-tui/dist/tui.js:812:22)',
    '    at eval (eval at <anonymous> (file:///opt/hobkin/src/cli/ui.mjs:1:1), <anonymous>:1:1)',
    '    at Array.map (<anonymous>)',
    '    at new Thing (file:///opt/hobkin/src/cli/has%20space.mjs:3:3)',
    '    at file:///opt/hobkin/../escape/evil.mjs:1:1',
    '    at /opt/hobkin-other/src/cli/ui.mjs:1:1',
    '    at node:events:519:28',
    '    at EventEmitter.emit (node:events)',
  ].join('\n');

  assert.deepEqual(normalizeFrames(stack, { packageRoot: '/opt/hobkin' }), [
    'hobkin/src/cli/ui.mjs:120:15',
    'hobkin/src/cli/application.mjs:300:7',
    'node:internal/process/task_queues:95:5',
    'hobkin/node_modules/@earendil-works/pi-tui/dist/tui.js:812:22',
    'node:events:519:28',
  ]);
});

test('at most 40 frames go, and a stack with none is an empty list', () => {
  const stack = ['Error: x', ...Array.from({ length: 50 }, (_, index) => `    at step (/opt/hobkin/src/cli/ui.mjs:${index + 1}:1)`)].join('\n');

  assert.equal(normalizeFrames(stack, { packageRoot: '/opt/hobkin' }).length, 40);
  assert.deepEqual(normalizeFrames(undefined, { packageRoot: '/opt/hobkin' }), []);
});

test('the error class is a short identifier, never the message', () => {
  class WeirdThing extends Error {}
  const renamed = Object.assign(new Error('x'), { name: 'Error: /Users/jane/secret' });

  assert.equal(errorClass(new TypeError('x')), 'TypeError');
  assert.equal(errorClass(new WeirdThing('x')), 'WeirdThing');
  assert.equal(errorClass(Object.assign(new Error('x'), { name: 'AbortError' })), 'AbortError');
  assert.equal(errorClass(renamed), 'Error');
  assert.equal(errorClass('a thrown string'), 'Error');
  assert.equal(errorClass(null), 'Error');
});

test('an uncaught error writes a local crash draft with no words of its own, and nothing sends it', async t => {
  const root = fixture(t);
  const events = crash(root);

  const [report] = listFeedback(root).reports;
  assert.deepEqual([report.kind, report.state], ['crash', 'draft']);
  const body = draftBody(root);
  assert.equal(body.message, CRASH_MESSAGE);
  assert.equal(body.occurred_at, '2026-11-03T12:00:00Z');
  assert.equal(body.crash.error_class, 'TypeError');
  assert.ok(body.crash.frames.length >= 1 && body.crash.frames.length <= 40);
  for (const frame of body.crash.frames) assert.match(frame, /^(hobkin\/[A-Za-z0-9_@./-]+\.(mjs|cjs|js|ts)|node:[A-Za-z0-9_/-]+):\d+(:\d+)?$/);
  assert.doesNotMatch(JSON.stringify(body), /abc123|\/Users\/jane|Cannot read/);
  assert.equal(events.listenerCount('uncaughtExceptionMonitor'), 0);

  const server = fakeServer(reply(201, receiptFor(body.id)));
  await deliverFeedback(root, { fetch: server.fetch, now: () => NOW });
  assert.equal(server.calls.length, 0);
});

test('a crash is also a structured fact in the local stream, with its category', t => {
  const root = fixture(t);
  crash(root);
  crash(root, new RangeError('x'), 'unhandledRejection');

  assert.deepEqual(readEvents(root).filter(({ type }) => type === 'crash_occurred').map(({ at, type, ...facts }) => facts), [
    { component: 'cli', category: 'uncaught_exception', fatal: true },
    { component: 'cli', category: 'unhandled_rejection', fatal: true },
  ]);
});

test('with feedback off a crash writes no draft, and a crash loop keeps only the newest three', t => {
  const root = fixture(t);
  setFeedback(root, false);
  crash(root);
  assert.equal(existsSync(outboxFolder(root)), false);

  setFeedback(root, true);
  for (let index = 0; index < 5; index++) crash(root, new TypeError(`crash ${index}`));
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
