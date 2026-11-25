import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { BRIDGE, callBridge, serveBridge } from '../src/cli/bridge.mjs';
import { readDecided } from '../src/cli/decided.mjs';
import { createCheckMessageTool, createScheduleTool, createSettingsTool, createStopWorkloadTool } from '../src/cli/hobkin-tools.mjs';
import hobkin from '../src/cli/hobkin-extension.mjs';
import { createMemoryTool, readMemory } from '../src/cli/memory.mjs';
import { createQuestionTool } from '../src/cli/questions.mjs';
import { createOwnedAgentSessionTool } from '../src/cli/owned-agent-tool.mjs';
import { createAgentScheduleTool, createAgentSchedulesTool } from '../src/cli/schedule-tools.mjs';
import { createRecallTool, createRememberTool } from '../src/cli/memory-tools.mjs';
import { createActionItemTool } from '../src/cli/action-item-tool.mjs';
import { initialize } from '../src/cli/config.mjs';
import { fileDecision, openDecisions } from '../src/cli/decisions.mjs';
import { readActionDecisions } from '../src/cli/pending-read.mjs';
import { recordCardAction } from '../src/cli/work/card-actions.mjs';
import { isolatePiHome } from './helpers/pi-session.mjs';

const model = {
  id: 'local',
  name: 'Synthetic',
  provider: 'fixture',
  api: 'openai-completions',
  baseUrl: 'https://invalid.test',
  reasoning: true,
  input: ['text'],
  contextWindow: 32000,
  maxTokens: 2048,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const question = {
  question: 'What should happen?',
  choices: [{ value: 'keep', label: 'Keep paused' }, { value: 'enable', label: 'Enable' }],
};

function scriptedModel(session, calls, requests = []) {
  let index = 0;
  session.agent.streamFunction = (_model, context) => {
    requests.push(JSON.stringify(context));
    const call = calls[index++];
    const message = {
      role: 'assistant',
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: call ? [{ type: 'toolCall', id: `call-${index}`, name: call.name, arguments: call.arguments }] : [{ type: 'text', text: 'Done.' }],
      stopReason: call ? 'toolUse' : 'stop',
      timestamp: Date.now(),
      usage: {
        input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: 'done', reason: message.stopReason, message });
      stream.end();
    });
    return stream;
  };
}

async function fixture(t, { mode = 'rpc' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-extension-'));
  initialize(root, { cwd: root });
  const agentDir = join(root, 'agent');
  isolatePiHome(t, agentDir);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const models = await ModelRuntime.create({
    authPath: join(root, 'auth.json'),
    modelsPath: null,
    modelsStorePath: join(root, 'models.json'),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  models.getModel = () => model;
  models.streamSimple = () => { throw Error('No provider call allowed'); };
  models.hasConfiguredAuth = () => false;
  models.checkAuth = async () => ({ available: true });
  const asked = [];
  const scheduled = [];
  const host = {
    tools: {
      ask_question: createQuestionTool(async (request, signal) => {
        asked.push({ request, signal });
        return 'enable';
      }),
      run_routine: createScheduleTool(async (scheduleId, id) => {
        scheduled.push({ scheduleId, id });
        return { status: 'admitted', scheduleId };
      }),
      stop_workload: createStopWorkloadTool(async request => ({ action: request.action, running: [] })),
      message_check: createCheckMessageTool(async ({ scheduleId }) => ({ scheduleId, status: 'delivered' })),
      hobkin_memory: createMemoryTool(root),
      model_settings: createSettingsTool(async request => ({ action: request.action, scope: request.scope })),
      hobkin_action_items: createActionItemTool(root),
    },
    memory: () => readMemory(root),
    directions: () => 'Keep reports short.',
    decided: () => readDecided(root),
  };
  const statuses = [];
  const dialogs = [];
  const ui = new Proxy({
    setStatus: (key, text) => statuses.push({ key, text }),
    input: async (title, placeholder, options) => {
      dialogs.push({ title, placeholder });
      if (options?.signal?.aborted) return undefined;
      return JSON.stringify(await serveBridge(placeholder, host, options?.signal));
    },
  }, { get: (target, name) => (name in target ? target[name] : () => undefined) });
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd: root, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [hobkin],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: root, agentDir, sessionManager: SessionManager.inMemory(root), resourceLoader, settingsManager, modelRuntime: models, model,
  });
  t.after(() => session.dispose());
  await session.bindExtensions({ uiContext: ui, mode });
  return { root, session, statuses, dialogs, asked, scheduled };
}

const toolResults = session => session.messages.filter(message => message.role === 'toolResult');

test('Pi registers the Hobkin tools with their ordinary definitions and reports them on start', async t => {
  const { session, statuses } = await fixture(t);
  const originals = [createQuestionTool(), createScheduleTool(), createCheckMessageTool(), createMemoryTool(), createSettingsTool(), createStopWorkloadTool(), createAgentScheduleTool(), createAgentSchedulesTool(), createRecallTool(), createRememberTool(), createActionItemTool(), createOwnedAgentSessionTool()];
  const registered = session.agent.state.tools;
  for (const tool of originals) {
    const found = registered.find(item => item.name === tool.name);
    assert.ok(found, `${tool.name} is a real agent tool`);
    assert.equal(found.description, tool.description);
    assert.deepEqual(found.parameters, tool.parameters);
    assert.ok(session.getActiveToolNames().includes(tool.name));
  }
  assert.deepEqual(statuses.map(status => status.key), [BRIDGE]);
  assert.deepEqual(JSON.parse(statuses[0].text), { version: 1, tools: originals.map(tool => tool.name) });
});

test('a tool the model calls runs in the host through the input dialog and its result returns unchanged', async t => {
  const { session, dialogs, asked, scheduled, root } = await fixture(t);
  scriptedModel(session, [
    { name: 'ask_question', arguments: question },
    { name: 'run_routine', arguments: { routineId: 'daily-check' } },
    { name: 'hobkin_memory', arguments: { action: 'add', text: 'Rent is due November 1' } },
    { name: 'model_settings', arguments: { action: 'inspect', scope: 'main' } },
    { name: 'message_check', arguments: { routineId: 'daily-check', message: 'Hurry.' } },
  ]);
  await session.prompt('Use every Hobkin tool.', { preflightResult() {} });

  const results = toolResults(session);
  assert.equal(results.length, 5);
  assert.deepEqual(JSON.parse(results[0].content[0].text), { status: 'answered', answer: question.choices[1] });
  assert.deepEqual(JSON.parse(results[1].content[0].text), { status: 'admitted', routineId: 'daily-check' });
  assert.match(results[2].content[0].text, /Memory holds 1 of 20 items\.\n- Rent is due November 1/);
  assert.deepEqual(JSON.parse(results[3].content[0].text), { action: 'inspect', scope: 'main' });
  assert.deepEqual(JSON.parse(results[4].content[0].text), { routineId: 'daily-check', status: 'delivered' });
  assert.ok(results.every(result => result.isError !== true));
  assert.deepEqual(asked.map(item => item.request), [{ ...question, other: true }]);
  assert.deepEqual(scheduled, [{ scheduleId: 'daily-check', id: 'call-2' }]);
  assert.ok(dialogs.filter(dialog => dialog.title === BRIDGE).length >= 4);
  assert.equal(readMemory(root)[0], 'Rent is due November 1');
});

test('main workload Stop uses the same definition through the extension bridge', async t => {
  const { session } = await fixture(t);
  scriptedModel(session, [{ name: 'stop_workload', arguments: { action: 'list' } }]);
  await session.prompt('List owned parents.', { preflightResult() {} });
  assert.deepEqual(toolResults(session)[0].details, { action: 'list', running: [] });
});

test('a host error becomes an ordinary failed tool result, and an aborted call is cancelled', async t => {
  const { session, dialogs } = await fixture(t);
  // Pi's own schema check passes; the host's tool rejects the repeated choice.
  scriptedModel(session, [{ name: 'ask_question', arguments: { question: 'Twice', choices: [question.choices[0], question.choices[0]] } }]);
  await session.prompt('Ask a malformed question.', { preflightResult() {} });
  const [failed] = toolResults(session);
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /Invalid question/);

  const abort = new AbortController();
  abort.abort();
  const tool = session.agent.state.tools.find(item => item.name === 'run_routine');
  await assert.rejects(tool.execute('late', { routineId: 'daily-check' }, abort.signal, undefined, { mode: 'rpc', ui: { input: async () => undefined } }), /Cancelled/);
  assert.ok(dialogs.length > 0);
});

test('the current memory is added to every turn’s system prompt through the host, so a change applies at once', async t => {
  const { session, root } = await fixture(t);
  const requests = [];
  scriptedModel(session, [], requests);
  writeFileSync(join(root, 'memory.md'), '- Rent is due November 1\n');
  await session.prompt('First.', { preflightResult() {} });
  assert.match(requests[0], /## Current memory\\n\\n- Rent is due November 1/);
  writeFileSync(join(root, 'memory.md'), '');
  await session.prompt('Second.', { preflightResult() {} });
  assert.match(requests.at(-1), /## Current memory\\n\\nMemory is empty\./);
});

test('what the user decided lately ends every turn’s system prompt through the host, so a new answer applies at once', async t => {
  const { session, root } = await fixture(t);
  const requests = [];
  scriptedModel(session, [], requests);
  await session.prompt('First.', { preflightResult() {} });
  assert.match(requests[0], /## What the user decided lately\\n\\n.+\\n\\nNothing in the last 14 days\./);

  recordCardAction(root, {
    did: 'said no',
    project: 'api',
    item: 'item-7f3a',
    title: 'Fix the login timeout',
    line: 'Said no to "Fix the login timeout" on api.',
  });
  await session.prompt('Second.', { preflightResult() {} });
  const part = requests.at(-1).slice(requests.at(-1).indexOf('## What the user decided lately'));
  assert.match(part, /for \\"Fix the login timeout\\" on api, they said no\./);
  assert.ok(!part.includes('item-7f3a'));
});

test('registered Action Item tool dismisses exact IDs without answering decisions and preserves arrivals', async t => {
  const { session, root, asked, scheduled } = await fixture(t);
  const first = fileDecision(root, question);
  async function invoke(arguments_) {
    const before = toolResults(session).length;
    scriptedModel(session, [{ name: 'hobkin_action_items', arguments: arguments_ }]);
    await session.prompt('Manage Action Items.', { preflightResult() {} });
    return toolResults(session)[before];
  }
  const listed = (await invoke({ action: 'list' })).details;
  assert.deepEqual(listed, { total: 1, items: [{ id: first.id, group: 'question', title: question.question }] });
  const { id } = listed.items[0];
  const later = fileDecision(root, { ...question, question: 'New arrival?' });

  assert.deepEqual((await invoke({ action: 'dismiss', id })).details, { dismissed: 1, remaining: 1 });
  assert.deepEqual((await invoke({ action: 'dismiss', id })).details, { dismissed: 0, remaining: 1 });
  assert.deepEqual(readActionDecisions(root).map(decision => decision.id), [later.id]);
  assert.deepEqual((await invoke({ action: 'dismiss_all' })).details, { dismissed: 1, remaining: 0 });
  assert.deepEqual((await invoke({ action: 'dismiss_all' })).details, { dismissed: 0, remaining: 0 });
  assert.deepEqual(readActionDecisions(root), []);

  fileDecision(root, { ...question, question: 'After dismissal?' });
  assert.equal((await invoke({ action: 'list' })).details.total, 1);
  assert.equal(openDecisions(root).length, 3);
  assert.ok(openDecisions(root).some(item => item.id === first.id));
  assert.deepEqual(asked, []);
  assert.deepEqual(scheduled, []);
  for (const request of [{}, { action: 'dismiss' }, { action: 'dismiss', id: '' }, { action: 'dismiss_all', id }, { action: 'list', all: true }, { action: 'dismiss', id, all: true }]) {
    assert.equal((await invoke(request)).isError, true, JSON.stringify(request));
  }
  assert.equal((await invoke({ action: 'list' })).details.total, 1);
});

test('outside an RPC host the tools refuse to ask anyone, and a missing answer is an error', async () => {
  await assert.rejects(callBridge({ mode: 'tui', ui: { input: async () => '{}' } }, { op: 'memory' }), /only under a Hobkin host/);
  await assert.rejects(callBridge({ mode: 'rpc', ui: { input: async () => undefined } }, { op: 'memory' }), /did not answer/);
  await assert.rejects(callBridge({ mode: 'rpc', ui: { input: async () => '{"ok":false,"error":"Nope."}' } }, { op: 'memory' }), /Nope\./);
  assert.deepEqual(await callBridge({ mode: 'rpc', ui: { input: async () => '{"ok":true,"result":[1]}' } }, { op: 'memory' }), [1]);
});
