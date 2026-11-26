import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-provider-')));
process.env.PI_CODING_AGENT_DIR = join(directory, 'pi');
process.env.PI_OFFLINE = '1';
mkdirSync(process.env.PI_CODING_AGENT_DIR);
const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
const { initialize, validateConfig } = await import('../src/cli/config.mjs');
const { openConversation, openPiSession, closePiSession } = await import('../src/cli/pi-session.mjs');
const { runModelSettings } = await import('../src/cli/model-settings.mjs');
const { buildInvocation } = await import('../src/cli/harnesses.mjs');
const { default: registerSelectedProvider, loadProviderExtensions, providerExtensionBinding } = await import('../src/cli/provider-extensions.mjs');

const entry = join(directory, 'provider.mjs');
writeFileSync(entry, `export default function(pi) {
  pi.registerProvider('fixture', {
    baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'fixture-only',
    models: [{ id: 'chat', name: 'Fixture chat', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 }]
  });
  pi.registerTool({ name: 'not_a_hobkin_tool', label: 'not a tool', description: 'not a tool', parameters: {}, execute() {} });
  pi.on('session_start', () => { throw Error('Provider hooks must not run in the main conversation'); });
}`);
const selection = { fixture: entry };
const modelRuntime = () => ModelRuntime.create({ authPath: join(directory, 'auth.json'), modelsPath: null,
  modelsStorePath: join(directory, 'models-store.json'), allowModelNetwork: false });

test.after(() => rmSync(directory, { recursive: true, force: true }));

test('only explicitly selected provider registration enters the catalog, without inherited extensions', async () => {
  const runtime = await modelRuntime();
  const extensions = join(process.env.PI_CODING_AGENT_DIR, 'extensions');
  mkdirSync(extensions);
  writeFileSync(join(extensions, 'unselected.mjs'), `throw Error('unselected extension loaded')`);
  assert.equal(runtime.getModel('fixture', 'chat'), undefined);
  await loadProviderExtensions(runtime, undefined, { cwd: directory });
  assert.equal(runtime.getModel('fixture', 'chat'), undefined);
  await loadProviderExtensions(runtime, selection, { cwd: directory });
  assert.ok(runtime.getModel('fixture', 'chat'));
  assert.ok((await runtime.getAvailable()).some(model => model.provider === 'fixture' && model.id === 'chat'));
  assert.equal(runtime.hasConfiguredAuth('fixture'), true);
});

test('an opted-in provider is resolved before main model binding without adding its tools or hooks', async () => {
  const root = join(directory, 'home');
  const config = initialize(root, { cwd: root });
  config.providerExtensions = selection;
  config.main = { cwd: root, model: 'fixture/chat', effort: 'off' };
  const runtime = await modelRuntime();
  const session = await openConversation({ root, config, file: join(root, 'sessions', 'main.jsonl') }, { modelRuntime: runtime });
  try {
    assert.equal(`${session.model.provider}/${session.model.id}`, 'fixture/chat');
    assert.equal(session.thinkingLevel, 'off');
    assert.ok(!session.getActiveToolNames().includes('not_a_hobkin_tool'));
    assert.ok((await session.modelRuntime.getAvailable()).some(model => model.provider === 'fixture' && model.id === 'chat'));
  } finally { await closePiSession(session); }
});

test('the isolated main child accepts the provider choice and model_settings inspects its actual catalog', async () => {
  const root = join(directory, 'child');
  const config = initialize(root, { cwd: root });
  config.providerExtensions = selection;
  config.main = { cwd: root, model: 'fixture/chat', effort: 'off' };
  const session = await openPiSession({ root, config }, { agentDir: process.env.PI_CODING_AGENT_DIR });
  try {
    assert.deepEqual(await session.binding(), { model: 'fixture/chat', effort: 'off' });
    const settings = await runModelSettings({ root, config, request: { action: 'inspect', scope: 'all' },
      binding: () => session.binding(), modelRuntime: () => session.modelCatalog() });
    assert.ok(settings.availableModels.includes('fixture/chat'));
    assert.deepEqual(settings.activeMainBinding, { model: 'fixture/chat', effort: 'off' });
  } finally { await closePiSession(session); }
});

test('a tool-free Pi run loads only its opted-in provider, and launchers remain in charge', () => {
  const request = { id: '00000000-0000-4000-8000-000000000000', harness: 'pi', purpose: 'reflection',
    cwd: directory, sessionFile: join(directory, 'job.jsonl'), prompt: 'fixture', effort: 'off', model: 'fixture/chat', providerExtensions: selection };
  const explicit = args => args.flatMap((arg, index) => arg === '--extension' ? [args[index + 1]] : []);
  const { args } = buildInvocation(request);
  const binding = providerExtensionBinding(selection, request.model);
  assert.ok(args.includes('--no-tools') && args.includes('--no-extensions'));
  assert.deepEqual(explicit(args), [binding.args[1]]);
  assert.notEqual(binding.args[1], entry);
  assert.deepEqual(explicit(buildInvocation({ ...request, model: 'other/chat' }).args), []);
  assert.deepEqual(explicit(buildInvocation({ ...request, launcher: { command: ['company-pi'] } }).args), []);
  const toolRun = { ...request, purpose: undefined, extensions: [entry] };
  assert.deepEqual(explicit(buildInvocation(toolRun).args), [entry]);
});

test('the CLI adapter forwards only the selected model provider registration and not tools or hooks', async () => {
  const binding = providerExtensionBinding(selection, 'fixture/chat');
  Object.assign(process.env, binding.env);
  try {
    const registered = [];
    await registerSelectedProvider({ registerProvider: (name, config) => registered.push({ name, config }) });
    assert.deepEqual(registered.map(({ name }) => name), ['fixture']);
    assert.equal(registered[0].config.models[0].id, 'chat');
  } finally { for (const key of Object.keys(binding.env)) delete process.env[key]; }
});

test('provider selection requires explicit absolute files and never adds one to other model bindings', async () => {
  const config = initialize(join(directory, 'config'), { cwd: directory });
  for (const providerExtensions of [[], { fixture: 'npm:some-package' }, { fixture: 17 }, { 'fixture/chat': entry }]) {
    assert.throws(() => validateConfig({ ...config, providerExtensions }), /provider extension/i);
  }
  assert.equal(providerExtensionBinding(selection, 'fixture/chat').args[0], '--extension');
  assert.deepEqual(providerExtensionBinding(selection, 'another/chat'), { args: [], env: {} });
  assert.deepEqual(providerExtensionBinding(undefined, 'fixture/chat'), { args: [], env: {} });
  await assert.rejects(loadProviderExtensions(await modelRuntime(), { wrong: entry }, { cwd: directory }), /wrong/);
});
