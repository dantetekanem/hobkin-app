import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';
import { MAIN_PULSE_KEY, createPulses } from '../src/cli/pulse.mjs';
import { HobkinRuntime } from '../src/cli/runtime.mjs';

/**
 * Pi as hobkin's runtime meets it, with no model: a turn starts, says its prompt and waits until the test ends it or fails
 * it, and the test sends Pi's events in between, in their wire form.
 */
function scriptedPi(root) {
  const pi = {};
  const createMain = options => openPiSession(options, {
    agentDir: join(root, 'test-agent'),
    createSession: async ({ sessionManager, thinkingLevel, tools }) => {
      const listeners = new Set();
      const emit = event => { for (const listener of [...listeners]) listener(event); };
      const say = message => {
        sessionManager.appendMessage(message);
        emit({ type: 'message_end', message });
      };
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
          session.isStreaming = true;
          aborted = false;
          gate = Promise.withResolvers();
          emit({ type: 'agent_start' });
          say({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() });
          preflightResult?.('started');
          try {
            const failure = await gate.promise;
            if (aborted) throw Error('Aborted');
            if (failure) throw failure;
            say({ role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stopReason: 'stop', timestamp: Date.now() });
          } finally {
            session.isStreaming = false;
            emit({ type: 'agent_end' });
          }
        },
        clearQueue() { return { steering: [], followUp: [] }; },
        async abort() {
          aborted = true;
          gate?.resolve();
        },
        async bindExtensions() {},
        getActiveToolNames() { return [...tools]; },
        dispose() {},
      };
      Object.assign(pi, { emit, finish: () => gate?.resolve(), fail: error => gate?.resolve(error) });
      return { session };
    },
  });
  return { pi, createMain };
}

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-pulses-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  return { root, config, ...scriptedPi(root) };
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
  const app = await HobkinApplication.open(h.root, { createMain: h.createMain, runHarness, intervalMs: 60000 });
  t.after(() => app.close());
  return { ...h, app };
}

/** Pulse code that fails at every step. */
const brokenPulses = () => new Proxy({}, { get() { throw Error('The pulse broke.'); } });
const wireUpdate = (type, delta) => ({ type: 'message_update', usage: {}, assistantMessageEvent: { type, contentIndex: 0, delta } });
const shape = ({ phase, direction, tokens }) => ({ phase, direction, tokens });

async function until(done, ms = 3000) {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw Error('It never happened.');
    await wait(20);
  }
}

test("the main turn's pulse begins with the words it was sent, follows Pi through the whole turn and goes when the turn ends", async t => {
  const pulses = createPulses();
  const h = await runtimeHome(t, { pulses });
  const before = Date.now();
  await h.runtime.send('abcdefgh');
  const begun = pulses.get(MAIN_PULSE_KEY);
  assert.ok(begun.startedAt >= before && begun.startedAt <= Date.now());
  assert.deepEqual(shape(begun), { phase: 'working', direction: 'up', tokens: 2 }, 'the prompt Pi says back counts once');

  h.pi.emit({ type: 'turn_start' });
  h.pi.emit(wireUpdate('thinking_delta', 'a'.repeat(40)));
  assert.deepEqual(shape(pulses.get(MAIN_PULSE_KEY)), { phase: 'thinking', direction: 'down', tokens: 12 });
  // The prompt a turn sends once its helpers report starts Pi again, and the turn goes on with the same pulse.
  h.pi.emit({ type: 'agent_end' });
  h.pi.emit({ type: 'agent_start' });
  assert.equal(pulses.get(MAIN_PULSE_KEY).startedAt, begun.startedAt);
  assert.equal(pulses.get(MAIN_PULSE_KEY).tokens, 12);

  h.pi.finish();
  await h.runtime.idle();
  assert.equal(pulses.get(MAIN_PULSE_KEY), undefined);
});

test('a main turn that is stopped, fails or is closed leaves no pulse', async t => {
  const pulses = createPulses();
  const h = await runtimeHome(t, { pulses });

  await h.runtime.send('Stop me');
  assert.ok(pulses.get(MAIN_PULSE_KEY));
  assert.deepEqual(await h.runtime.interrupt(), []);
  await h.runtime.idle();
  assert.equal(pulses.get(MAIN_PULSE_KEY), undefined, 'stopped');

  await h.runtime.send('Fail me');
  h.pi.fail(Error('The provider is down.'));
  await h.runtime.idle();
  assert.equal(pulses.get(MAIN_PULSE_KEY), undefined, 'failed');

  await h.runtime.send('Close me');
  await h.runtime.close();
  assert.equal(pulses.get(MAIN_PULSE_KEY), undefined, 'closed');
});

test('pulse code that fails never reaches the main turn', async t => {
  const h = await runtimeHome(t, { pulses: brokenPulses() });
  const { id } = await h.runtime.send('Still works');
  h.pi.emit(wireUpdate('text_delta', 'Words'));
  assert.equal(h.runtime.mainActivity().at(-1).text, 'Words', "the turn's own feed still has its words");
  h.pi.finish();
  await h.runtime.idle();
  assert.equal((await h.runtime.state()).runs[id].status, 'completed');
});

test("a run's events give it a pulse in the snapshot until the state says it ended, and an idle snapshot has none", async t => {
  const h = await appHome(t);
  const idle = await h.app.refresh();
  assert.equal(idle.pulses, undefined);
  assert.doesNotMatch(JSON.stringify(idle), /"pulses"/);

  await h.app.runtime.admit({ id: 'run-1', kind: 'background', scheduleId: 'check', title: 'Check' });
  h.app.observeActivity('run-1', { type: 'agent_start' });
  h.app.observeActivity('run-1', { type: 'message_end', message: { role: 'user', content: 'abcdefgh' } });
  // A run admitted after a rebuild read the state keeps its pulse through that rebuild.
  h.app.observeActivity('run-2', { type: 'agent_start' });
  const live = await h.app.refresh();
  assert.deepEqual(Object.keys(live.pulses).sort(), ['run-1', 'run-2']);
  assert.deepEqual(shape(live.pulses['run-1']), { phase: 'working', direction: 'up', tokens: 2 });
  assert.deepEqual(live.jobActivity['run-1'], [], 'these events draw nothing in the run\'s own feed');

  await h.app.runtime.finish('run-1', { status: 'completed', text: 'Useful: Done.' });
  const ended = await h.app.refresh();
  assert.deepEqual(Object.keys(ended.pulses), ['run-2']);
  h.app.observeActivity('run-2', { type: 'agent_end' });
  h.app.publishActivity();
  assert.equal(h.app.snapshot.pulses, undefined);
});

test("the main turn's pulse goes out with the activity while it works and is gone once it ends", async t => {
  const h = await appHome(t);
  await h.app.send('Look at the budget');
  h.app.publishActivity();
  assert.deepEqual(Object.keys(h.app.snapshot.pulses), [MAIN_PULSE_KEY]);
  assert.equal(h.app.snapshot.pulses[MAIN_PULSE_KEY].direction, 'up');
  h.pi.finish();
  await h.app.runtime.idle();
  assert.equal((await h.app.refresh()).pulses, undefined);
});

test('a change the wire held back goes out once its second is over, with no event after it', async t => {
  const h = await appHome(t);
  await h.app.runtime.admit({ id: 'run-1', kind: 'background', scheduleId: 'check', title: 'Check' });
  const published = [];
  h.app.onChange = view => published.push({ at: Date.now(), pulse: view.pulses?.['run-1'] });
  h.app.observeActivity('run-1', { type: 'agent_start' });
  await h.app.refresh();
  const shown = published.find(({ pulse }) => pulse);
  assert.equal(shown.pulse.phase, 'working');

  h.app.observeActivity('run-1', wireUpdate('thinking_start'));
  const asked = published.length;
  await until(() => published.some(({ pulse }) => pulse?.phase === 'thinking'));
  const thinking = published.findIndex(({ pulse }) => pulse?.phase === 'thinking');
  const meanwhile = published.slice(asked, thinking);
  assert.ok(meanwhile.length && meanwhile.every(({ pulse }) => pulse.phase === 'working'), 'the activity published meanwhile held it back');
  const heldMs = published[thinking].at - shown.at;
  assert.ok(heldMs >= 900, `held back for the rest of its second (${heldMs} ms)`);
});

test('pulse code that fails never fails a run or a publish, and the snapshot then has no pulses', async t => {
  const h = await appHome(t);
  await h.app.runtime.admit({ id: 'run-1', kind: 'background', scheduleId: 'check', title: 'Check' });
  h.app.pulses = brokenPulses();
  h.app.observeActivity('run-1', { type: 'message_start', message: { role: 'assistant', content: [] } });
  h.app.observeActivity('run-1', wireUpdate('text_delta', 'Draft'));
  const view = await h.app.refresh();
  assert.equal(view.jobActivity['run-1'][0].text, 'Draft');
  assert.equal(view.pulses, undefined);
  h.app.publishActivity();
  assert.equal(h.app.snapshot.pulses, undefined);
});
