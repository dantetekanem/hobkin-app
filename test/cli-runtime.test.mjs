import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinRuntime } from '../src/cli/runtime.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';
import { initialize } from '../src/cli/config.mjs';
import { readReport } from '../src/cli/reports.mjs';

function home(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-runtime-'));
  const config = initialize(root, { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, config };
}
const withCompaction = async (runtime, compact) => {
  await runtime.connect();
  runtime.main.compact = compact;
  return runtime.main;
};

test('compacting holds the session so no turn can start under it, and the turn goes after', async t => {
  const { root, config } = home(t);
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory() });
  t.after(() => runtime.close());
  let finish;
  const main = await withCompaction(runtime, () => new Promise(resolve => { finish = resolve; }));

  const compacting = runtime.compactMain();

  assert.equal(runtime.mainFree, false);
  await assert.rejects(runtime.send('hello'), /busy/i);

  finish();
  assert.equal(await compacting, true);
  assert.equal(runtime.mainFree, true);
  assert.ok(main);
});

test('a question from the main conversation says it belongs to Chat', async t => {
  const { root, config } = home(t);
  const asked = [];
  let ask;
  const opening = mainFactory();
  const createMain = options => {
    ask = options.askQuestion;
    return opening(options);
  };
  const runtime = await HobkinRuntime.open(root, config, { createMain, askQuestion: async request => { asked.push(request); return 'yes'; } });
  t.after(() => runtime.close());
  await runtime.connect();

  const answer = await ask({ question: 'Apply it?', choices: [{ value: 'yes', label: 'Yes' }] });

  assert.equal(answer, 'yes');
  assert.deepEqual(asked, [{ question: 'Apply it?', choices: [{ value: 'yes', label: 'Yes' }], inChat: true }]);
});

test('a session in use is never compacted, because compact aborts what is running', async t => {
  const { root, config } = home(t);
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory() });
  t.after(() => runtime.close());
  let calls = 0;
  await withCompaction(runtime, async () => { calls += 1; });
  const release = runtime.reserveSession(runtime.main.sessionId);

  assert.equal(await runtime.compactMain(), false);

  release();
  assert.equal(calls, 0);
});

test('a compaction that fails is recorded and frees the session', async t => {
  const { root, config } = home(t);
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory() });
  t.after(() => runtime.close());
  await withCompaction(runtime, async () => { throw Error('Nothing to compact (session too small)'); });

  assert.equal(await runtime.compactMain(), false);

  assert.equal(runtime.mainFree, true);
  const { last } = runtime.contextInfo();
  assert.equal(last.status, 'failed');
  assert.match(last.error, /Nothing to compact/);
});

test('work waits only while the chat is at the force level or compacting, never on a stopped chat', async t => {
  const { root, config } = home(t);
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory() });
  t.after(() => runtime.close());
  await runtime.connect();
  const usage = percent => { runtime.main.getContextUsage = () => ({ percent, tokens: 1, contextWindow: 100 }); };

  usage(90);
  assert.equal(runtime.workWaitsForChat, false);

  usage(96);
  assert.equal(runtime.workWaitsForChat, true);

  runtime.mainFault = Error('Pi exited.');
  assert.equal(runtime.workWaitsForChat, false);
  runtime.mainFault = null;

  runtime.lastCompaction = { status: 'failed', at: new Date().toISOString() };
  assert.equal(runtime.workWaitsForChat, false, 'a compaction that cannot run must not stop the queue');
});

test('a background report is edited before it is saved, and a main turn never is', async t => {
  const { root, config } = home(t);
  const seen = [];
  const editReport = async (result, job) => {
    seen.push({ text: result.text, root: job.root });
    return { ...result, text: 'Useful: Edited.' };
  };
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory(), editReport });

  try {
    await runtime.dispatch({ id: 'job:edited', kind: 'background' }, async () => ({ status: 'completed', text: 'Useful: Draft.', cost: null }));
    await runtime.dispatch({ id: 'turn:main', kind: 'main' }, async () => ({ status: 'completed', text: 'A reply.', cost: null }));

    assert.deepEqual(seen, [{ text: 'Useful: Draft.', root: runtime.directory }]);
    assert.equal(readReport(root, 'job:edited'), 'Useful: Edited.');
    assert.equal((await runtime.state()).runs['job:edited'].result.text, 'Useful: Edited.');
  } finally {
    await runtime.close();
  }
});

function mainFactory(control = {}) {
  return async options => openPiSession(options, {
    agentDir: join(options.root, 'pi-agent'),
    createSession: async ({ sessionManager, resourceLoader }) => {
      control.resources = resourceLoader;
      const listeners = new Set();
      control.emit = event => { for (const callback of listeners) callback(event); };
      const session = {
        sessionId: sessionManager.getSessionId(),
        sessionFile: sessionManager.getSessionFile(),
        model: { provider: 'fake', id: 'local' },
        thinkingLevel: 'medium',
        get messages() { return sessionManager.buildSessionContext().messages; },
        subscribe(callback) {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
        getSessionStats() {
          return {
            sessionId: this.sessionId,
            cost: this.messages.filter(message => message.role === 'assistant').length * 0.5,
          };
        },
        async prompt(text, options) {
          control.calls = (control.calls ?? 0) + 1;
          if (control.reject) {
            options.preflightResult(false);
            throw Error('Rejected before dispatch');
          }
          sessionManager.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
          options.preflightResult(true);
          if (control.gate) await control.gate.promise;
          if (control.aborted) throw Error('Aborted');
          sessionManager.appendMessage({
            role: 'assistant',
            content: [{ type: 'text', text: `Reply: ${text}` }],
            timestamp: Date.now(),
            stopReason: 'stop',
            usage: { cost: { total: 0.5 } },
          });
          for (const callback of listeners) callback({ type: 'agent_settled' });
        },
        async abort() {
          control.aborted = true;
          control.gate?.resolve();
        },
        async bindExtensions() {},
        dispose() { control.disposed = true; },
      };
      return { session };
    },
  });
}

test('agents the main chat spawns through teams stand as teams says, and a reset ends the old ones unreported', async t => {
  const { root, config } = home(t);
  const control = {};
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory(control) });
  t.after(() => runtime.close());
  await runtime.connect();
  assert.deepEqual(runtime.mainChildren(), []);
  control.emit({ type: 'tool_execution_end', toolCallId: 's', toolName: 'spawn_swarm_agents', isError: false, result: { details: {
    session: 'private', spawned: [{ name: 'scout', role: 'read', modelSlot: 'read-collect' }, { name: 'fixer', role: 'write' }], failed: [] } } });
  control.emit({ type: 'message_end', message: { role: 'custom', customType: 'pi-extended-teams-report', display: true, content: 'Private report', details: { name: 'scout', ok: true } } });
  const states = () => runtime.mainChildren().map(({ name, state }) => [name, state]);
  assert.deepEqual(states(), [['scout', 'reported'], ['fixer', 'running']]);
  assert.doesNotMatch(JSON.stringify(runtime.mainChildren()), /private|Private report/i);
  // The old session's agents live inside it and end with it, without a report.
  const createMain = runtime.createMain;
  const opening = Promise.withResolvers();
  runtime.createMain = async options => { await opening.promise; return createMain(options); };
  const reset = runtime.reset();
  assert.deepEqual(states(), [['scout', 'reported'], ['fixer', 'stopped']]);
  opening.resolve();
  await reset;
  assert.deepEqual(runtime.mainChildren(), [], 'a fresh session starts with none');
  control.emit({ type: 'tool_execution_end', toolCallId: 'n', toolName: 'spawn_agent', isError: false, result: { details: { name: 'next', role: 'read' } } });
  assert.deepEqual(states(), [['next', 'running']]);
  runtime.mainFault = Error('Main Pi exited.');
  assert.deepEqual(states(), [['next', 'stopped']], 'a main Pi that stopped took its agents with it');
  runtime.mainFault = null;
});

test('the main chat keeps its own recent activity like a job does, never its thinking, and a reset starts it over', async t => {
  const { root, config } = home(t);
  const control = {};
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory(control) });
  t.after(() => runtime.close());
  await runtime.connect();
  control.emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
  control.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'private reasoning' } });
  control.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'Looking.' } });
  control.emit({ type: 'tool_execution_start', toolCallId: 'r', toolName: 'read', args: { path: 'notes.md' } });
  assert.deepEqual(runtime.mainActivity().map(({ kind, text, name, state }) => [kind, text ?? name, state]), [['assistant', 'Looking.', undefined], ['tool', 'read', 'running']]);
  assert.doesNotMatch(JSON.stringify(runtime.mainActivity()), /private reasoning/);
  for (let index = 0; index < 250; index++) control.emit({ type: 'tool_execution_end', toolCallId: `t${index}`, toolName: 'grep', result: { content: [] } });
  assert.equal(runtime.mainActivity().length, 200, 'a long chat keeps its latest steps');
  assert.equal(runtime.mainActivity().at(-1).id, 'tool:t249');
  await runtime.reset();
  assert.deepEqual(runtime.mainActivity(), []);
});

test('main SDK receives Hobkin context and ordinary project resources without an initial model turn', async t => {
  const { root, config } = home(t);
  const control = {};
  writeFileSync(join(root, 'AGENTS.md'), 'Synthetic local context');
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory(control) });
  try {
    await runtime.connect();
    assert.ok(control.resources.getAppendSystemPrompt().length > 0);
    assert.ok(control.resources.getAgentsFiles().agentsFiles.some(file => file.path === join(root, 'AGENTS.md')));
    assert.equal(control.calls, undefined);
  } finally {
    await runtime.close();
  }
});

test('real Durable reserves before effects, rejects concurrent owners, and reopens without replaying uncertain work', async t => {
  const { root, config } = home(t);
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory() });
  await assert.rejects(HobkinRuntime.open(root, config), /already running/);
  assert.equal(await runtime.admit({ id: 'job:1', kind: 'background', title: 'Check' }), true);
  assert.equal(await runtime.admit({ id: 'job:1', kind: 'background', title: 'Check' }), false);
  await runtime.close();
  const reopened = await HobkinRuntime.open(root, config, { createMain: mainFactory() });
  try {
    const state = await reopened.state();
    assert.equal(state.runs['job:1'].status, 'interrupted');
    assert.equal(state.runs['job:1'].cost, null);
    assert.equal(await reopened.admit({ id: 'job:1', kind: 'background' }), false);
    assert.equal(statSync(join(root, 'runtime', 'hobkin.sqlite')).mode & 0o777, 0o600);
  } finally {
    await reopened.close();
  }
});

test('the main Pi identity and conversation survive reconnect; initialization makes no prompt calls', async t => {
  const { root, config } = home(t);
  const control = {};
  let runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory(control) });
  await runtime.connect();
  const identity = (await runtime.state()).main;
  assert.equal(control.calls, undefined);
  await runtime.send('hello', 'message:1');
  await runtime.idle();
  assert.equal((await runtime.state()).runs['message:1'].status, 'completed');
  assert.equal((await runtime.state()).runs['message:1'].cost.usd, 0.5);
  await runtime.close();
  runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory(control) });
  try {
    await runtime.connect();
    assert.equal((await runtime.state()).main.sessionId, identity.sessionId);
    assert.equal(runtime.messages()[0].content, 'hello');
    assert.equal(control.calls, 1);
    await assert.rejects(runtime.send('hello', 'message:1'), /already admitted/);
  } finally {
    await runtime.close();
  }
});

test('acceptance returns before the model; cancellation records uncertainty and never submits again', async t => {
  const { root, config } = home(t);
  const control = { gate: Promise.withResolvers() };
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory(control) });
  await runtime.connect();
  await runtime.send('slow', 'message:2');
  assert.equal((await runtime.state()).runs['message:2'].status, 'running');
  await assert.rejects(runtime.send('not queued'), /busy/);
  await runtime.close();
  const reopened = await HobkinRuntime.open(root, config, { createMain: mainFactory() });
  try {
    assert.equal((await reopened.state()).runs['message:2'].status, 'interrupted');
    assert.equal(control.calls, 1);
    assert.equal(control.disposed, true);
  } finally {
    await reopened.close();
  }
});

test('the agent counts as free only while a new turn would start at once', async t => {
  const { root, config } = home(t);
  const control = { gate: Promise.withResolvers() };
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory(control) });
  assert.equal(runtime.mainFree, false, 'nothing is connected yet');
  await runtime.connect();
  assert.equal(runtime.mainFree, true);

  await runtime.send('slow');
  assert.equal(runtime.mainFree, false, 'a turn is under way');
  control.gate.resolve();
  await runtime.idle();
  assert.equal(runtime.mainFree, true);

  // Pi refuses a prompt during compaction, and a live turn would take it as steering.
  for (const busy of ['isCompacting', 'isStreaming']) {
    runtime.main[busy] = true;
    assert.equal(runtime.mainFree, false, busy);
    runtime.main[busy] = false;
  }

  const release = runtime.reserveSession(runtime.main.sessionId);
  assert.equal(runtime.mainFree, false, 'a migrated delivery holds the conversation');
  release();

  runtime.mainFault = Error('Pi exited.');
  assert.equal(runtime.mainFree, false, 'a stopped chat cannot take a turn');
  runtime.mainFault = null;

  await runtime.close();
  assert.equal(runtime.mainFree, false);
});

test('rejected main input retains a failed receipt and the caller receives a send error', async t => {
  const { root, config } = home(t);
  const control = { reject: true };
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory(control) });
  try {
    await runtime.connect();
    await assert.rejects(runtime.send('rejected', 'message:3'), /rejected/i);
    await runtime.idle();
    assert.equal((await runtime.state()).runs['message:3'].status, 'failed');
    assert.equal((await runtime.state()).runs['message:3'].result.noModel, true);
    assert.equal(runtime.messages().length, 0);
  } finally {
    await runtime.close();
  }
});

test('shutdown drains dispatch admission before releasing the storage owner', async t => {
  const { root, config } = home(t);
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory() });
  let calls = 0;
  const pending = runtime.dispatch({ id: 'job:closing', kind: 'background' }, async () => {
    calls++;
    return { status: 'completed' };
  });
  const observed = pending.catch(error => error);
  await runtime.close();
  await observed;
  assert.equal(calls, 0);
  const reopened = await HobkinRuntime.open(root, config, { createMain: mainFactory() });
  await reopened.close();
});

test('a scheduled run that finds nothing new keeps its receipt and log line, and saves no report', async t => {
  const { root, config } = home(t);
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory() });
  const quiet = async () => ({ status: 'completed', text: 'Nothing new.\n\nChecked the inbox.', cost: null });
  try {
    await runtime.dispatch({ id: 'job:quiet', kind: 'background', scheduleId: 'inbox', trigger: 'scheduled' }, quiet);
    await runtime.dispatch({ id: 'job:asked', kind: 'background', scheduleId: 'inbox', trigger: 'manual' }, quiet);

    assert.equal((await runtime.state()).runs['job:quiet'].status, 'completed');
    assert.equal(readReport(root, 'job:quiet', null), null);
    assert.equal(readReport(root, 'job:asked', null), 'Nothing new.\n\nChecked the inbox.');
    assert.equal(readFileSync(join(root, 'checks/inbox/log.md'), 'utf8').match(/Nothing new\./g).length, 2);
  } finally {
    await runtime.close();
  }
});

test('background dispatch commits final receipts once and a second call cannot repeat its effect', async t => {
  const { root, config } = home(t);
  const runtime = await HobkinRuntime.open(root, config, { createMain: mainFactory() });
  let calls = 0;
  const effect = async () => {
    calls++;
    assert.equal((await runtime.state()).runs['job:2'].status, 'running');
    return { status: 'completed', text: 'No changes', cost: null };
  };
  try {
    await runtime.dispatch({ id: 'job:2', kind: 'background' }, effect);
    await runtime.dispatch({ id: 'job:2', kind: 'background' }, effect);
    assert.equal(calls, 1);
    assert.equal((await runtime.state()).runs['job:2'].status, 'completed');
    assert.equal(readReport(root, 'job:2'), 'No changes');
    await assert.rejects(runtime.finish('job:2', { status: 'failed', text: 'changed' }), /conflicting/);
    await runtime.dispatch({ id: 'job:failure', kind: 'background' }, async () => ({
      status: 'failed', text: '# Partial evidence\n\nCollected before failure.', error: 'Tool failed',
    }));
    const failureRun = (await runtime.state()).runs['job:failure'];
    assert.equal(failureRun.status, 'failed');
    assert.equal(failureRun.cost, null);
    assert.equal(readReport(root, 'job:failure'), '# Partial evidence\n\nCollected before failure.\n\n---\n\n**Execution failure:** Tool failed');
    await runtime.admit({ id: 'job:unsaved', kind: 'background' });
    await assert.rejects(runtime.finish('job:unsaved', { status: 'completed', text: 'x'.repeat(16777217) }), /bounded/);
    assert.equal((await runtime.state()).runs['job:unsaved'].status, 'running');
  } finally {
    await runtime.close();
  }
});

test('finished and abandoned checks each land in the check log exactly once', async t => {
  const { root, config } = home(t);
  const request = id => ({ id, kind: 'background', scheduleId: 'mail', title: 'Mail', harness: 'pi' });
  const first = await HobkinRuntime.open(root, config, { createMain: mainFactory() });
  await first.dispatch(request('mail:1'), async () => ({
    status: 'completed',
    text: 'Blocked: Gmail tools are unavailable.\n\nDetails.',
    cost: { usd: 0.25, kind: 'estimate' },
  }));
  await first.finish('mail:1', (await first.state()).runs['mail:1'].result);
  await first.admit(request('mail:2'));
  await first.close();

  const second = await HobkinRuntime.open(root, config, { createMain: mainFactory() });
  await second.close();

  const lines = readFileSync(join(root, 'checks/mail/log.md'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /\| scheduled \| completed \| \d+s \| \$0\.25 \| Blocked: Gmail tools are unavailable\.$/);
  assert.match(lines[1], /\| scheduled \| interrupted \| \d+s \| The previous owner stopped without a completion receipt\. Not replayed\.$/);
});
