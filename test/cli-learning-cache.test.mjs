import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { HobkinApplication } from '../src/cli/application.mjs';
import { initialize, setLearning } from '../src/cli/config.mjs';
import { tokensIn } from '../src/cli/learning/lessons.mjs';
import { appendAction, saveState } from '../src/cli/learning/store.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';
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
const lessons = names => names.map(scope => ({ id: scope, scope, code: 'blocked', seen: 5, latest: new Date(Date.now() + 86400000).toISOString() }));
// The system prompt names the block to explain it, and that text never changes. A note is what can bust the cache.
const blocks = text => (text.match(/<hobkin-learning>\\n\{/g) ?? []).length;

/** Real Pi and real extensions in this process, with a scripted model that keeps exactly what each call would send. */
async function openRealChat(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-learning-cache-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agentDir = join(root, 'agent');
  mkdirSync(agentDir);
  isolatePiHome(t, agentDir);
  initialize(root, { cwd: root });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(root, 'auth.json'),
    modelsPath: null,
    modelsStorePath: join(root, 'models.json'),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.getModel = () => model;
  modelRuntime.streamSimple = () => { throw Error('No provider call is allowed in this fixture.'); };
  modelRuntime.checkAuth = async () => ({ available: true });
  modelRuntime.hasConfiguredAuth = () => false;
  const app = await HobkinApplication.open(root, {
    intervalMs: 60000,
    createMain: options => openPiSession(options, {
      agentDir,
      createSession: settings => createAgentSession({ ...settings, agentDir, modelRuntime, model }),
    }),
  });
  t.after(() => app.close());

  const requests = [];
  const session = app.runtime.main;
  session.agent.streamFunction = (_model, context) => {
    const { messages, ...head } = context;
    const [system, conversation] = [messages.filter(item => item.role === 'system'), messages.filter(item => item.role !== 'system')];
    requests.push({ head: JSON.stringify({ ...head, system }), conversation: conversation.map(item => JSON.stringify(item)) });
    const message = {
      role: 'assistant',
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: [{ type: 'text', text: 'Done.' }],
      stopReason: 'stop',
      timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: 'done', reason: 'stop', message });
      stream.end();
    });
    return stream;
  };
  const say = async text => {
    await app.send(text);
    await app.runtime.mainWork;
  };
  return { root, app, session, requests, say };
}

const keepsPrefix = (earlier, later) => earlier.head === later.head
  && earlier.conversation.every((message, index) => later.conversation[index] === message);

test('a new lesson leaves every byte the provider already holds in place, on real Pi turns', async t => {
  const h = await openRealChat(t);
  setLearning(h.root, true);
  saveState(h.root, { lessons: lessons(['site-audit']), proposals: [], pullRequests: {} });

  await h.say('First.');
  await h.say('Second.');
  saveState(h.root, { lessons: lessons(['site-audit', 'news-digest']), proposals: [], pullRequests: {} });
  await h.say('Third.');
  await h.say('Fourth.');

  assert.equal(h.requests.length, 4);
  for (let index = 1; index < 4; index++) {
    assert.ok(keepsPrefix(h.requests[index - 1], h.requests[index]), `request ${index + 1} rebuilds nothing the one before it sent`);
  }
  const conversation = h.requests.at(-1).conversation.join('\n');
  assert.equal(blocks(conversation), 2, 'one note for each list, at the end of the conversation when it went');
  assert.equal(blocks(h.requests.at(-1).head), 0, 'none of it in the part every turn shares');
  const note = h.requests[0].conversation[0];
  t.diagnostic(`real request: head ${h.requests[0].head.length} bytes never changed; first note added ${tokensIn(note)} tokens at the tail`);
});

test('the same change in the system prompt would have rewritten everything, which is why learning stays out of it', async t => {
  const h = await openRealChat(t);

  await h.say('First.');
  writeFileSync(join(h.root, 'memory.md'), '- Rent is due November 1\n');
  await h.say('Second.');

  assert.notEqual(h.requests[0].head, h.requests[1].head, 'a change to memory changes the head of every later request');
});

test('with learning off a turn is byte for byte what it was before this feature', async t => {
  const h = await openRealChat(t);

  await h.say('First.');
  await h.say('Second.');

  assert.equal(blocks(h.requests.at(-1).conversation.join('\n')), 0);
  assert.equal(blocks(h.requests.at(-1).head), 0);
  assert.equal(JSON.parse(h.requests[0].conversation[0]).content.at(-1).text, 'First.');
});

test('taking lessons back adds to the tail too, and rewrites nothing', async t => {
  const h = await openRealChat(t);
  setLearning(h.root, true);
  saveState(h.root, { lessons: lessons(['site-audit']), proposals: [], pullRequests: {} });

  await h.say('First.');
  appendAction(h.root, { type: 'clear', all: true, at: new Date(Date.now() + 2 * 86400000).toISOString() });
  await h.say('Second.');

  assert.ok(keepsPrefix(h.requests[0], h.requests[1]));
  assert.equal(blocks(h.requests[1].conversation.join('\n')), 2);
  assert.match(h.requests[1].conversation.at(-1), /\{\\"learning\\":\[\]\}/);
});
