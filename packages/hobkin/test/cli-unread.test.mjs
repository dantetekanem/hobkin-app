import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';
import { HobkinRuntime } from '../src/cli/runtime.mjs';
import { recordSessionEnd, recordSessionStart, sessionsToTell } from '../src/cli/session-log.mjs';
import { forgetUnread, keepUnread, readUnread } from '../src/cli/unread.mjs';
import { cardActionsToTell, recordCardAction } from '../src/cli/work/card-actions.mjs';

/**
 * Pi as hobkin's runtime meets it, with no model: a turn runs until the test ends it, and a message sent meanwhile waits in Pi's
 * queue until the test lets Pi read it, as Pi does after the tool calls under way. What Pi reads goes into the real session file.
 */
function steeringPi(root) {
  const pi = { prompts: [], queue: [] };
  const createMain = options => openPiSession(options, {
    agentDir: join(root, 'test-agent'),
    createSession: async ({ sessionManager, thinkingLevel, tools }) => {
      const listeners = new Set();
      const say = message => {
        sessionManager.appendMessage(message);
        for (const listener of [...listeners]) listener({ type: 'message_end', message });
      };
      const user = text => ({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() });
      let gate = null, aborted = false;
      const session = {
        sessionId: sessionManager.getSessionId(),
        sessionFile: sessionManager.getSessionFile(),
        thinkingLevel,
        model: { provider: 'fixture', id: 'local' },
        isStreaming: false,
        get messages() { return sessionManager.buildSessionContext().messages; },
        getSessionStats() { return { sessionId: session.sessionId, cost: 0 }; },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async prompt(text, { preflightResult } = {}) {
          pi.prompts.push(text);
          session.isStreaming = true;
          aborted = false;
          gate = Promise.withResolvers();
          say(user(text));
          preflightResult?.('started');
          try {
            await gate.promise;
            if (aborted) throw Error('Aborted');
            say({ role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stopReason: 'stop', timestamp: Date.now() });
          } finally {
            session.isStreaming = false;
          }
        },
        async steer(text) {
          pi.queue.push(text);
          return 'queued';
        },
        clearQueue() { return { steering: pi.queue.splice(0), followUp: [] }; },
        async abort() {
          aborted = true;
          gate?.resolve();
        },
        async bindExtensions() {},
        getActiveToolNames() { return [...tools]; },
        dispose() {},
      };
      pi.read = () => { for (const text of pi.queue.splice(0)) say(user(text)); };
      pi.finish = () => gate?.resolve();
      pi.session = session;
      return { session };
    },
  });
  return { pi, createMain };
}

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-unread-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  return { root, config, ...steeringPi(root) };
}

async function runtimeHome(t, options = {}) {
  const h = home(t);
  const runtime = await HobkinRuntime.open(h.root, h.config, { createMain: h.createMain, ...options });
  t.after(() => runtime.close());
  await runtime.connect();
  return { ...h, runtime };
}

const runHarness = async () => { throw Error('No agent runs in this test.'); };

async function appHome(t) {
  const h = home(t);
  const app = await HobkinApplication.open(h.root, { createMain: h.createMain, runHarness });
  t.after(() => app.close());
  return { ...h, app };
}

function endSession(root, name, title) {
  const report = join(root, 'runtime', 'handoffs', `${name}.report.md`);
  recordSessionStart(root, { name, title, report });
  mkdirSync(join(root, 'runtime', 'handoffs'), { recursive: true });
  writeFileSync(report, `# Report\n\n${title} is done.`);
  recordSessionEnd({ name, report });
}

const noteOf = text => JSON.parse(text.match(/^<hobkin-work>\n(.*)\n<\/hobkin-work>\n\n/)?.[1] ?? '{}');
const sessionsIn = text => (noteOf(text).sessions ?? []).map(({ name }) => name);
const unheard = root => sessionsToTell(root).map(({ name }) => name);
const didIn = text => (noteOf(text).userDid ?? []).map(({ did }) => did);
const actionsUnheard = root => cardActionsToTell(root).map(({ id }) => id);
const kept = root => readUnread(root).map(({ text }) => text);

test('a steered message counts as read once Pi puts it into the turn, and one a stop takes back never does', async t => {
  const h = await runtimeHome(t);
  const reads = [];
  await h.runtime.send('Original', 'original');

  const queued = await h.runtime.send('Read correction', 'read', undefined, undefined, read => reads.push(['read', read]));
  assert.equal(queued.queued, true);
  assert.deepEqual(reads, [], 'taken into Pi\'s queue is not read yet');
  h.pi.read();
  assert.deepEqual(reads, [['read', true]]);

  await h.runtime.send('Never read', 'unread', undefined, undefined, read => reads.push(['unread', read]));
  assert.deepEqual(await h.runtime.interrupt(), ['Never read']);
  await h.runtime.idle();
  assert.deepEqual(reads, [['read', true], ['unread', false]]);
});

test('the news a steered message carries stays unheard until the model reads it, and a stop leaves it for the next message', async t => {
  const h = await appHome(t);
  const sent = t.mock.method(h.app.runtime, 'send');
  const said = index => sent.mock.calls[index].arguments[0];

  await h.app.send('Start on the release');
  endSession(h.root, 'hobkin-land-1', 'Land finboard');
  recordCardAction(h.root, { id: 'card:row-0', did: 'marked it done', title: 'Row 0', line: 'Marked "Row 0" done.' });
  await h.app.send('Also check the budget');
  assert.deepEqual(sessionsIn(said(1)), ['hobkin-land-1']);
  assert.deepEqual(didIn(said(1)), ['marked it done']);
  assert.deepEqual(unheard(h.root), ['hobkin-land-1'], 'taken into the turn is not heard yet');
  assert.ok(actionsUnheard(h.root).includes('card:row-0'));

  await h.app.send('And the taxes');
  assert.deepEqual(sessionsIn(said(2)), [], 'a message waiting to be read already carries it');
  assert.deepEqual(didIn(said(2)), []);

  assert.deepEqual(await h.app.interrupt(), ['Also check the budget', 'And the taxes']);
  assert.deepEqual(unheard(h.root), ['hobkin-land-1']);
  assert.ok(actionsUnheard(h.root).includes('card:row-0'));

  await h.app.send('Start again');
  assert.deepEqual(sessionsIn(said(3)), ['hobkin-land-1']);
  assert.ok(didIn(said(3)).includes('marked it done'));
  assert.deepEqual(unheard(h.root), [], 'a message that starts its own turn is read');
  assert.ok(!actionsUnheard(h.root).includes('card:row-0'));
});

test('the news a steered message carries is heard once the model reads it, and the next message does not carry it again', async t => {
  const h = await appHome(t);
  const sent = t.mock.method(h.app.runtime, 'send');
  const said = index => sent.mock.calls[index].arguments[0];

  await h.app.send('Start on the release');
  endSession(h.root, 'hobkin-land-1', 'Land finboard');
  await h.app.send('Also check the budget');
  h.pi.read();
  assert.deepEqual(unheard(h.root), []);

  h.pi.finish();
  await h.app.runtime.idle();
  await h.app.send('What next?');
  assert.deepEqual(sessionsIn(said(2)), []);
});

test('words kept for the window come back oldest first, each once, until they are forgotten', t => {
  const { root } = home(t);
  assert.deepEqual(readUnread(root), []);

  keepUnread(root, ['Check the budget', 'And the taxes']);
  keepUnread(root, ['And the taxes', 'Then the rent', '  ']);

  assert.deepEqual(kept(root), ['Check the budget', 'And the taxes', 'Then the rent']);
  assert.equal(new Set(readUnread(root).map(({ id }) => id)).size, 3);
  forgetUnread(root);
  assert.deepEqual(readUnread(root), []);
});

test('a close keeps what the model never read, and the next open keeps it once and sends nothing', async t => {
  const h = await runtimeHome(t);
  await h.runtime.send('Original', 'original');
  await h.runtime.send('Late correction', 'late');

  await h.runtime.close();
  assert.deepEqual(kept(h.root), ['Late correction']);

  const prompts = [...h.pi.prompts];
  const reopened = await HobkinRuntime.open(h.root, h.config, { createMain: h.createMain });
  await reopened.close();
  assert.deepEqual(kept(h.root), ['Late correction']);
  assert.deepEqual(h.pi.prompts, prompts);
});

test('a close whose queue never answers goes on without it', async t => {
  const h = await runtimeHome(t, { unreadWaitMs: 20 });
  await h.runtime.send('Original', 'original');
  await h.runtime.send('Late correction', 'late');
  h.runtime.main.clearQueue = () => new Promise(() => {});

  await h.runtime.close();
  assert.deepEqual(readUnread(h.root), []);
});

test('after a crash, steering whose words the session file does not hold is kept, and nothing is sent again', async t => {
  const h = await runtimeHome(t);
  await h.runtime.send('Original', 'original');
  h.pi.finish();
  await h.runtime.idle();
  await h.runtime.send('Read correction', 'second');
  h.pi.finish();
  await h.runtime.idle();
  // What a crash leaves behind: steering taken in while a turn ran, with no receipt.
  await h.runtime.change(state => {
    for (const [id, prompt, startedAt] of [['read', 'Read correction', '2026-01-02T09:00:01.000Z'], ['unread', 'Never read', '2026-01-02T09:00:02.000Z']]) {
      state.runs[id] = { id, kind: 'main', title: 'Steering', prompt, harness: 'pi', sessionId: state.main.sessionId, parentRunId: 'gone', status: 'running', startedAt, cost: null };
    }
  });
  await h.runtime.close();
  const prompts = [...h.pi.prompts];

  const reopened = await HobkinRuntime.open(h.root, h.config, { createMain: h.createMain });
  t.after(() => reopened.close());
  assert.deepEqual(kept(h.root), ['Never read']);
  const { runs } = await reopened.state();
  assert.deepEqual([runs.read.status, runs.unread.status], ['interrupted', 'interrupted']);
  assert.deepEqual(h.pi.prompts, prompts);
});

test('after a close, what the model never read waits in the snapshot for the window, without hobkin\'s notes, until the user sends again', async t => {
  const h = home(t);
  let app = await HobkinApplication.open(h.root, { createMain: h.createMain, runHarness });
  await app.send('Start on the release');
  endSession(h.root, 'hobkin-land-1', 'Land finboard');
  await app.send('Also check the budget');
  await app.close();
  assert.match(kept(h.root)[0], /^<hobkin-work>/, 'kept as it went, notes and all');

  const prompts = [...h.pi.prompts];
  app = await HobkinApplication.open(h.root, { createMain: h.createMain, runHarness });
  t.after(() => app.close());
  const view = await app.refresh();
  assert.deepEqual(view.unread.map(({ text }) => text), ['Also check the budget']);
  assert.deepEqual(h.pi.prompts, prompts, 'hobkin sends nothing by itself');
  assert.deepEqual(unheard(h.root), ['hobkin-land-1']);

  await app.send('Also check the budget, please');
  assert.equal((await app.refresh()).unread, undefined);
  assert.deepEqual(readUnread(h.root), []);
});
