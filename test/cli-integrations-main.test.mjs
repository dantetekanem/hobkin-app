import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';
import { HobkinRuntime } from '../src/cli/runtime.mjs';
import { INTEGRATIONS_ENV, integrationExtension, readOffer } from '../src/cli/integration-extension.mjs';
import { integrationEnvironment, integrationOffer, MAIN_AGENT } from '../src/cli/integrations.mjs';
import { runMainSessionChild } from '../src/cli/main-session-child.mjs';
import { dialog, fakePiRpc } from './helpers/fake-rpc-pi.mjs';
import { fakePi } from './helpers/pi-session.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';

const object = properties => ({ type: 'object', properties, additionalProperties: false });
const notesAdd = { name: 'notes_add', description: 'Adds a note.', parameters: object({ text: { type: 'string' } }), agents: ['main'] };
const runsOnly = { name: 'notes_sweep', description: 'Sweeps notes.', parameters: object({}), agents: ['runs'] };

function host(tools = [notesAdd, runsOnly]) {
  const calls = [];
  return { calls, tools: () => tools, async callTool(name, args, call) { calls.push({ name, args, call }); return { text: `${name}: ${args.text}` }; } };
}

async function until(condition, message = 'condition') {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw Error(`Timed out waiting for ${message}`);
    await new Promise(resolve => setImmediate(resolve));
  }
}

/** The main conversation behind a launcher, on an in-memory Pi, as `cli-rpc-session.test.mjs` starts it. */
async function launched(t, integrations) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-integrations-main-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main = { cwd: root, model: 'fixture/local', effort: 'medium' };
  config.launcher = { command: ['my-pi-launcher', 'pi'], env: {}, managedExtensions: true };
  atomicJson(join(root, 'config.json'), config);
  const fake = fakePiRpc();
  const dependencies = { spawnProcess: fake.spawnProcess, graceMs: 50, createSession: () => { throw Error('Pi started in this process.'); } };
  const opened = [];
  const runtime = await HobkinRuntime.open(root, config, {
    createMain: options => { opened.push(options); return openPiSession(options, dependencies); },
    ...(integrations ? { integrations } : {}),
  });
  t.after(() => Promise.race([runtime.close(), new Promise(resolve => setTimeout(resolve, 2000).unref())]));
  await runtime.connect();
  const ask = async request => {
    const id = dialog(fake.children.at(-1), { method: 'input', title: 'hobkin/bridge', placeholder: JSON.stringify(request) });
    const answered = () => fake.received.find(record => record.type === 'extension_ui_response' && record.id === id);
    await until(answered, `the reply to ${id}`);
    return JSON.parse(answered().value);
  };
  return { fake, opened, ask, spawned: fake.spawned[0] };
}

test("the main conversation's Pi loads the tools offered to it, and a call runs in the host as #main", { timeout: 10000 }, async t => {
  const given = host();
  const main = await launched(t, given);
  assert.equal(main.opened[0].integrations, given);
  assert.equal(main.spawned.args.includes(integrationExtension), true);
  assert.deepEqual(readOffer(main.spawned.options.env), integrationOffer(given, 'main'));
  assert.deepEqual(readOffer(main.spawned.options.env).tools.map(tool => tool.name), ['notes_add']);
  const answer = await main.ask({ op: 'integration_tool', name: 'notes_add', id: 'pi-call-1', params: { text: 'milk' } });
  assert.deepEqual(answer, { ok: true, result: { text: 'notes_add: milk', failed: false } });
  assert.deepEqual(given.calls, [{ name: 'notes_add', args: { text: 'milk' }, call: { agent: MAIN_AGENT, id: 'pi-call-1' } }]);
  const other = await main.ask({ op: 'integration_tool', name: 'notes_sweep', id: 'pi-call-2', params: {} });
  assert.deepEqual(other, { ok: false, error: 'Invalid bridge request.' }, 'a tool offered only to runs');
});

test('without the option the main conversation starts as it did: no extension, no offer, and a call is refused', { timeout: 10000 }, async t => {
  const previous = process.env[INTEGRATIONS_ENV];
  process.env[INTEGRATIONS_ENV] = JSON.stringify({ tools: [{ name: 'stray', description: 'x', parameters: object({}) }] });
  t.after(() => { if (previous === undefined) delete process.env[INTEGRATIONS_ENV]; else process.env[INTEGRATIONS_ENV] = previous; });
  const main = await launched(t, undefined);
  assert.equal(Object.hasOwn(main.opened[0], 'integrations'), false);
  assert.equal(main.spawned.args.includes(integrationExtension), false);
  assert.equal(Object.hasOwn(main.spawned.options.env, INTEGRATIONS_ENV), false, 'an offer this process inherited is not passed on');
  const answer = await main.ask({ op: 'integration_tool', name: 'notes_add', id: 'pi-call-1', params: { text: 'milk' } });
  assert.deepEqual(answer, { ok: false, error: 'Invalid bridge request.' });
});

/** The bootstrap a parent hands its main session child, for `runMainSessionChild`. */
function bootstrap(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-integrations-child-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'sessions'));
  const file = join(root, 'sessions', 'main.jsonl');
  writeFileSync(file, `${JSON.stringify({ type: 'session', version: 3, id: 'saved', cwd: root })}\n`);
  return { type: 'hobkin/main/bootstrap', version: 1, id: 'request-1', root, file,
    expected: { sessionId: 'saved', sessionFile: file }, config: { main: { cwd: root, effort: 'medium' } }, resourceCandidates: [] };
}

test('the main session child hands the offer in its environment to the conversation it opens, and none when it has none', async t => {
  const opened = [];
  for (const env of [integrationEnvironment(integrationOffer(host(), 'main')), {}]) {
    const data = bootstrap(t), channel = new EventEmitter();
    channel.send = () => {};
    const session = { sessionId: 'saved', sessionFile: data.file, sessionManager: { getCwd: () => data.root }, bindExtensions: async () => {} };
    const services = { cwd: data.root, assertMainInvariants() {} };
    const running = runMainSessionChild(channel, {
      env,
      loadSdk: async () => ({
        AgentSessionRuntime: class { constructor(value) { this.session = value; } setRebindSession() {} async dispose() {} },
        runRpcMode: async runtime => { await runtime.session.bindExtensions({ mode: 'rpc' }); await runtime.dispose(); },
      }),
      openSession: async (_options, deps) => { opened.push(deps.rpcBridge); return { session, services }; },
    });
    channel.emit('message', data);
    await running;
  }
  assert.deepEqual(opened, [{ integrations: integrationOffer(host(), 'main') }, {}]);
});

/** `openConversation` on a fake SDK that records what the loader and the session were given, as `cli-sdk-resources.test.mjs` does. */
async function conversation(t, rpcBridge) {
  const { openConversation } = await import('../src/cli/pi-session.mjs');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-integrations-sdk-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root });
  config.main = { cwd: root, effort: 'medium' };
  let loaderOptions, sessionOptions;
  const session = { model: null, thinkingLevel: 'medium', dispose() {}, bindExtensions: async () => {}, getActiveToolNames: () => sessionOptions.tools };
  const refuse = () => { throw Error('Real SDK forbidden'); };
  const dependencies = {
    agentDir: join(root, 'agent'), rpcBridge, deferExtensionBinding: true,
    loadSdk: async () => ({
      SessionManager: { open: () => ({ getSessionId: () => 'fake' }) },
      SettingsManager: { create: () => ({ applyOverrides() {} }), inMemory: value => ({ isolated: value }) },
      DefaultResourceLoader: class {
        constructor(options) { loaderOptions = options; }
        async reload() {}
        getExtensions() { return { extensions: loaderOptions.additionalExtensionPaths.map(path => ({ path })), errors: [] }; }
        getSkills() { return { skills: loaderOptions.additionalSkillPaths.map(filePath => ({ filePath })), diagnostics: [] }; }
        getPrompts() { return { prompts: loaderOptions.additionalPromptTemplatePaths.map(filePath => ({ filePath })), diagnostics: [] }; }
      },
      ModelRuntime: { create: refuse }, createAgentSession: refuse,
      createCodemodeExtension: () => () => {}, createToolSearchExtension: () => () => {},
    }),
    createSession: async options => { sessionOptions = options; return { session }; },
  };
  const opened = await openConversation({ root, config, file: join(root, 'sessions', 'main.jsonl') }, dependencies);
  await opened.session.bindExtensions({ mode: 'rpc' });
  return { tools: sessionOptions.tools, factories: loaderOptions.extensionFactories.length, opened };
}

test("in the session child the offered tools join the main conversation's exact tool list, through one more extension", async t => {
  const offered = await conversation(t, { integrations: integrationOffer(host(), 'main') });
  const plain = await conversation(t, {});
  assert.deepEqual(offered.tools, [...plain.tools, 'notes_add']);
  assert.equal(offered.factories, plain.factories + 1);
  assert.doesNotThrow(() => offered.opened.services.assertMainInvariants());
});

test("hobkin's application hands its option to the main conversation as it opens", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-integrations-app-')));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  atomicJson(join(root, 'config.json'), config);
  const given = host();
  const opened = [];
  const { createMain } = fakePi(root);
  const app = await HobkinApplication.open(root, { createMain: options => { opened.push(options); return createMain(options); }, intervalMs: 60000, integrations: given,
    runHarness: async () => ({ status: 'failed', cost: null, error: 'Not in this test.' }) });
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  await app.runtime.connect();
  assert.equal(opened.at(-1).integrations, given);
});

test("a host that only hooks calls still gives the main conversation the extension, and its hooks are asked as #main", { timeout: 10000 }, async t => {
  const heard = [];
  const hooking = { tools: () => [], hookedTools: () => ['bash'], async beforeTool(call) { heard.push(call); return { block: 'Not now.' }; } };
  const main = await launched(t, hooking);
  assert.equal(main.spawned.args.includes(integrationExtension), true);
  assert.deepEqual(readOffer(main.spawned.options.env), { tools: [], hooked: ['bash'] });
  const answer = await main.ask({ op: 'tool_before', name: 'bash', id: 'pi-call-1', args: { command: 'ls' } });
  assert.deepEqual(answer, { ok: true, result: { block: 'Not now.' } });
  assert.deepEqual(heard, [{ agent: MAIN_AGENT, id: 'pi-call-1', name: 'bash', args: { command: 'ls' } }]);
});
