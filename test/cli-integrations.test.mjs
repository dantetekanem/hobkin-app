import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRIDGE } from '../src/cli/bridge.mjs';
import { namingExtensions, runHarness } from '../src/cli/harnesses.mjs';
import { INTEGRATIONS_ENV, createIntegrationExtension, integrationExtension, readOffer } from '../src/cli/integration-extension.mjs';
import { integrationEnvironment, integrationOffer, MAIN_AGENT, serveIntegration } from '../src/cli/integrations.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { isolatePiHome } from './helpers/pi-session.mjs';

const object = properties => ({ type: 'object', properties, additionalProperties: false });
const findPull = { name: 'github_find_pull', description: 'Finds a pull request by its words.', parameters: object({ words: { type: 'string' } }), agents: ['main', 'runs', 'durable'] };
const mainOnly = { name: 'notes_add', description: 'Adds a note.', parameters: object({ text: { type: 'string' } }), agents: ['main'] };
const anyAgent = { name: 'clock_now', description: 'Says the time.', parameters: object({}) };

/** The host side of the option: the tools it offers and what each call it ran was asked. */
function host(tools = [findPull, mainOnly, anyAgent], answer = (name, args) => ({ text: `${name} ran with ${JSON.stringify(args)}` })) {
  const calls = [];
  return {
    calls,
    tools: () => tools,
    async callTool(name, args, call, signal) {
      calls.push({ name, args, call, aborted: signal?.aborted ?? null });
      return answer(name, args, call);
    },
  };
}

test('each kind of agent is offered the tools that name it, a tool naming none goes to all three, and no option offers nothing', () => {
  const names = kind => integrationOffer(host(), kind)?.tools.map(tool => tool.name);
  assert.deepEqual(names('main'), ['github_find_pull', 'notes_add', 'clock_now']);
  assert.deepEqual(names('runs'), ['github_find_pull', 'clock_now']);
  assert.deepEqual(names('durable'), ['github_find_pull', 'clock_now']);
  assert.deepEqual(integrationOffer(host(), 'runs').tools[0], { name: 'github_find_pull', description: findPull.description, parameters: findPull.parameters });
  assert.equal(integrationOffer(undefined, 'main'), null);
  assert.equal(integrationOffer(host([]), 'main'), null);
  assert.equal(integrationOffer(host([mainOnly]), 'runs'), null);
  assert.equal(integrationOffer({ tools: () => { throw Error('broken'); } }, 'main'), null, 'a host whose list throws offers nothing');
  assert.deepEqual(integrationOffer(host(), 'runs', { only: ['notes_add'] }).tools.map(tool => tool.name), ['notes_add'], "a workflow's run gets the tools it names");
});

test("a tool that is not well formed, or would stand in for Pi's or hobkin's own, is left out", () => {
  const offered = integrationOffer(host([
    { ...anyAgent, name: 'bash' },
    { ...anyAgent, name: 'hobkin_memory' },
    { ...anyAgent, name: 'Bad Name' },
    { ...anyAgent, description: '' },
    { ...anyAgent, parameters: { type: 'string' } },
    anyAgent,
    { ...anyAgent, description: 'A second one by the same name.' },
  ]), 'main');
  assert.deepEqual(offered, { tools: [{ name: 'clock_now', description: anyAgent.description, parameters: anyAgent.parameters }] });
});

test('the offer travels in one environment variable that the extension reads back', () => {
  const offer = integrationOffer(host(), 'runs');
  assert.deepEqual(readOffer(integrationEnvironment(offer)), offer);
  assert.equal(readOffer({}), null);
  assert.equal(readOffer({ [INTEGRATIONS_ENV]: 'not json' }), null);
});

test('the bridge runs only a tool this agent was offered, as this agent, and gives back its text', async () => {
  const given = host();
  const offer = integrationOffer(given, 'runs');
  const served = { host: given, offer, agent: 'run-1' };
  const ask = request => serveIntegration(JSON.stringify({ op: 'integration_tool', id: 'call-1', ...request }), served);
  assert.deepEqual(await ask({ name: 'github_find_pull', params: { words: 'dark mode' } }),
    { ok: true, result: { text: 'github_find_pull ran with {"words":"dark mode"}', failed: false } });
  assert.deepEqual(given.calls.map(call => [call.name, call.call]), [['github_find_pull', { agent: 'run-1', id: 'call-1' }]]);
  assert.deepEqual(await ask({ name: 'notes_add', params: { text: 'x' } }), { ok: false, error: 'Invalid bridge request.' }, 'a tool offered to another kind');
  assert.deepEqual(await ask({ name: 'github_find_pull', params: 'words' }), { ok: false, error: 'Invalid bridge request.' });
  const failing = host([anyAgent], () => { throw Error('The clock is down.'); });
  assert.deepEqual(await serveIntegration(JSON.stringify({ op: 'integration_tool', id: 'c', name: 'clock_now', params: {} }), { host: failing, offer: integrationOffer(failing, 'main'), agent: MAIN_AGENT }),
    { ok: false, error: 'The clock is down.' });
});

/** A Pi extension API that keeps what was registered, and a context whose bridge reaches `serve`. */
function fakePi(serve) {
  const tools = new Map(), handlers = new Map();
  let active = ['read', 'bash'];
  const pi = {
    registerTool: tool => tools.set(tool.name, tool),
    on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    getActiveTools: () => active,
    setActiveTools: names => { active = names; },
  };
  const ctx = { mode: 'rpc', ui: { input: async (title, placeholder) => (title === BRIDGE ? JSON.stringify(await serve(placeholder)) : undefined) } };
  return { pi, tools, handlers, ctx, active: () => active };
}

test("each offered tool is one proxy whose call runs in the host and whose answer the agent reads; a failed one is a failed call", async () => {
  const given = host([findPull, anyAgent], name => (name === 'clock_now' ? { text: 'No clock here.', failed: true } : { text: 'Found #12.' }));
  const offer = integrationOffer(given, 'runs');
  const fake = fakePi(placeholder => serveIntegration(placeholder, { host: given, offer, agent: 'run-1' }));
  createIntegrationExtension(offer)(fake.pi);
  assert.deepEqual([...fake.tools.keys()], ['github_find_pull', 'clock_now']);
  assert.deepEqual(fake.tools.get('github_find_pull').parameters, findPull.parameters);
  for (const handler of fake.handlers.get('session_start')) handler({}, fake.ctx);
  assert.deepEqual(fake.active(), ['read', 'bash', 'github_find_pull', 'clock_now']);
  const read = await fake.tools.get('github_find_pull').execute('call-9', { words: 'x' }, undefined, undefined, fake.ctx);
  assert.deepEqual(read.content, [{ type: 'text', text: 'Found #12.' }]);
  await assert.rejects(fake.tools.get('clock_now').execute('call-10', {}, undefined, undefined, fake.ctx), /No clock here\./);
  assert.deepEqual(given.calls.map(call => call.call), [{ agent: 'run-1', id: 'call-9' }, { agent: 'run-1', id: 'call-10' }]);
});

test('with nothing offered the extension registers nothing and listens to nothing', () => {
  const fake = fakePi(() => null);
  createIntegrationExtension(null)(fake.pi);
  assert.equal(fake.tools.size, 0);
  assert.equal(fake.handlers.size, 0);
});

function job(t, extra = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'hobkin-integrations-run-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { id: '0c3f6d3e-8f43-4a7e-9f7e-2b1c0f6a9d11', harness: 'pi', cwd, model: null, effort: 'medium', prompt: 'Look.', sessionFile: join(cwd, 'job.jsonl'), ...extra };
}

test('a run or a durable hobkin offered tools loads the extension with its offer, and one offered nothing loads nothing new', async t => {
  const agentDir = mkdtempSync(join(tmpdir(), 'hobkin-agent-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true });
  });
  const started = [];
  const run = namingExtensions(async request => { started.push(request); });
  const offer = integrationOffer(host(), 'runs');
  await run(job(t), { integrations: { host: host(), offer, agent: 'run-1' } });
  await run(job(t, { purpose: 'durable' }), { integrations: { host: host(), offer, agent: 'hobkin:a:1' } });
  await run(job(t));
  await run(job(t), { integrations: { host: host(), offer: null, agent: 'run-2' } });
  const [offered, durable, plainRun, nothing] = started;
  for (const request of [offered, durable]) {
    assert.equal(request.extensions.includes(integrationExtension), true);
    assert.deepEqual(readOffer(request.env), offer);
  }
  for (const request of [plainRun, nothing]) {
    assert.equal(request.extensions.includes(integrationExtension), false);
    assert.equal(Object.hasOwn(request, 'env'), false);
  }
  assert.deepEqual(plainRun.extensions, nothing.extensions);
});

/** A fake Pi on RPC whose one turn calls a tool over its bridge, says what it read and settles. */
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
      send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Read: ' + (answer.ok ? answer.result.text : answer.error) }] } });
      send({ type: 'agent_settled' });
    } else if (cmd.type === 'prompt') {
      reply({ disposition: 'started' });
      send({ type: 'agent_start' });
      send({ type: 'extension_ui_request', id: 'integration', method: 'input', title: ${JSON.stringify(BRIDGE)},
        placeholder: JSON.stringify({ op: 'integration_tool', name: ${JSON.stringify(name)}, id: 'call-1', params: ${JSON.stringify(params)} }) });
    } else reply();
  }
});
`;
const fake = program => (_command, _args, options) => spawn(process.execPath, ['--input-type=module', '-e', program], options);

test("a run's call of an offered tool crosses its own pipe to the host, named as the run, and the agent reads the answer", { timeout: 10000 }, async t => {
  const given = host();
  const integrations = { host: given, offer: integrationOffer(given, 'runs'), agent: 'check:2026-11-24' };
  const done = await runHarness(job(t), { spawnProcess: fake(calling('github_find_pull', { words: 'flaky' })), integrations });
  assert.equal(done.text, 'Read: github_find_pull ran with {"words":"flaky"}');
  assert.deepEqual(given.calls.map(call => [call.name, call.call]), [['github_find_pull', { agent: 'check:2026-11-24', id: 'call-1' }]]);
  const without = await runHarness(job(t), { spawnProcess: fake(calling('github_find_pull', { words: 'flaky' })) });
  assert.equal(without.text, 'Read: The Hobkin host did not answer.', 'a run given no tools has its call declined');
  assert.equal(given.calls.length, 1);
});

/** Just enough of an application for `ownedHarness`: one running run, and what was handed to the harness it wraps. */
function owning(integrations, admission) {
  const handed = [];
  const app = Object.assign(Object.create(HobkinApplication.prototype), {
    integrations,
    runtime: {
      directory: '/nowhere',
      runIndex: async () => ({ runs: { [admission.id]: { ...admission, status: 'running' } } }),
      ownedLifecycle: { register: () => ({ cancel: async () => undefined, request: async () => ({}), join: async () => undefined }) },
      bindHarness: () => {},
      active: new Map(),
    },
    runTitle: async () => 'A run',
    memoryKeeper: () => undefined,
    memoryOwnerOf: () => undefined,
    scheduleHandler: () => undefined,
  });
  const wrapped = app.ownedHarness(async (request, options) => { handed.push({ request, options }); return { status: 'completed' }; });
  return { wrapped, handed };
}

test("the application hands each run and each durable hobkin's turn its own offer, named by its run, and nothing without the option", async () => {
  const given = host();
  const run = owning(given, { id: 'check:2026-11-24', harnessId: 'h-1' });
  await run.wrapped({ id: 'h-1', cwd: '/tmp' });
  assert.deepEqual(run.handed[0].options.integrations, { host: given, offer: integrationOffer(given, 'runs'), agent: 'check:2026-11-24' });
  const turn = owning(given, { id: 'hobkin:a:1', harnessId: 'h-2' });
  await turn.wrapped({ id: 'h-2', cwd: '/tmp', purpose: 'durable' });
  assert.deepEqual(turn.handed[0].options.integrations, { host: given, offer: integrationOffer(given, 'durable'), agent: 'hobkin:a:1' });
  const reflection = owning(given, { id: 'r-1', harnessId: 'h-3' });
  await reflection.wrapped({ id: 'h-3', cwd: '/tmp', purpose: 'reflection' });
  assert.equal(Object.hasOwn(reflection.handed[0].options, 'integrations'), false, 'a run with no tools is offered none');
  const none = owning(undefined, { id: 'check:2', harnessId: 'h-4' });
  await none.wrapped({ id: 'h-4', cwd: '/tmp' });
  assert.equal(Object.hasOwn(none.handed[0].options, 'integrations'), false);
});

const model = {
  id: 'local', name: 'Synthetic', provider: 'fixture', api: 'openai-completions', baseUrl: 'https://invalid.test', reasoning: true,
  input: ['text'], contextWindow: 32000, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/** A model that makes these tool calls, one per reply, then says it is done. */
function scriptedModel(session, calls) {
  let index = 0;
  session.agent.streamFunction = () => {
    const call = calls[index++];
    const message = {
      role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: call ? [{ type: 'toolCall', id: `call-${index}`, name: call.name, arguments: call.arguments }] : [{ type: 'text', text: 'Done.' }],
      stopReason: call ? 'toolUse' : 'stop',
      timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: 'done', reason: message.stopReason, message });
      stream.end();
    });
    return stream;
  };
}

/** Pi itself, with the extension made for this offer and a bridge that `serve` answers, as the host would. */
async function inPi(t, extensions, serve) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-integrations-pi-'));
  const agentDir = join(root, 'agent');
  isolatePiHome(t, agentDir);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const models = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
  models.getModel = () => model;
  models.streamSimple = () => { throw Error('No provider call allowed'); };
  models.hasConfiguredAuth = () => false;
  models.checkAuth = async () => ({ available: true });
  const asked = [];
  const ui = new Proxy({
    input: async (title, placeholder, options) => {
      if (title !== BRIDGE) return undefined;
      asked.push(JSON.parse(placeholder));
      const answer = await serve(placeholder, options?.signal);
      return answer === undefined ? undefined : JSON.stringify(answer);
    },
  }, { get: (target, name) => (name in target ? target[name] : () => undefined) });
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: extensions });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir, sessionManager: SessionManager.inMemory(root), resourceLoader, settingsManager, modelRuntime: models, model });
  t.after(() => session.dispose());
  await session.bindExtensions({ uiContext: ui, mode: 'rpc' });
  return { session, asked };
}
const toolResults = session => session.messages.filter(message => message.role === 'toolResult');

test("in Pi itself an offered tool is a real tool with its JSON schema, and a call runs in the host and reads back its answer", async t => {
  const given = host([findPull, anyAgent], name => (name === 'clock_now' ? { text: 'No clock here.', failed: true } : { text: 'Found #12.' }));
  const offer = integrationOffer(given, 'main');
  const { session } = await inPi(t, [createIntegrationExtension(offer)], placeholder => serveIntegration(placeholder, { host: given, offer, agent: MAIN_AGENT }));
  const registered = session.agent.state.tools.find(tool => tool.name === 'github_find_pull');
  assert.deepEqual(registered.parameters, findPull.parameters);
  assert.equal(session.getActiveToolNames().includes('github_find_pull'), true);
  scriptedModel(session, [{ name: 'github_find_pull', arguments: { words: 'flaky' } }, { name: 'clock_now', arguments: {} }, { name: 'github_find_pull', arguments: { words: 3 } }]);
  await session.prompt('Use them.', { preflightResult() {} });
  const [found, clock, coerced] = toolResults(session);
  assert.equal(found.content[0].text, 'Found #12.');
  assert.equal(found.isError, false);
  assert.equal(clock.isError, true);
  assert.match(clock.content[0].text, /No clock here\./);
  assert.equal(coerced.isError, false, "Pi checks the arguments against the tool's schema first");
  assert.deepEqual(given.calls.map(call => [call.name, call.args, call.call]), [
    ['github_find_pull', { words: 'flaky' }, { agent: MAIN_AGENT, id: 'call-1' }],
    ['clock_now', {}, { agent: MAIN_AGENT, id: 'call-2' }],
    ['github_find_pull', { words: '3' }, { agent: MAIN_AGENT, id: 'call-3' }],
  ]);
});
