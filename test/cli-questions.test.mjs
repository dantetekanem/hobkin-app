import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQuestionTool, readAnswers } from '../src/cli/questions.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { initialize } from '../src/cli/config.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';
import { isolatePiHome } from './helpers/pi-session.mjs';
import { createAgentSession, ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createDashboard } from '../src/cli/ui.mjs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

const question = {
  question: 'What should happen?',
  choices: [
    { value: 'keep', label: 'Keep paused' },
    { value: 'enable', label: 'Enable this schedule' },
  ],
};

test('question tool validates choices and returns only the exact selected answer or explicit non-answer', async () => {
  const execute = ask => createQuestionTool(ask).execute('q', question);
  assert.deepEqual((await execute(async () => 'keep')).details, { status: 'answered', answer: question.choices[0] });
  assert.equal((await execute(async () => null)).details.status, 'cancelled');
  assert.equal((await execute(undefined)).details.status, 'unavailable');
  await assert.rejects(execute(async () => 'forged'), /choice/i);
  for (const invalid of [
    { ...question, choices: [question.choices[0]] },
    { ...question, choices: [question.choices[0], question.choices[0]] },
    { ...question, question: '\x1b[2J' },
  ]) {
    await assert.rejects(createQuestionTool(() => { throw Error('Must not display'); }).execute('q', invalid), /Invalid question/);
  }
});

test('the tool offers Other, and what the user types comes back as their answer', async () => {
  const asked = [];
  const ask = async request => {
    asked.push(request);
    return { typed: 'Neither, ask me tomorrow' };
  };

  const { details, content } = await createQuestionTool(ask).execute('q', question);

  assert.equal(asked[0].other, true);
  assert.deepEqual(details, { status: 'answered', typed: 'Neither, ask me tomorrow' });
  assert.deepEqual(JSON.parse(content[0].text), details);
  await assert.rejects(createQuestionTool(async () => ({ typed: '' })).execute('q', question), /choice/i);
});

test('each answer is kept privately: the question, the label chosen or the words typed, and when, and no answer keeps nothing', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-answers-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ask = answer => createQuestionTool(async () => answer, root).execute('q', question);

  await ask('enable');
  await ask({ typed: 'Neither, ask me tomorrow' });
  await ask(null);
  await createQuestionTool(undefined, root).execute('q', question);
  await assert.rejects(ask('forged'), /choice/i);

  const answers = readAnswers(root);
  assert.deepEqual(answers.map(({ at, ...kept }) => kept), [
    { question: 'What should happen?', chose: 'Enable this schedule' },
    { question: 'What should happen?', typed: 'Neither, ask me tomorrow' },
  ]);
  assert.ok(answers.every(({ at }) => Number.isFinite(Date.parse(at))));
  assert.equal(statSync(join(root, 'answers.jsonl')).mode & 0o077, 0);

  const unkept = await createQuestionTool(async () => 'keep', join(root, 'gone')).execute('q', question);
  assert.deepEqual(unkept.details, { status: 'answered', answer: question.choices[0] }, 'the answer reaches the agent even when it cannot be kept');
});

test('real SDK registers the main question tool and application delivers selection and cancellation to it', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-questions-'));
  isolatePiHome(t, join(root, 'agent'));
  const config = initialize(root, { cwd: root });
  const ui = createDashboard({ config, connection: 'connected' });
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
  const models = await ModelRuntime.create({
    authPath: join(root, 'auth.json'),
    modelsPath: null,
    modelsStorePath: join(root, 'models.json'),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  models.getModel = () => model;
  models.streamSimple = () => { throw Error('No provider call allowed'); };
  let questionShown;
  const app = await HobkinApplication.open(root, {
    askQuestion: (request, signal) => {
      const pending = ui.askQuestion(request, signal);
      questionShown?.resolve();
      return pending;
    },
    createMain: options => openPiSession(options, {
      agentDir: join(root, 'agent'),
      createSession: options => createAgentSession({
        ...options,
        modelRuntime: models,
        model,
        agentDir: join(root, 'agent'),
        tools: ['ask_question'],
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
      }),
    }),
  });
  t.after(async () => {
    ui.stop();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const tool = app.runtime.main.agent.state.tools.find(tool => tool.name === 'ask_question');
  assert.ok(tool, 'registered as a real SDK agent tool');
  ui.input('saved draft');
  const answered = tool.execute('choice-one', question);
  ui.input('\x1b[B');
  ui.input('\r');
  assert.deepEqual((await answered).details, { status: 'answered', answer: question.choices[1] });
  assert.deepEqual(readAnswers(root).map(({ question: asked, chose }) => [asked, chose]), [['What should happen?', 'Enable this schedule']]);
  assert.equal(ui.state().draft, 'saved draft');
  const abort = new AbortController();
  const cancelled = tool.execute('choice-two', question, abort.signal);
  abort.abort();
  assert.equal((await cancelled).details.status, 'cancelled');
  models.hasConfiguredAuth = () => false;
  models.checkAuth = async () => ({ available: true });
  let toolId = 0;
  const requests = [];
  app.runtime.main.agent.streamFunction = (_model, context) => {
    requests.push(JSON.stringify(context));
    const answered = context.messages.at(-1).role === 'toolResult';
    const message = {
      role: 'assistant',
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: answered ? [{ type: 'text', text: 'Received your selection.' }]
        : [{ type: 'toolCall', id: `ask-${++toolId}`, name: 'ask_question', arguments: question }],
      stopReason: answered ? 'stop' : 'toolUse',
      timestamp: Date.now(),
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
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
  questionShown = Promise.withResolvers();
  await app.send('Ask a question using the synthetic provider.');
  await questionShown.promise;
  ui.input('\r');
  await app.runtime.idle();
  const result = app.runtime.messages().find(message => message.role === 'toolResult');
  assert.deepEqual(JSON.parse(result.content[0].text), { status: 'answered', answer: question.choices[0] });
  questionShown = Promise.withResolvers();
  await app.runtime.send('Ask again, then cancel.', 'cancel-question');
  await questionShown.promise;
  await app.runtime.cancel('cancel-question');
  assert.equal((await app.runtime.state()).runs['cancel-question'].status, 'interrupted');
  assert.equal(ui.state().focus, 'composer');
  const nextTurn = requests.at(-1).slice(requests.at(-1).indexOf('## What the user decided lately'));
  for (const label of ['Keep paused', 'Enable this schedule']) assert.ok(nextTurn.includes(label), `the next turn carries ${label}`);
  const closed = tool.execute('choice-three', question);
  ui.stop();
  assert.equal((await closed).details.status, 'cancelled');
  assert.equal(readAnswers(root).length, 2, 'a cancelled question keeps nothing');
  const events = join(root, 'runtime', 'events');
  const written = readdirSync(events).map(name => readFileSync(join(events, name), 'utf8')).join('');
  assert.doesNotMatch(written, /What should happen|Keep paused|Enable this schedule/, 'events hold facts and none of the words');
});
