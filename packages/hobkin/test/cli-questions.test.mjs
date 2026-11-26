import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQuestionTool, readAnswers } from '../src/cli/questions.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { openDecisions } from '../src/cli/decisions.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';
import { fakePi, isolatePiHome } from './helpers/pi-session.mjs';
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

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-later-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  return root;
}

test('a question the user puts off, or leaves until its time runs out, waits in Action Items with its words and choices', async t => {
  const root = home(t);
  const putOff = createQuestionTool(async () => null, root);

  const { details, content } = await putOff.execute('q', question);

  assert.equal(details.status, 'later');
  assert.match(details.message, /Action Items/);
  assert.deepEqual(JSON.parse(content[0].text), details);
  const [waiting, ...more] = openDecisions(root);
  assert.deepEqual(more, []);
  assert.equal(waiting.id, details.id);
  assert.equal(waiting.from, 'hobkin');
  assert.equal(waiting.question, question.question);
  assert.deepEqual(waiting.choices, question.choices);
  assert.equal(waiting.answerTo.kind, 'chat');
  assert.equal(waiting.shown, true, 'it had its moment on screen, so it never rises on the sheet again');

  const again = await putOff.execute('q2', question);
  assert.equal(again.details.id, details.id, 'the same question put off twice is still one item');
  assert.equal(openDecisions(root).length, 1);
  assert.deepEqual(readAnswers(root), [], 'putting it off is no answer');
});

test('a question the user stops, or one with nowhere to keep it, is no item; asked again and answered, the one waiting leaves', async t => {
  const root = home(t);
  const stop = new AbortController();
  const stopped = createQuestionTool(async () => {
    stop.abort();
    return null;
  }, root).execute('q', question, stop.signal);
  assert.equal((await stopped).details.status, 'cancelled');
  assert.equal((await createQuestionTool(async () => null).execute('q', question)).details.status, 'cancelled');
  assert.deepEqual(openDecisions(root), [], 'a stop is the user ending the turn, not putting the question off');

  await createQuestionTool(async () => null, root).execute('q', question);
  const answered = await createQuestionTool(async () => 'enable', root).execute('q', question);

  assert.deepEqual(answered.details, { status: 'answered', answer: question.choices[1] });
  assert.deepEqual(openDecisions(root), [], 'answered on the sheet, it does not wait in Action Items as well');
});

test('quitting with a question open is no answer and no putting it off, while Esc puts it off', async t => {
  const root = home(t);
  const config = initialize(root, { cwd: root });
  const ui = createDashboard({ config, connection: 'connected' });
  t.after(() => ui.stop());

  const escaped = ui.askQuestion(question);
  ui.input('\x1b');
  assert.equal(await escaped, null);
  const quit = ui.askQuestion(question);
  ui.stop();
  assert.equal(await quit, undefined, 'whoever asked can ask again on the next start');
});

test('a question put off is answered in Action Items, and the main agent hears the answer in Chat with the question', async t => {
  const root = home(t);
  const asked = [];
  const shown = [];
  const app = await HobkinApplication.open(root, {
    createMain: fakePi(root).createMain,
    askQuestion: async request => { asked.push(request); return null; },
    showRow: target => shown.push(target),
  });
  try {
    const putOff = createQuestionTool(async () => null, root);
    const chosen = (await putOff.execute('q', question)).details.id;
    const worded = (await putOff.execute('q2', { ...question, question: 'Which day should it run?' })).details.id;

    await app.presentDecision();
    assert.deepEqual(asked, [], 'nothing put off rises on the sheet again');

    await app.workAction('decide', chosen, 'enable');
    await app.workAction('words', worded, 'Only on weekdays');
    await app.outgoing;
    await app.runtime.idle();

    const [first, second] = app.runtime.messages().filter(message => message.role === 'user').map(message => message.content);
    assert.match(first, /^<hobkin-report>\n/);
    assert.match(first, /What should happen\?\n\n- Keep paused\n- Enable this schedule/);
    assert.match(first, /\n\nEnable this schedule$/);
    assert.match(second, /Which day should it run\?/);
    assert.match(second, /\n\nOnly on weekdays$/);
    assert.deepEqual(shown, [{ tab: 'chat' }, { tab: 'chat' }]);
    assert.deepEqual(openDecisions(root), [], 'answered, it leaves Action Items');
    await assert.rejects(app.workAction('decide', chosen, 'keep'), /already answered/);
  } finally {
    await app.close();
  }
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
  assert.equal((await closed).details.status, 'unavailable', 'a quit is no answer, and the question was not put off');
  assert.equal(readAnswers(root).length, 2, 'a cancelled question keeps nothing');
  assert.deepEqual(openDecisions(root), [], 'a stopped turn or a quit leaves nothing in Action Items');
  const events = join(root, 'runtime', 'events');
  const written = readdirSync(events).map(name => readFileSync(join(events, name), 'utf8')).join('');
  assert.doesNotMatch(written, /What should happen|Keep paused|Enable this schedule/, 'events hold facts and none of the words');
});
