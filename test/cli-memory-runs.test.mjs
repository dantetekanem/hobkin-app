import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { HobkinRunner } from '../src/cli/runner.mjs';
import { buildContext } from '../src/cli/context.mjs';
import { namingExtensions, runHarness } from '../src/cli/harnesses.mjs';
import { BRIDGE } from '../src/cli/bridge.mjs';
import { memoryExtension } from '../src/cli/memory-extension.mjs';
import { memoryKeeperExtension } from '../src/cli/memory-keeper-extension.mjs';
import { addMemory } from '../src/cli/memories.mjs';
import { memoryHandler } from '../src/cli/memory-tools.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { startSession } from '../src/cli/session.mjs';
import { inboxToTell } from '../src/cli/inbox.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const NOW = Date.parse('2026-11-23T14:00:00Z');
const as = { by: { kind: 'user' }, source: { kind: 'window' } };

/** One shared memory and one private, as the user would keep them. */
function remembering(root) {
  addMemory(root, { name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon', text: 'The user lives in Lisbon.' }, as);
  addMemory(root, { name: 'partner-name', kind: 'user', description: 'Partner is called Ana', text: 'Ana.', private: true }, as);
}

const routine = { id: 'check', title: 'Check', at: '09:00', timezone: 'UTC', enabled: true, cadence: 'daily', harness: 'pi', model: 'test', effort: 'high', context: [], prompt: 'Check the selected sources.' };

class MemoryRuntime {
  data = { main: null, runs: {}, lastTick: null };
  active = new Map();
  async state() { return structuredClone(this.data); }
  async change(fn) { return fn(this.data); }
  dispatch(request, effect, onAdmitted) {
    const controller = new AbortController();
    const run = this.data.runs[request.id] = { ...request, status: 'running' };
    onAdmitted?.();
    const work = Promise.resolve().then(() => effect(controller.signal)).catch(error => ({ status: 'failed', error: error.message }))
      .then(result => Object.assign(run, { status: result.status, result })).finally(() => this.active.delete(request.id));
    this.active.set(request.id, { controller, work });
    return work;
  }
  async idle() { await Promise.all([...this.active.values()].map(item => item.work)); }
}

async function routineRequest(t, setUp = () => {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-memory-routine-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'routines/daily'), { recursive: true });
  const { cadence, prompt, ...metadata } = { ...routine, cwd: root };
  writeFileSync(join(root, 'routines', cadence, 'check.md'), `---\n${JSON.stringify(metadata)}\n---\n${prompt}\n`);
  setUp(root);
  const asked = [];
  const runtime = new MemoryRuntime();
  const runner = new HobkinRunner({ root, runtime, config: { concurrency: 2, initializedAt: '2026-01-01T00:00:00Z' }, now: () => new Date(NOW),
    runHarness: async request => { asked.push(request); return { status: 'completed', text: 'ok' }; } });
  await runner.trigger('check', 'requested-by-user');
  await runtime.idle();
  return asked[0];
}

test("a routine's request carries the index of shared memories beside the right-now list, and loads hobkin's memory tools", async t => {
  const request = await routineRequest(t, remembering);
  const envelope = JSON.parse(request.prompt);
  assert.match(envelope.memories, /- lives-in-lisbon: Lives in Lisbon/);
  assert.match(envelope.memories, /hobkin_recall/);
  assert.doesNotMatch(request.prompt, /partner|Ana/, 'no private memory reaches a routine');
  assert.equal(request.memories, 'run');
});

test('a home with no memories gives a routine the request it had', async t => {
  const request = await routineRequest(t);
  assert.equal(Object.hasOwn(JSON.parse(request.prompt), 'memories'), false);
  assert.equal(Object.hasOwn(request, 'memories'), false);
});

test('a Work run or a routine with no room for the index still runs, without it', async t => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-memory-room-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const schedule = { ...routine, cwd };
  const check = { memory: null, log: [], directions: '', memories: '## What hobkin remembers\n\n- a-b: c' };
  assert.equal(JSON.parse(await buildContext(schedule, null, [], check)).memories, check.memories);
  const previous = process.env.HOBKIN_MAX_PROMPT_BYTES;
  t.after(() => { if (previous === undefined) delete process.env.HOBKIN_MAX_PROMPT_BYTES; else process.env.HOBKIN_MAX_PROMPT_BYTES = previous; });
  process.env.HOBKIN_MAX_PROMPT_BYTES = '65536';
  const bare = Buffer.byteLength(await buildContext(schedule, null, [], { ...check, memories: undefined }));
  const full = { ...check, directions: 'x'.repeat(65536 - bare - 5) };
  const tight = JSON.parse(await buildContext(schedule, null, [], full));
  assert.equal(Object.hasOwn(tight, 'memories'), false);
  assert.equal(tight.directions, full.directions);
});

/** A fake Pi on RPC whose one turn calls a tool over its bridge, says what it answered and settles. */
const calling = (name, params) => `
let input = '';
const send = event => process.stdout.write(JSON.stringify(event) + '\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  let end;
  while ((end = input.indexOf('\\n')) >= 0) {
    const cmd = JSON.parse(input.slice(0, end));
    input = input.slice(end + 1);
    const reply = data => send({ type: 'response', id: cmd.id, command: cmd.type, success: true, data });
    if (cmd.type === 'get_state') reply({ sessionId: 'pi-job', thinkingLevel: 'medium', model: { provider: 'test', id: 'model' } });
    else if (cmd.type === 'get_session_stats') reply({ sessionId: 'pi-job', cost: 0.1 });
    else if (cmd.type === 'extension_ui_response') {
      const answer = cmd.cancelled ? { ok: false, error: 'The Hobkin host did not answer.' } : JSON.parse(cmd.value);
      send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Read: ' + (answer.ok ? answer.result.content[0].text : answer.error) }] } });
      send({ type: 'agent_settled' });
    } else if (cmd.type === 'prompt') {
      reply({ disposition: 'started' });
      send({ type: 'agent_start' });
      send({ type: 'extension_ui_request', id: 'memory', method: 'input', title: ${JSON.stringify(BRIDGE)},
        placeholder: JSON.stringify({ op: 'tool', name: ${JSON.stringify(name)}, id: 'call-1', params: ${JSON.stringify(params)} }) });
    } else reply();
  }
});
`;
const fake = program => (_command, _args, options) => spawn(process.execPath, ['--input-type=module', '-e', program], options);

function job(t, extra = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'hobkin-memory-run-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { id: '0c3f6d3e-8f43-4a7e-9f7e-2b1c0f6a9d11', harness: 'pi', cwd, model: null, effort: 'medium', prompt: 'Look.', sessionFile: join(cwd, 'job.jsonl'), ...extra };
}

test("a run's recall and suggestion are served over its own pipe as hobkin knows the run, never with a private memory", { timeout: 10000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-memory-pipe-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  remembering(root);
  const memories = memoryHandler(root, { kind: 'run', id: 'check:1', title: 'Check' }, { now: () => NOW });
  const recalled = await runHarness(job(t), { spawnProcess: fake(calling('hobkin_recall', { words: 'ana' })), memories });
  assert.match(recalled.text, /^Read: No memory matches/, 'a private memory is not recalled for a run');
  const shared = await runHarness(job(t), { spawnProcess: fake(calling('hobkin_recall', { kind: 'user' })), memories });
  assert.match(shared.text, /lives-in-lisbon/);
  assert.doesNotMatch(shared.text, /partner/);
  const suggested = await runHarness(job(t), { spawnProcess: fake(calling('hobkin_suggest_memory', { kind: 'preference', description: 'Wants short reports' })), memories });
  assert.match(suggested.text, /^Read: Suggested\./);
  assert.deepEqual(inboxToTell(root, NOW).map(entry => [entry.kind, entry.from]), [['suggestion', 'Check']]);
  const saved = await runHarness(job(t), { spawnProcess: fake(calling('hobkin_remember', { action: 'add', name: 'x-y', kind: 'user', description: 'X' })), memories });
  assert.match(saved.text, /Invalid bridge request|Only the agents the user talks to/, 'a run cannot save one');
  const elsewhere = await runHarness(job(t), { spawnProcess: fake(calling('hobkin_recall', { words: 'lisbon' })) });
  assert.match(elsewhere.text, /not available here|did not answer/i);
});

test("a run given hobkin's memory loads its extension, a durable hobkin's turn the keeper's, and any other neither", async t => {
  const agentDir = mkdtempSync(join(tmpdir(), 'hobkin-agent-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true });
  });
  const started = [];
  const run = namingExtensions(async request => { started.push(request.extensions); });
  await run(job(t, { memories: 'run' }));
  await run(job(t, { memories: 'keeper', purpose: 'durable' }));
  await run(job(t));
  const [given, keeper, other] = started;
  assert.equal(given.includes(memoryExtension), true);
  assert.equal(given.includes(memoryKeeperExtension), false);
  assert.equal(keeper.includes(memoryKeeperExtension), true);
  assert.equal(keeper.includes(memoryExtension), false);
  assert.equal(other.some(path => path === memoryExtension || path === memoryKeeperExtension), false);
});

function app(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-memory-session-')));
  const opened = [];
  t.after(async () => {
    await Promise.all(opened.map(item => item.close()));
    rmSync(root, { recursive: true, force: true });
  });
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const calls = [];
  const open = async () => {
    const opening = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, intervalMs: 60000, now: () => NOW, runHarness: async (request, options) => {
      if (request.purpose) return { status: 'failed', cost: null, error: 'Not in this test.' };
      const call = { request, options, end: Promise.withResolvers() };
      request.signal?.addEventListener('abort', () => call.end.resolve({ status: 'interrupted', text: '', error: 'Harness cancelled.', cost: null }), { once: true });
      calls.push(call);
      return call.end.promise;
    } });
    opened.push(opening);
    return opening;
  };
  return { root, calls, open };
}

async function until(check, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw Error('Timed out waiting.');
    await wait(5);
  }
}

test('a hobkin session run gets the right-now list and the shared index, recalls no private memory, and its suggestion carries its title', { timeout: 10000 }, async t => {
  const h = app(t);
  remembering(h.root);
  writeFileSync(join(h.root, 'memory.md'), '- Reply to the landlord by Nov 28\n');
  const opened = await h.open();
  await startSession({ root: h.root, title: 'Ship 412', brief: 'Ship #412.', cwd: h.root, approved: true, tier: 'mid' });
  void opened.tickSessions();
  await until(() => h.calls.length === 1);
  const [{ request, options }] = h.calls;
  const prompt = JSON.parse(request.prompt);
  assert.deepEqual(prompt.memory, ['Reply to the landlord by Nov 28']);
  assert.match(prompt.memories, /- lives-in-lisbon: Lives in Lisbon/);
  assert.doesNotMatch(request.prompt, /partner|Ana/);
  assert.equal(request.memories, 'run');
  assert.match((await options.memories.recall({ words: 'ana' })).text, /^No memory matches/);
  assert.equal(options.memories.remember, undefined, 'a session run only suggests');
  await options.memories.suggest({ kind: 'preference', description: 'Wants CI green before a merge' });
  assert.deepEqual(inboxToTell(h.root, NOW).map(entry => [entry.kind, entry.from]), [['suggestion', 'Ship 412']]);
  h.calls[0].end.resolve({ status: 'completed', text: 'Useful: done.', cost: null });
});
