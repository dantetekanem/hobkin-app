import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import childProcess from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { TLA_SKILL } from '../src/cli/skills-extension.mjs';
import { outwardGuardExtension } from '../src/cli/outward-guard-extension.mjs';

async function fixture(t) {
  // Refuse before importing/opening if an SDK boundary could fall back to the real loader.
  const source = readFileSync(new URL('../src/cli/pi-session.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('} = await loadSdk();'));
  const refuse = () => { throw Error('Real SDK/provider/network execution forbidden'); };
  t.mock.method(globalThis, 'fetch', refuse);
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) t.mock.method(childProcess, name, refuse);
  for (const [module, names] of [[net, ['connect', 'createConnection']], [http, ['request', 'get']], [https, ['request', 'get']]]) {
    for (const name of names) t.mock.method(module, name, refuse);
  }
  t.mock.method(process, 'kill', refuse);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const { openPiSession } = await import('../src/cli/pi-session.mjs');
  const { initialize } = await import('../src/cli/config.mjs');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-sdk-resources-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root });
  config.main = { cwd: root, effort: 'medium' };
  let loaderOptions, sessionOptions, reloads = 0;
  const session = { model: null, thinkingLevel: 'medium', dispose() {}, bindExtensions: async () => {},
    getActiveToolNames: () => sessionOptions.tools };
  const settings = { applyOverrides() {} };
  const dependencies = {
    agentDir: join(root, 'agent'),
    loadSdk: async () => ({
      SessionManager: { open: () => ({ getSessionId: () => 'fake' }) },
      SettingsManager: { create: () => settings, inMemory: value => ({ isolated: value }) },
      DefaultResourceLoader: class {
        constructor(options) { loaderOptions = options; }
        async reload() { reloads++; }
        getExtensions() { return { extensions: loaderOptions.additionalExtensionPaths.map(path => ({ path })), errors: [] }; }
        getSkills() { return { skills: loaderOptions.additionalSkillPaths.map(filePath => ({ filePath })), diagnostics: [] }; }
        getPrompts() { return { prompts: loaderOptions.additionalPromptTemplatePaths.map(filePath => ({ filePath })), diagnostics: [] }; }
      },
      ModelRuntime: { create: refuse }, createAgentSession: refuse,
      createCodemodeExtension: () => () => {}, createToolSearchExtension: () => () => {},
      createMcpExtension: refuse,
    }),
    createSession: async options => { sessionOptions = options; return { session }; },
  };
  return { root, config, dependencies, session,
    open: () => openPiSession({ root, config }, dependencies),
    loader: () => loaderOptions, options: () => sessionOptions, reloads: () => reloads };
}

test('empty inheritance isolates discovery but retains Hobkin prompts, hooks and bridge tools', async t => {
  const h = await fixture(t);
  await h.open();
  const loader = h.loader();
  for (const flag of ['noExtensions', 'noSkills', 'noPromptTemplates', 'noContextFiles', 'noThemes']) assert.equal(loader[flag], true, flag);
  assert.deepEqual(loader.settingsManager.isolated, {});
  assert.deepEqual(loader.additionalExtensionPaths, ['builtin:codemode', 'builtin:tool-search', outwardGuardExtension]);
  assert.deepEqual(loader.additionalSkillPaths, [TLA_SKILL], 'the skills hobkin ships still load');
  const shipped = { filePath: TLA_SKILL };
  assert.deepEqual(loader.skillsOverride({ skills: [shipped], diagnostics: [] }).skills, [shipped]);
  assert.deepEqual(loader.additionalPromptTemplatePaths, []);
  assert.equal(loader.systemPromptOverride('inherited SYSTEM.md'), undefined);
  assert.deepEqual(loader.agentsFilesOverride({ agentsFiles: [{ path: '/inherited', content: 'no' }] }), { agentsFiles: [] });
  assert.equal(loader.appendSystemPrompt.length, 5);
  const hooks = {};
  loader.extensionFactories.at(-1)({ on: (name, fn) => { hooks[name] = fn; } });
  const prompt = hooks.before_agent_start({ systemPrompt: 'base' }).systemPrompt;
  assert.match(prompt, /base/);
  assert.match(prompt, /Current memory/);
  assert.match(prompt, /directions/i);
  assert.ok(h.options().customTools.some(tool => tool.name === 'owned_agent'));
  assert.ok(h.options().customTools.some(tool => tool.name === 'hobkin_memory'));
  assert.ok(h.options().tools.includes('bash'));
  assert.ok(h.options().tools.includes('codemode'));
  assert.equal(h.reloads(), 1);
});

test('trusted installed candidates bind only explicit local resources', async t => {
  const h = await fixture(t);
  const kinds = ['instructions', 'skills', 'templates', 'extensions'];
  h.dependencies.resourceCandidates = kinds.map(kind => {
    const path = join(h.root, `${kind}.md`);
    writeFileSync(path, `selected ${kind}`);
    return { id: `test.${kind}`, kind, installed: true, path };
  });
  h.config.resourceSelection = { version: 1, purposes: { main: Object.fromEntries(kinds.map(kind => [kind, [`test.${kind}`]])) } };
  await h.open();
  const loader = h.loader();
  assert.deepEqual(loader.additionalExtensionPaths, ['builtin:codemode', 'builtin:tool-search', join(h.root, 'extensions.md'), outwardGuardExtension]);
  assert.deepEqual(loader.additionalSkillPaths, [TLA_SKILL, join(h.root, 'skills.md')]);
  assert.deepEqual(loader.additionalPromptTemplatePaths, [join(h.root, 'templates.md')]);
  assert.deepEqual(loader.agentsFilesOverride({ agentsFiles: [] }).agentsFiles, [{ path: join(h.root, 'instructions.md'), content: 'selected instructions' }]);
  const selected = { filePath: join(h.root, 'skills.md') };
  assert.deepEqual(loader.skillsOverride({ skills: [selected], diagnostics: [] }).skills, [selected]);
  assert.throws(() => loader.skillsOverride({ skills: [{ filePath: '/inherited' }] }), /re-enabled/);
  assert.throws(() => loader.promptsOverride({ prompts: [{ filePath: '/inherited' }] }), /re-enabled/);
});

test('explicit MCP/tool bindings and non-file candidates are unavailable before SDK loading', async t => {
  const h = await fixture(t);
  h.dependencies.loadSdk = () => { throw Error('SDK must not load'); };
  for (const kind of ['mcp', 'tools', 'extensions']) {
    h.config.resourceSelection = { version: 1, purposes: { main: { [kind]: ['test.selected'] } } };
    h.dependencies.resourceCandidates = [{ id: 'test.selected', kind, installed: true, path: h.root }];
    await assert.rejects(h.open(), /unavailable|regular-file/);
  }
});

test('extension tool re-enablement refuses rather than expanding the main tool policy', async t => {
  const h = await fixture(t);
  h.session.getActiveToolNames = () => ['unselected_tool'];
  await assert.rejects(h.open(), /re-enabled/);
});

test('failed loader diagnostics and missing required tools refuse session readiness', async t => {
  const h = await fixture(t);
  const loadSdk = h.dependencies.loadSdk;
  h.dependencies.loadSdk = async () => {
    const sdk = await loadSdk();
    sdk.DefaultResourceLoader.prototype.getExtensions = () => ({ extensions: [], errors: [{ error: 'fixture load failure' }] });
    return sdk;
  };
  await assert.rejects(h.open(), /failed to load/);
  h.dependencies.loadSdk = loadSdk;
  h.session.getActiveToolNames = () => [];
  await assert.rejects(h.open(), /missing/);
});

for (const [scriptedMain, active] of [[false], [true], [true, []], [true, ['client', 'bash']]]) test(`child SDK context and exact tools: scripted=${scriptedMain}, active=${active}`, async t => {
  const h = await fixture(t), extensionPath = join(h.root, 'client.mjs');
  writeFileSync(extensionPath, 'fixture');
  h.dependencies.rpcBridge = { clientExtensionPath: extensionPath };
  h.dependencies.deferExtensionBinding = true;
  h.dependencies.scriptedMain = scriptedMain;
  if (scriptedMain) {
    h.session.model = { provider: 'hobkin-client', id: 'scripted' };
    const loadSdk = h.dependencies.loadSdk;
    h.dependencies.loadSdk = async () => {
      const sdk = await loadSdk();
      sdk.SettingsManager.create = () => assert.fail('inherited settings read');
      return sdk;
    };
    Object.assign(h.dependencies, {
      modelRuntime: {},
      recoverScriptedHistory: true,
      pickModel: () => assert.fail('live model picker'),
    });
  }
  // The child factory supplies no parent function-valued tools across its bootstrap boundary.
  const { openConversation } = await import('../src/cli/pi-session.mjs');
  const result = await openConversation({ root: h.root, config: h.config, file: join(h.root, 'sessions', 'main.jsonl') }, h.dependencies);
  const handlers = {}, tools = [], calls = [];
  h.loader().extensionFactories.at(-1)({ registerTool: tool => tools.push(tool), on: (name, handler) => {
    assert.equal(handlers[name], undefined); handlers[name] = handler;
  }, getActiveTools: () => h.options().tools });
  assert.equal(h.loader().extensionFactories.length, 3);
  assert.ok(h.loader().additionalExtensionPaths.includes(extensionPath));
  assert.deepEqual(h.options().customTools, []);
  assert.deepEqual(h.options().tools.filter(name => !['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'codemode', 'tool_search', 'client'].includes(name)).sort(), tools.map(tool => tool.name).sort());
  assert.ok(h.options().tools.includes('client'));
  const ctx = { mode: 'rpc', ui: { setStatus: () => {}, input: async (_title, request) => {
    const { op } = JSON.parse(request); calls.push(op);
    return JSON.stringify({ ok: true, result: op === 'persona' ? 'Normal' : op === 'directions' ? 'directions' : [] });
  } } };
  if (!scriptedMain) handlers.session_start({}, ctx);
  if (active) {
    h.session.getActiveToolNames = () => active;
    await assert.rejects(result.session.bindExtensions({ mode: 'rpc' }), /missing|re-enabled/); return;
  }
  await result.session.bindExtensions({ mode: 'rpc' });
  if (scriptedMain) assert.deepEqual(h.session.getActiveToolNames(), ['client']);
  assert.match((await handlers.before_agent_start({ systemPrompt: 'base' }, ctx)).systemPrompt, /base/);
  assert.deepEqual(calls, scriptedMain ? [] : ['persona', 'directions', 'memory', 'memories', 'decided']);
  if (scriptedMain) {
    assert.deepEqual(tools, []); assert.equal(h.options().modelRuntime, undefined);
    assert.equal(result.services.settingsManager, h.options().settingsManager);
    assert.equal(h.loader().settingsManager, h.options().settingsManager);
    assert.deepEqual(h.options().settingsManager.isolated, { compaction: { enabled: false }, retry: { enabled: false } });
    assert.match(handlers.before_agent_start({ systemPrompt: 'base' }).systemPrompt, /Current memory/);
    await result.services.resourceLoader.reload(); result.services.assertMainInvariants();
    for (const names of [[], ['client', 'bash']]) {
      h.session.getActiveToolNames = () => names;
      assert.throws(() => result.services.assertMainInvariants(), /missing|re-enabled/);
    }
    h.session.getActiveToolNames = () => ['client']; h.session.model.id = 'wrong';
    assert.throws(() => result.services.assertMainInvariants(), /binding changed/);
    const disposal = t.mock.method(h.session, 'dispose');
    await assert.rejects(openConversation({ root: h.root, config: h.config, file: join(h.root, 'sessions', 'main.jsonl') }, h.dependencies), /binding changed/);
    assert.equal(disposal.mock.callCount(), 1);
  }
});

test('child SDK model storage stays in the selected Pi directory without serializing credentials', async t => {
  const h = await fixture(t), loadSdk = h.dependencies.loadSdk, createSession = h.dependencies.createSession;
  let storage;
  h.dependencies.createSession = undefined;
  h.dependencies.loadSdk = async () => ({ ...await loadSdk(), createAgentSession: createSession,
    ModelRuntime: { create: async options => { storage = options; return { getAvailableSnapshot: () => [] }; } } });
  h.dependencies.rpcBridge = {};
  h.dependencies.deferExtensionBinding = true;
  const { openConversation } = await import('../src/cli/pi-session.mjs');
  await openConversation({ root: h.root, config: h.config, file: join(h.root, 'sessions', 'main.jsonl') }, h.dependencies);
  assert.deepEqual(storage, { allowModelNetwork: false, authPath: join(h.dependencies.agentDir, 'auth.json'), modelsPath: join(h.dependencies.agentDir, 'models.json') });
  assert.equal(h.options().agentDir, h.dependencies.agentDir);
});

test('deferred SDK binding returns its services and binds native hooks exactly once', async t => {
  const h = await fixture(t);
  let bindings = 0;
  h.session.bindExtensions = async options => { bindings++; assert.equal(options.mode, 'rpc'); };
  h.dependencies.deferExtensionBinding = true;
  const result = await h.open();
  assert.equal(bindings, 0, 'SDK setup must not bind before native RPC supplies its hooks');
  assert.equal(result.session, h.session);
  assert.equal(result.services.cwd, h.root);
  assert.equal(result.services.settingsManager, h.options().settingsManager);
  assert.equal(result.services.resourceLoader, h.options().resourceLoader);
  await result.session.bindExtensions({ mode: 'rpc' });
  await assert.rejects(result.session.bindExtensions({ mode: 'rpc' }), /already bound/);
  assert.equal(bindings, 1);
});

for (const [scriptedMain, missingAtBind] of [[false, false], [true, false], [true, true]]) test(`missing-client validation: scripted=${scriptedMain}, initial=${missingAtBind}`, async t => {
  const h = await fixture(t), clientPath = join(h.root, 'client.mjs'), loadSdk = h.dependencies.loadSdk;
  writeFileSync(clientPath, 'fixture');
  let missingClient = false;
  h.dependencies.loadSdk = async () => {
    const sdk = await loadSdk(), ResourceLoader = sdk.DefaultResourceLoader;
    sdk.DefaultResourceLoader = class extends ResourceLoader {
      getExtensions() {
        const loaded = super.getExtensions();
        return missingClient ? { ...loaded, extensions: loaded.extensions.filter(item => item.path !== clientPath) } : loaded;
      }
    };
    return sdk;
  };
  h.dependencies.rpcBridge = { clientExtensionPath: clientPath };
  h.dependencies.deferExtensionBinding = true;
  h.dependencies.scriptedMain = scriptedMain;
  if (scriptedMain) h.session.model = { provider: 'hobkin-client', id: 'scripted' };
  const { openConversation } = await import('../src/cli/pi-session.mjs');
  const result = await openConversation({ root: h.root, config: h.config, file: join(h.root, 'sessions', 'main.jsonl') }, h.dependencies);
  if (missingAtBind) { missingClient = true; await assert.rejects(result.session.bindExtensions({ mode: 'rpc' }), /client extension is unavailable/); return; }
  await result.session.bindExtensions({ mode: 'rpc' });
  await result.services.resourceLoader.reload();
  assert.doesNotThrow(() => result.services.assertMainInvariants());
  missingClient = true;
  await result.services.resourceLoader.reload();
  assert.throws(() => result.services.assertMainInvariants(), /client extension is unavailable/);
});

test('deferred readiness validates the tool set after native binding', async t => {
  const h = await fixture(t);
  h.dependencies.deferExtensionBinding = true;
  h.session.bindExtensions = async () => { h.session.getActiveToolNames = () => ['unselected']; };
  const result = await h.open();
  assert.equal(result.session, h.session);
  await assert.rejects(result.session.bindExtensions({ mode: 'rpc' }), /missing|re-enabled/);
});

test('unopted entry retains its injected SDK session even with recovery requested', async t => {
  const h = await fixture(t);
  Object.assign(h.dependencies, { recoverScriptedHistory: true, modelRuntime: {} });
  assert.equal(await h.open(), h.session);
});

for (const [type, provider, explicit, recovery] of [
  ['model_change', 'hobkin-client', false, true], ['message', 'hobkin-client', false, true],
  ['model_change', 'real', false, true], ['message', 'real', false, true], [null, null, false, true],
  ['model_change', 'hobkin-client', true, true], ['model_change', 'hobkin-client', false, false],
  ['model_change', 'hobkin-client', false, 'unavailable'],
]) test(`child history recovery: ${type}/${provider}, explicit=${explicit}, recovery=${recovery}`, async t => {
  const h = await fixture(t), loadSdk = h.dependencies.loadSdk, createSession = h.dependencies.createSession;
  const model = { provider: 'fixture', id: 'chosen' }, shouldPick = type && provider === 'hobkin-client' && !explicit && recovery !== false;
  const branch = type ? [{ type: 'model_change', provider: provider === 'hobkin-client' ? 'real' : 'hobkin-client' },
    type === 'message' ? { type, message: { role: 'assistant', provider } } : { type, provider }, { type: 'message', message: { role: 'user' } }] : [];
  let picks = 0;
  h.config.main.model = explicit ? 'fixture/chosen' : null; h.session.model = model;
  Object.assign(h.dependencies, { modelRuntime: {}, rpcBridge: {}, recoverScriptedHistory: recovery !== false,
    pickModel: async () => { assert.ok(shouldPick); picks++; return recovery === 'unavailable' ? undefined : model; } });
  h.dependencies.loadSdk = async () => ({ ...await loadSdk(),
    SessionManager: { open: () => ({ getSessionId: () => 'fake', getBranch: () => branch }) }, resolveCliModel: () => ({ model }) });
  h.dependencies.createSession = async options => ({ ...await createSession(options),
    modelFallbackMessage: !options.model && type ? 'fixture unavailable history' : undefined });
  const { openConversation } = await import('../src/cli/pi-session.mjs');
  const opening = openConversation({ root: h.root, config: h.config, file: join(h.root, 'sessions', 'main.jsonl') }, h.dependencies);
  if (type && !explicit && (!shouldPick || recovery === 'unavailable')) await assert.rejects(opening, /unavailable history/);
  else await opening;
  assert.equal(picks, shouldPick ? 1 : 0);
  assert.equal(h.options().model, explicit || (shouldPick && recovery !== 'unavailable') ? model : undefined);
});

test('scripted SDK setup refuses before loader or factory entry', async t => {
  const h = await fixture(t), { openConversation } = await import('../src/cli/pi-session.mjs');
  const rpcBridge = { clientExtensionPath: join(h.root, 'client.mjs') }; writeFileSync(rpcBridge.clientExtensionPath, 'fixture');
  for (const invalid of [{ createSession: undefined }, { deferExtensionBinding: false }, { deferExtensionBinding: 'true' }, { rpcBridge: {} }, { rpcBridge: { clientExtensionPath: h.root } }]) {
    await assert.rejects(openConversation({ root: h.root, config: h.config, file: join(h.root, 'sessions', 'main.jsonl') }, {
      ...h.dependencies, scriptedMain: true, rpcBridge, deferExtensionBinding: true, ...invalid,
      loadSdk: () => assert.fail('loader entered for invalid scripted setup'),
    }), /Scripted main/);
  }
});

test('unsupported or stale resource selections refuse before SDK loading', async t => {
  const h = await fixture(t);
  h.config.resourceSelection = { version: 1, purposes: { main: { mcp: ['mcp.example'] } } };
  h.dependencies.loadSdk = () => { throw Error('SDK must not load'); };
  await assert.rejects(h.open(), /stale|unavailable|unsupported/i);
});
