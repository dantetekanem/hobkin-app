import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as piSdk from '@earendil-works/pi-coding-agent';
import { initialize } from '../src/cli/config.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';
import { HobkinRuntime } from '../src/cli/runtime.mjs';
import * as owned from '../src/cli/owned-agent-tool.mjs';
import hobkin from '../src/cli/hobkin-extension.mjs';
import { serveBridge } from '../src/cli/bridge.mjs';
import { fakePiRpc, hobkinTools } from './helpers/fake-rpc-pi.mjs';

const toolName = 'owned_agent';
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-owned-main-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root });
  config.main = { cwd: root, model: 'fixture/local', effort: 'medium' };
  return { root, config };
}
function extension() {
  const tools = {}, hooks = {};
  let active = [];
  hobkin({ registerTool: tool => { tools[tool.name] = tool; }, on: (name, fn) => { hooks[name] = fn; },
    getActiveTools: () => active, setActiveTools: names => { active = names; } });
  return { tools, hooks };
}
function sdk(t) {
  // Safety preflight, not behavioral evidence: refuse to open if the injected loader seam is gone.
  const source = readFileSync(new URL('../src/cli/pi-session.mjs', import.meta.url), 'utf8');
  if (!source.includes('loadSdk = () => import(') || !source.includes('} = await loadSdk();')) throw Error('SDK loader seam missing; refusing fixture');
  const refuse = () => { throw Error('Real SDK execution is forbidden in this fixture'); };
  t.mock.method(piSdk.DefaultResourceLoader.prototype, 'reload', refuse);
  t.mock.method(piSdk.ModelRuntime, 'create', refuse);
  let options, loaderOptions, inheritedSettings, reloaded = false;
  const session = { model: { provider: 'fixture', id: 'local' }, thinkingLevel: 'medium',
    sessionId: 'fake-sdk', sessionFile: null, messages: [], subscribe: () => () => {},
    bindExtensions: async () => {}, getActiveToolNames: () => options?.tools ?? [], dispose() {} };
  const dependencies = {
    agentDir: join(tmpdir(), 'unused-agent-dir'),
    loadSdk: async () => ({
      SessionManager: { open: file => { session.sessionFile = file; return { getSessionId: () => session.sessionId }; } },
      SettingsManager: {
        create: () => ({ applyOverrides() {} }),
        inMemory: value => { inheritedSettings = value; return { applyOverrides() {} }; },
      },
      DefaultResourceLoader: class {
        constructor(value) { loaderOptions = value; }
        async reload() { reloaded = true; }
        getExtensions() { return { extensions: loaderOptions.additionalExtensionPaths.map(path => ({ path })), errors: [] }; }
        getSkills() { return { skills: [], diagnostics: [] }; }
        getPrompts() { return { prompts: [], diagnostics: [] }; }
      },
      createCodemodeExtension: () => () => {}, createMcpExtension: () => () => {}, createToolSearchExtension: () => () => {},
    }),
    createSession: async value => { assert.ok(reloaded); options = value; return { session }; },
  };
  assert.equal(typeof dependencies.loadSdk, 'function');
  assert.equal(typeof dependencies.createSession, 'function');
  t.after(() => session.dispose());
  return {
    dependencies,
    tool: () => options.customTools.find(tool => tool.name === toolName),
    options: () => options,
    loaderOptions: () => loaderOptions,
    inheritedSettings: () => inheritedSettings,
  };
}

test('SDK registration uses the strict shared definition and forwards host callback and signal', async t => {
  const h = fixture(t), fake = sdk(t), calls = [];
  const callback = async (request, signal) => { calls.push({ request, signal }); return { id: 'host-child' }; };
  await openPiSession({ ...h, ownedAgent: callback }, fake.dependencies);
  const resourceOptions = fake.loaderOptions();
  assert.deepEqual(fake.inheritedSettings(), {});
  assert.equal(resourceOptions.noExtensions, true);
  assert.equal(resourceOptions.noSkills, true);
  assert.equal(resourceOptions.noPromptTemplates, true);
  assert.equal(resourceOptions.noContextFiles, true);
  assert.equal(resourceOptions.noThemes, true);
  assert.deepEqual(resourceOptions.additionalExtensionPaths, ['builtin:codemode', 'builtin:tool-search']);
  assert.deepEqual(resourceOptions.additionalSkillPaths, []);
  assert.deepEqual(resourceOptions.additionalPromptTemplatePaths, []);
  assert.deepEqual(resourceOptions.agentsFilesOverride(), { agentsFiles: [] });
  assert.ok(fake.options().tools.includes(toolName));
  const tool = fake.tool();
  assert.ok(tool, 'SDK exposes owned_agent');
  assert.deepEqual(tool.parameters, owned.createOwnedAgentSessionTool(callback).parameters);
  const signal = new AbortController().signal;
  const request = { action: 'spawn', name: 'bounded helper', allowHelpers: false };
  assert.deepEqual((await tool.execute('call', request, signal)).details, { id: 'host-child' });
  assert.deepEqual(calls, [{ request, signal }]);
  for (const next of [{ action: 'list' }, { action: 'status', id: 'host-child' }, { action: 'cancel', id: 'host-child' }]) {
    await tool.execute('next', next, signal);
    assert.deepEqual(calls.at(-1), { request: next, signal });
  }
});

test('strict execution refuses forged authority, malformed requests, missing host and pre-aborted calls', async () => {
  let calls = 0;
  const tool = owned.createOwnedAgentSessionTool(() => { calls++; return []; });
  const invalid = [null, [], { action: 'unknown' }, { action: 'spawn', name: ' ' },
    { action: 'spawn', name: 'x', allowHelpers: 'true' }, { action: 'status', id: '' },
    ...['parentId', 'rootId', 'task', 'role', 'model'].map(key => ({ action: 'spawn', name: 'x', [key]: 'forged' }))];
  for (const request of invalid) await assert.rejects(tool.execute('bad', request), /Invalid owned-agent request/);
  await assert.rejects(owned.createOwnedAgentSessionTool().execute('none', { action: 'list' }), /unavailable/);
  await assert.rejects(tool.execute('aborted', { action: 'list' }, AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('injected extension shares schema, activates capability and forwards cancellation to bridge', async () => {
  const { tools, hooks } = extension();
  const tool = tools[toolName];
  assert.ok(tool, 'extension exposes owned_agent');
  assert.deepEqual(tool.parameters, owned.createOwnedAgentSessionTool().parameters);
  await assert.rejects(tool.execute('invalid', { action: 'list', parentId: 'forged' }), /Invalid owned-agent/);
  await assert.rejects(tool.execute('aborted', { action: 'list' }, AbortSignal.abort()), { name: 'AbortError' });
  let hello;
  hooks.session_start({}, { ui: { setStatus: (_key, text) => { hello = JSON.parse(text); } } });
  assert.ok(hello.tools.includes(toolName));
  const controller = new AbortController();
  const ctx = { mode: 'rpc', ui: { input: async (_title, envelope, options) => {
    assert.equal(options.signal, controller.signal);
    return JSON.stringify(await serveBridge(envelope, { tools: {
      [toolName]: owned.createOwnedAgentSessionTool(async (request, signal) => {
        assert.deepEqual(request, { action: 'list' });
        assert.equal(signal, controller.signal);
        return ['host-child'];
      }),
    } }, options.signal));
  } } };
  assert.deepEqual((await tool.execute('extension', { action: 'list' }, controller.signal, undefined, ctx)).details, ['host-child']);
});

test('runtime RPC bridge forwards bound callbacks, rejects forged params/names, and requires capability', async t => {
  const h = fixture(t), pi = fakePiRpc(), calls = [];
  h.config.launcher = { command: ['synthetic-pi'], managedExtensions: true };
  const runtime = await HobkinRuntime.open(h.root, h.config, {
    ownedAgent: async (request, signal) => { calls.push({ request, signal }); if (request.action === 'spawn') throw Error('Direction prohibits helpers'); return ['scoped']; },
    createMain: options => openPiSession(options, { spawnProcess: pi.spawnProcess, graceMs: 20, startupTimeoutMs: 1000 }),
  });
  t.after(() => runtime.close());
  await runtime.connect();
  const call = (params, name = toolName) => serveBridge(JSON.stringify({ op: 'tool', name, id: 'rpc', params }), runtime.main, new AbortController().signal);
  assert.deepEqual((await call({ action: 'list' })).result.details, ['scoped']);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.match((await call({ action: 'spawn', name: 'x', rootId: 'forged' })).error, /Invalid owned-agent/);
  assert.match((await call({ action: 'list' }, '__proto__')).error, /Invalid bridge/);
  assert.equal(calls.length, 1);
  assert.match((await call({ action: 'spawn', name: 'x' })).error, /Direction prohibits helpers/);
  const missing = fakePiRpc({ hello: hobkinTools.filter(name => name !== toolName) });
  await assert.rejects(openPiSession({ ...h, fresh: true }, { spawnProcess: missing.spawnProcess, graceMs: 20, startupTimeoutMs: 1000 }), /did not activate its tools: owned_agent/);
});

test('RPC abort reaches an in-flight owned request through the actual UI dialog path', async t => {
  const h = fixture(t), pi = fakePiRpc();
  h.config.launcher = { command: ['synthetic-pi'], managedExtensions: true };
  const started = Promise.withResolvers(), cancelled = Promise.withResolvers();
  const session = await openPiSession({ ...h, ownedAgent: (_request, signal) => {
    signal.addEventListener('abort', () => { cancelled.resolve(); }, { once: true });
    started.resolve();
    return cancelled.promise.then(() => { signal.throwIfAborted(); });
  } }, { spawnProcess: pi.spawnProcess, graceMs: 20, startupTimeoutMs: 1000 });
  t.after(() => session.dispose());
  pi.children[0].emit_({ type: 'extension_ui_request', id: 'owned-call', method: 'input', title: 'hobkin/bridge',
    placeholder: JSON.stringify({ op: 'tool', name: toolName, id: 'owned-call', params: { action: 'list' } }) });
  await started.promise;
  await session.abort();
  await cancelled.promise;
});
