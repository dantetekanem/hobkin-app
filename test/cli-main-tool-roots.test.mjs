import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import { initialize } from '../src/cli/config.mjs';
import { closePiSession, openConversation, openPiSession } from '../src/cli/pi-session.mjs';
import { HOBKIN_BRIDGE_TOOLS } from '../src/cli/hobkin-extension.mjs';
import { integrationOffer } from '../src/cli/integrations.mjs';
import { createSettingsTool, createStopWorkloadTool } from '../src/cli/hobkin-tools.mjs';
import { createActionItemTool } from '../src/cli/action-item-tool.mjs';
import { createOwnedAgentSessionTool } from '../src/cli/owned-agent-tool.mjs';
import { isolatePiHome } from './helpers/pi-session.mjs';

// Gemini refuses a whole request when one tool's parameters have anything but one object at the root, such as the anyOf
// a union of objects gives. Real Pi sessions on a synthetic provider that is never called.
const model = {
  id: 'local', name: 'Synthetic', provider: 'fixture', api: 'openai-completions', baseUrl: 'https://provider.invalid', reasoning: true,
  input: ['text'], contextWindow: 32000, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

async function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-tool-roots-')));
  const agentDir = join(root, 'agent');
  isolatePiHome(t, agentDir);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const modelRuntime = await ModelRuntime.create({
    authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), allowModelNetwork: false, refreshOnCreate: false,
  });
  const { provider, ...entry } = model;
  modelRuntime.registerProvider(provider, {
    name: 'Synthetic', api: model.api, baseUrl: model.baseUrl, apiKey: 'synthetic', models: [entry],
    streamSimple: () => { throw Error('No provider is called in this test.'); },
  });
  const createSession = options => createAgentSession({
    ...options, modelRuntime, model, agentDir, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
  });
  return { root, config: initialize(root, { cwd: root }), agentDir, modelRuntime, createSession };
}

const COMBINATORS = ['anyOf', 'oneOf', 'allOf'];
const notOneObject = session => session.agent.state.tools
  .filter(({ parameters }) => parameters?.type !== 'object' || COMBINATORS.some(key => Object.hasOwn(parameters, key)))
  .map(tool => tool.name);

test('every tool the main session child gives the model has one object at its parameters root', async t => {
  const h = await home(t);
  const notes = { name: 'notes_add', description: 'Adds a note.', parameters: { type: 'object', properties: { text: { type: 'string' } } }, agents: ['main'] };
  const session = await openConversation({ root: h.root, config: h.config, file: join(h.root, 'sessions', 'main.jsonl'), fresh: true }, {
    agentDir: h.agentDir, modelRuntime: h.modelRuntime, createSession: h.createSession,
    rpcBridge: { integrations: integrationOffer({ tools: () => [notes] }, 'main') },
  });
  t.after(() => closePiSession(session));
  const names = session.agent.state.tools.map(tool => tool.name);
  for (const name of ['read', 'bash', 'codemode', 'tool_search', ...HOBKIN_BRIDGE_TOOLS, 'notes_add']) assert.ok(names.includes(name), `${name} is given`);
  assert.deepEqual(notOneObject(session), []);
});

test('every tool the main session in this process gives the model has one object at its parameters root', async t => {
  const h = await home(t);
  const session = await openPiSession({ root: h.root, config: h.config }, { agentDir: h.agentDir, modelRuntime: h.modelRuntime, createSession: h.createSession });
  t.after(() => closePiSession(session));
  const names = session.agent.state.tools.map(tool => tool.name);
  for (const name of HOBKIN_BRIDGE_TOOLS.filter(name => name !== 'load_skill')) assert.ok(names.includes(name), `${name} is given`);
  assert.deepEqual(notOneObject(session), []);
});

// Each tool has no host here, so a request its checks let through ends at "unavailable".
const tools = {
  model_settings: createSettingsTool(),
  stop_workload: createStopWorkloadTool(),
  hobkin_action_items: createActionItemTool(),
  owned_agent: createOwnedAgentSessionTool(),
};
const cases = {
  model_settings: {
    allowed: [{ action: 'inspect', scope: 'main' }, { action: 'inspect', scope: 'routines', routineId: 'daily-check' },
      { action: 'update', scope: 'all', model: 'fixture/next', effort: 'high' }, { action: 'update', scope: 'background' }],
    refused: [
      [{ action: 'inspect' }, /Invalid model settings request\. The inspect action needs scope\./],
      [{ action: 'update', model: 'fixture/next' }, /The update action needs scope\./],
      [{ action: 'inspect', scope: 'main', model: 'fixture/next', effort: 'high' }, /The inspect action does not take model or effort\./],
      [{ action: 'update', scope: 'everything' }, /^Invalid model settings request\.$/],
      [{ action: 'update', scope: 'main', model: 'ab' }, /^Invalid model settings request\.$/],
      [{ action: 'inspect', scope: 'main', routineId: 'Bad id' }, /^Invalid model settings request\.$/],
      [{ action: 'inspect', scope: 'main', other: 1 }, /^Invalid model settings request\.$/],
      [{ action: 'reset', scope: 'main' }, /^Invalid model settings request\.$/],
    ],
  },
  stop_workload: {
    allowed: [{ action: 'list' }, { action: 'stop', id: 'work:abc', reason: 'The user asked.' }],
    refused: [
      [{ action: 'stop', id: 'work:abc' }, /Invalid workload Stop request\. The stop action needs reason\./],
      [{ action: 'stop' }, /The stop action needs id and reason\./],
      [{ action: 'list', id: 'work:abc', reason: 'x' }, /The list action does not take id or reason\./],
      [{ action: 'stop', id: 'abc', reason: 'x' }, /^Invalid workload Stop request\.$/],
      [{ action: 'stop', id: 'work:abc', reason: ' ' }, /^Invalid workload Stop request\.$/],
      [{ action: 'stop', id: 'work:abc', reason: 'x'.repeat(201) }, /^Invalid workload Stop request\.$/],
      [{ action: 'list', pid: 12 }, /^Invalid workload Stop request\.$/],
    ],
  },
  hobkin_action_items: {
    allowed: [{ action: 'list' }, { action: 'dismiss', id: 'item-1' }, { action: 'dismiss_all' }],
    refused: [
      [{ action: 'dismiss' }, /Invalid Action Item request\. The dismiss action needs id\./],
      [{ action: 'dismiss_all', id: 'item-1' }, /The dismiss_all action does not take id\./],
      [{ action: 'list', id: 'item-1' }, /The list action does not take id\./],
      [{ action: 'dismiss', id: '   ' }, /Choose list, dismiss with an exact id, or dismiss_all\./],
      [{ action: 'dismiss', id: 'x'.repeat(513) }, /Choose list/],
      [{ action: 'list', all: true }, /Choose list/],
    ],
  },
  owned_agent: {
    allowed: [{ action: 'spawn', name: 'helper' }, { action: 'spawn', name: 'helper', allowHelpers: false }, { action: 'list' },
      { action: 'status', id: 'child-1' }, { action: 'cancel', id: 'child-1' }],
    refused: [
      [{ action: 'spawn' }, /Invalid owned-agent request\. The spawn action needs name\./],
      [{ action: 'status' }, /The status action needs id\./],
      [{ action: 'cancel', id: 'child-1', name: 'helper' }, /The cancel action does not take name\./],
      [{ action: 'list', allowHelpers: true }, /The list action does not take allowHelpers\./],
      [{ action: 'spawn', name: 'helper', id: 'child-1' }, /The spawn action does not take id\./],
      [{ action: 'spawn', name: ' ' }, /^Invalid owned-agent request$/],
      [{ action: 'status', id: '' }, /^Invalid owned-agent request$/],
      [{ action: 'spawn', name: 'helper', parentId: 'forged' }, /^Invalid owned-agent request$/],
    ],
  },
};

for (const [name, { allowed, refused }] of Object.entries(cases)) {
  test(`${name} keeps each action's own fields and says which one is missing or extra`, async () => {
    const tool = tools[name];
    assert.equal(tool.parameters.type, 'object');
    assert.equal(tool.parameters.additionalProperties, false);
    for (const request of allowed) await assert.rejects(tool.execute('call', request), /unavailable/i, JSON.stringify(request));
    for (const [request, words] of refused) await assert.rejects(tool.execute('call', request), { message: words }, JSON.stringify(request));
  });
}
