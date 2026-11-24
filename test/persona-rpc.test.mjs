import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const refuse = () => { throw Error('Live SDK/process/network execution forbidden'); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) mock.method(childProcess, name, refuse);
mock.method(globalThis, 'fetch', refuse);
syncBuiltinESMExports();
// Replace SDK and transport BEFORE importing the dependency graph; no resource loader can initialize.
const hooks = registerHooks({ resolve(specifier, context, next) {
  let source;
  if (specifier === '@earendil-works/pi-coding-agent') source = 'export const defineTool = value => value;';
  else if (specifier === '@earendil-works/pi-ai') source = 'export const clampThinkingLevel = () => { throw Error("Model API forbidden"); }; export const getSupportedThinkingLevels = clampThinkingLevel;';
  else if (specifier.endsWith('/rpc-process.mjs')) source = 'export const startRpcProcess = options => globalThis[Symbol.for("persona-rpc-transport")](options);';
  else if (specifier.startsWith('@earendil-works/')) throw Error(`Forbidden dependency: ${specifier}`);
  return source ? { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true } : next(specifier, context);
} });
after(() => { hooks.deregister(); mock.restoreAll(); syncBuiltinESMExports(); delete globalThis[Symbol.for('persona-rpc-transport')]; });
const { default: hobkin } = await import('../src/cli/hobkin-extension.mjs');
const { PiRpcSession, openRpcSession } = await import('../src/cli/rpc-session.mjs');
const { BRIDGE } = await import('../src/cli/bridge.mjs');
const { PERSONAS, composePersonaPrompt } = await import('../src/cli/persona.mjs');
const { initialize, setPersona } = await import('../src/cli/config.mjs');

function fixture(persona = () => 'Normal', pause = async () => {}) {
  const handlers = {}, operations = [];
  hobkin({ registerTool() {}, on: (name, handler) => { handlers[name] = handler; } });
  const session = new PiRpcSession({ tools: {}, persona, memory: () => ['Keep memory'],
    directions: () => 'Keep directions', decided: () => [] });
  let answer;
  session.child = { send: reply => { answer = reply; }, request: refuse, shutdown: refuse };
  const ctx = { mode: 'rpc', ui: { input: async (title, placeholder) => {
    assert.equal(title, BRIDGE);
    const op = JSON.parse(placeholder).op;
    operations.push(op);
    if (op === 'directions') await pause();
    await session.dialog({ id: 'bridge-id', method: 'input', title, placeholder });
    assert.equal(answer.id, 'bridge-id');
    return answer.value;
  } } };
  return { run: event => handlers.before_agent_start(event, ctx), operations, ctx };
}

test('RPC hook applies all exact voices once per run and Normal restores the current base', { timeout: 10000 }, async () => {
  let selected = 'Normal';
  const f = fixture(() => selected), event = { systemPrompt: 'Pi base x.y() https://example.com/a', prompt: '/exact user input' };
  const base = (await f.run(event)).systemPrompt;
  for (selected of PERSONAS) {
    assert.equal((await f.run(event)).systemPrompt, composePersonaPrompt(base, selected));
    assert.equal(event.prompt, '/exact user input');
    assert.deepEqual(f.operations.splice(0).slice(-5), ['persona', 'directions', 'memory', 'memories', 'decided']);
  }
  selected = 'Normal';
  assert.equal((await f.run({ ...event, systemPrompt: 'New Pi base' })).systemPrompt, base.replace(event.systemPrompt, 'New Pi base'));
});

test('RPC snapshots persona before slower context reads, then adopts the next selection', { timeout: 10000 }, async () => {
  let selected = 'hal', release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(() => selected, () => pending), event = { systemPrompt: 'Base' };
  const running = f.run(event);
  selected = 'yoda';
  release();
  const captured = (await running).systemPrompt;
  const base = captured.slice(0, captured.indexOf('\n\n<hobkin-persona>'));
  assert.equal(captured, composePersonaPrompt(base, 'hal'));
  assert.equal((await f.run(event)).systemPrompt, composePersonaPrompt(base, 'yoda'));
});

test('RPC propagates invalid or unavailable persona context rather than using stale style', { timeout: 10000 }, async () => {
  for (const getter of [() => 'unknown', () => { throw Error('Corrupt saved persona'); }]) {
    await assert.rejects(fixture(getter).run({ systemPrompt: 'Base' }), /persona/i);
  }
  const f = fixture();
  f.ctx.ui.input = async () => undefined;
  await assert.rejects(f.run({ systemPrompt: 'Base' }), /did not answer/);
});

test('configured main RPC reads durable persona lazily without changing session identity', { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'persona-rpc-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root });
  const file = join(root, 'main.jsonl');
  const state = { sessionId: 'exact-pi-id', sessionFile: file, model: { provider: 'fake', id: 'local' }, thinkingLevel: 'medium' };
  config.main = { cwd: root, model: 'fake/local', effort: 'medium' };
  globalThis[Symbol.for('persona-rpc-transport')] = ({ onRecord }) => {
    onRecord({ type: 'extension_ui_request', method: 'setStatus', statusKey: BRIDGE, statusText: JSON.stringify({ tools: ['ask_question', 'run_routine', 'message_check', 'stop_workload', 'owned_agent', 'hobkin_memory', 'model_settings', 'hobkin_schedule', 'hobkin_schedules', 'hobkin_recall', 'hobkin_remember', 'hobkin_action_items'] }) });
    return { closed: new Promise(() => {}), request: async name => name === 'get_state' ? state : name === 'get_messages' ? { messages: [] } : {}, shutdown: async () => {} };
  };
  const session = await openRpcSession({ root, config, file, prompts: [] });
  t.after(() => session.dispose());
  assert.equal(session.persona(), 'Normal');
  for (const persona of PERSONAS) { setPersona(root, persona); assert.equal(session.persona(), persona); }
  assert.equal(session.sessionId, state.sessionId);
  writeFileSync(join(root, 'config.json'), '{broken');
  assert.throws(() => session.persona());
});
