import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(t) {
  // Refuse before importing/opening if an SDK boundary could fall back to the real loader.
  const source = readFileSync(new URL('../src/cli/pi-session.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('} = await loadSdk();'));
  const refuse = () => { throw Error('Real SDK/provider/network execution forbidden'); };
  t.mock.method(globalThis, 'fetch', refuse);
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
  assert.deepEqual(loader.additionalExtensionPaths, ['builtin:codemode', 'builtin:tool-search']);
  assert.deepEqual(loader.additionalSkillPaths, []);
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
  assert.deepEqual(loader.additionalExtensionPaths, ['builtin:codemode', 'builtin:tool-search', join(h.root, 'extensions.md')]);
  assert.deepEqual(loader.additionalSkillPaths, [join(h.root, 'skills.md')]);
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

test('unsupported or stale resource selections refuse before SDK loading', async t => {
  const h = await fixture(t);
  h.config.resourceSelection = { version: 1, purposes: { main: { mcp: ['mcp.example'] } } };
  h.dependencies.loadSdk = () => { throw Error('SDK must not load'); };
  await assert.rejects(h.open(), /stale|unavailable|unsupported/i);
});
