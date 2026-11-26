import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createAgentSession, ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { isHoldBrief } from '../src/cli/holds.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';
import { isolatePiHome } from './helpers/pi-session.mjs';

const CHROME_DOWN = 'Timed out: the Chrome extension is not polling (last seen never).';
const BLOCKED = 'Blocked: Chrome is not polling.\n\nDetails.';
const PLAN = 'Mail is held. Its last two runs stopped at a Chrome test and never called Gmail, which was fine. I propose to remove that test from its memory, then run it once.';
const QUESTION = {
  question: 'Remove the Chrome test from the memory of Mail and run it once?',
  choices: [{ value: 'leave', label: 'Leave it held' }, { value: 'fix', label: 'Yes, fix it and run it once' }],
};

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-hold-flow-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  isolatePiHome(t, join(base, 'agent'));
  const root = join(base, 'home');
  mkdirSync(root);
  const config = initialize(root, { cwd: base, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  // These flows read their lines in Chat as they come; when the desk delivers them is the desk's own tests (075).
  config.desk = { enabled: false };
  atomicJson(join(root, 'config.json'), config);
  const h = { base, root };
  writeSchedule(h, { id: 'mail', title: 'Mail', at: '00:00' });
  return h;
}

function writeSchedule(h, schedule) {
  writeFileSync(join(h.root, `routines/daily/${schedule.id}.md`), `---\n${JSON.stringify({
    timezone: 'UTC', enabled: true, harness: 'pi', model: 'fixture/check', effort: 'medium', cwd: h.base, context: [], ...schedule,
  })}\n---\nFollow up on mail.\n`);
}

const textOf = message => (typeof message.content === 'string' ? message.content
  : message.content.filter(part => part.type === 'text').map(part => part.text).join('\n'));

/** Stands in for the provider only: the turn, its tools and what they do are real, and each call sees the real conversation. */
function streamFrom(play) {
  let calls = 0;
  return (selected, context, { signal } = {}) => {
    const stream = createAssistantMessageEventStream();
    const message = (content, stopReason) => ({
      role: 'assistant', api: selected.api, provider: selected.provider, model: selected.id,
      content, stopReason, timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 } },
    });
    const abort = () => {
      stream.push({ type: 'error', reason: 'aborted', error: message([{ type: 'text', text: 'Cancelled' }], 'aborted') });
      stream.end();
    };
    if (signal?.aborted) {
      abort();
      return stream;
    }
    signal?.addEventListener('abort', abort, { once: true });
    void Promise.resolve(play(context.messages)).then(({ text, call }) => {
      if (signal?.aborted) return;
      signal?.removeEventListener('abort', abort);
      const parts = [
        ...(text ? [{ type: 'text', text }] : []),
        ...(call ? [{ type: 'toolCall', id: `call-${++calls}`, name: call.name, arguments: call.arguments }] : []),
      ];
      const reason = call ? 'toolUse' : 'stop';
      stream.push({ type: 'done', reason, message: message(parts, reason) });
      stream.end();
    });
    return stream;
  };
}

/** The main agent's side of a hold, as the runtime prompt asks for it. */
const planning = (seen, onUser = async () => ({ text: 'OK.' })) => async messages => {
  const last = messages.at(-1);
  seen.push(last);
  const text = textOf(last);
  if (last.role === 'user' && isHoldBrief(text)) return { text: PLAN, call: { name: 'ask_question', arguments: QUESTION } };
  if (last.role === 'user') return onUser(text);
  if (last.toolName === 'run_routine') return { text: 'Mail is running once to prove the fix.' };
  return JSON.parse(text).answer?.value === 'fix'
    ? { call: { name: 'run_routine', arguments: { routineId: 'mail' } } }
    : { text: 'Mail stays held, and I will not ask again.' };
};
const runsAgain = async () => ({ call: { name: 'run_routine', arguments: { routineId: 'mail' } } });

// What Pi writes for the failure this feature came from: code mode says it worked, and only its details say otherwise.
const failingRun = sessionFile => {
  mkdirSync(join(sessionFile, '..'), { recursive: true });
  writeFileSync(sessionFile, `${JSON.stringify({
    type: 'message',
    message: {
      role: 'toolResult', toolName: 'codemode', isError: false, content: [{ type: 'text', text: 'done' }],
      details: { calls: [{ name: 'chrome_tab', status: 'error', error: CHROME_DOWN }] },
    },
  })}\n`);
  return BLOCKED;
};

async function mainAgent(h, play) {
  const agentDir = join(h.base, 'agent');
  const model = {
    id: 'local', provider: 'fixture', name: 'Synthetic', api: 'openai-completions',
    baseUrl: 'https://invalid.test', reasoning: true, input: ['text'],
    contextWindow: 32000, maxTokens: 2048,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const models = await ModelRuntime.create({
    authPath: join(h.base, 'auth.json'), modelsPath: null,
    modelsStorePath: join(h.base, 'models.json'), allowModelNetwork: false, refreshOnCreate: false,
  });
  models.hasConfiguredAuth = () => true;
  return options => openPiSession(options, {
    agentDir,
    createSession: async sdkOptions => {
      const result = await createAgentSession({
        ...sdkOptions, agentDir, modelRuntime: models, model,
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
      });
      result.session.agent.streamFunction = streamFrom(play);
      return result;
    },
  });
}

const chatText = view => (view?.messages ?? []).map(message => message.content).join('\n');
const routine = (view, id) => view?.schedules?.find(schedule => schedule.id === id);

/**
 * HobkinApplication opened as the window's host opens it. `play` is the model behind the main agent and `check` every scheduled run.
 * Its questions wait in `questions`, one open at a time, for the test to answer by a choice's value: `null` puts one off, as Escape
 * did, and closing leaves an open one unanswered, as a quit does.
 */
async function openHobkin(h, { play, check }) {
  const views = [];
  const questions = [];
  const seenAt = Date.now();
  let open = null;
  let closed = false;
  const app = await HobkinApplication.open(h.root, {
    memoryIndex: null,
    intervalMs: 100,
    createMain: await mainAgent(h, play),
    // Only the check is scripted here. An editor that cannot run leaves its report as written.
    runHarness: async (run, settings) => (run.purpose === 'humanizer'
      ? { status: 'failed', text: '' }
      : { status: 'completed', text: await check(run, settings) }),
    onChange: view => views.push(view),
    askQuestion: (request, signal) => {
      if (open || closed) return Promise.resolve(undefined);
      if (signal?.aborted) return Promise.resolve(null);
      return new Promise(resolve => {
        const asked = {
          request,
          answer(value) {
            if (open !== asked) return;
            open = null;
            signal?.removeEventListener('abort', leave);
            resolve(value);
          },
        };
        const leave = () => asked.answer(null);
        signal?.addEventListener('abort', leave, { once: true });
        open = asked;
        questions.push(asked);
      });
    },
    presence: () => ({ seenAt, away: false, occupied: open !== null }),
  });
  const view = () => views.at(-1) ?? app.snapshot;
  const hobkin = {
    app,
    questions,
    view,
    chat: () => chatText(view()),
    get open() { return open; },
    async settled(done, { timeout = 8000 } = {}) {
      const deadline = Date.now() + timeout;
      while (!done()) {
        if (Date.now() > deadline) assert.fail(`Never settled. Chat says:\n${hobkin.chat()}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
    until: (expected, options) => hobkin.settled(() => expected.test(hobkin.chat()), options),
    /** The question open now, once one is. */
    async asked(options) {
      await hobkin.settled(() => open !== null, options);
      return open;
    },
    // As Enter in Chat did: the message goes, and the test does not wait for its turn.
    send(text) {
      const sent = app.send(text);
      sent.catch(() => {});
      return sent;
    },
    async close() {
      closed = true;
      open?.answer(undefined);
      await app.close();
    },
  };
  return hobkin;
}

const rest = ms => new Promise(resolve => setTimeout(resolve, ms));
const briefs = seen => seen.filter(message => message.role === 'user' && isHoldBrief(textOf(message)));
const details = message => JSON.parse(textOf(message).split('\n')[1]);
const logLines = h => readFileSync(join(h.root, 'checks/mail/log.md'), 'utf8').trim().split('\n');

test('a check held over one broken tool brings a plan, and a yes fixes it and proves it', async t => {
  const h = fixture(t);
  const seen = [];
  let runs = 0;
  const hobkin = await openHobkin(h, {
    play: planning(seen, runsAgain),
    check: async run => (++runs <= 2 ? failingRun(run.sessionFile) : 'Useful: Sent two follow-ups.'),
  });
  t.after(() => hobkin.close());

  await hobkin.until(/Mail: Chrome is not polling\./);
  hobkin.send('run mail again');

  // Nobody asked for this part: the second block is enough.
  const question = await hobkin.asked();
  await hobkin.until(/stopped at a Chrome test/);
  const chat = hobkin.chat();
  for (const text of ['Paused until', 'stopped at a Chrome test', 'then run it once']) {
    assert.ok(chat.includes(text), `Chat should say ${text}:\n${chat}`);
  }
  assert.equal(question.request.question, QUESTION.question);
  assert.deepEqual(question.request.choices.map(choice => choice.label), ['Leave it held', 'Yes, fix it and run it once']);
  assert.doesNotMatch(JSON.stringify(hobkin.view().messages), /hobkin-hold/);
  assert.equal(briefs(seen).length, 1);
  const brief = details(briefs(seen)[0]);
  assert.equal(brief.routineFile, join(h.root, 'routines/daily/mail.md'));
  assert.deepEqual(brief.runs.at(-1).toolErrors, [{ tool: 'chrome_tab', error: CHROME_DOWN }]);

  question.answer('fix');
  await hobkin.until(/Mail is running once to prove the fix/);
  await hobkin.until(/Mail: Sent two follow-ups\./);

  assert.notEqual(routine(hobkin.view(), 'mail').nextRun?.state, 'held');
  assert.equal(logLines(h).length, 3, 'the check ran once more, and the plan is not one of its runs');
  assert.equal(briefs(seen).length, 1);
});

test('a no leaves the check held, and nothing asks again, even after a restart', async t => {
  const h = fixture(t);
  const seen = [];
  const check = async run => failingRun(run.sessionFile);
  let hobkin = await openHobkin(h, { play: planning(seen, runsAgain), check });
  await hobkin.until(/Mail: Chrome is not polling\./);
  hobkin.send('run mail again');

  // The do-nothing choice comes first, so Enter on its own never approves anything.
  const question = await hobkin.asked();
  assert.equal(question.request.choices[0].value, 'leave');
  question.answer('leave');
  await hobkin.until(/Mail stays held/);
  await hobkin.settled(() => routine(hobkin.view(), 'mail')?.nextRun?.state === 'held');
  await rest(300);
  await hobkin.close();

  hobkin = await openHobkin(h, { play: planning(seen), check });
  t.after(() => hobkin.close());
  await hobkin.until(/Mail stays held/);
  await rest(400);

  assert.deepEqual(hobkin.questions, []);
  assert.equal(briefs(seen).length, 1);
  assert.equal(logLines(h).length, 2);
});

test('a hold that lands during the user\'s turn waits for that turn, and never steers it', async t => {
  const h = fixture(t);
  const seen = [];
  const thinking = Promise.withResolvers();
  const reached = Promise.withResolvers();
  const hobkin = await openHobkin(h, {
    play: planning(seen, async () => {
      reached.resolve();
      await thinking.promise;
      return { text: 'Your answer.' };
    }),
    check: async run => failingRun(run.sessionFile),
  });
  t.after(() => {
    thinking.resolve();
    return hobkin.close();
  });
  await hobkin.until(/Mail: Chrome is not polling\./);

  hobkin.send('a long question');
  await reached.promise;
  await hobkin.app.runner.trigger('mail', 'second-try');
  await hobkin.until(/Paused until/);
  await rest(400);

  assert.equal(briefs(seen).length, 0, 'the agent is busy, so the plan waits');
  assert.deepEqual(hobkin.questions, []);

  thinking.resolve();
  await hobkin.asked();
  await hobkin.until(/Your answer\./);

  assert.deepEqual(seen.filter(message => message.role === 'user').map(message => isHoldBrief(textOf(message))), [false, true], 'one turn, then the other');
});

test('a hold\'s question opens in Chat, and answering it runs nothing and leaves the check held', async t => {
  const h = fixture(t);
  const seen = [];
  const hobkin = await openHobkin(h, { play: planning(seen), check: async run => failingRun(run.sessionFile) });
  t.after(() => hobkin.close());
  await hobkin.until(/Mail: Chrome is not polling\./);

  await hobkin.app.runner.trigger('mail', 'second-try');
  const question = await hobkin.asked();

  // The main agent's question is about the message just above it, so it opens in Chat.
  assert.equal(question.request.inChat, true);
  assert.equal(question.request.question, QUESTION.question, 'the question has to stand alone');

  question.answer('leave');
  await hobkin.until(/Mail stays held/);
  assert.equal(hobkin.open, null);
  assert.equal(routine(hobkin.view(), 'mail').nextRun?.state, 'held');
  assert.equal(logLines(h).length, 2, 'it ran nothing');
});

test('quitting with the question open is not a no, however long the quit takes: the next start asks again', async t => {
  const h = fixture(t);
  writeSchedule(h, { id: 'slow', title: 'Slow', at: '23:59' });
  const seen = [];
  const check = async run => {
    if (JSON.parse(run.prompt).routine.id === 'mail') return failingRun(run.sessionFile);
    // A check that takes a moment to stop keeps the quit waiting, and the agent must not use that moment.
    await new Promise(resolve => run.signal.addEventListener('abort', resolve, { once: true }));
    await rest(100);
    return 'Nothing new.';
  };
  let hobkin = await openHobkin(h, { play: planning(seen), check });
  await hobkin.until(/Mail: Chrome is not polling\./);
  await hobkin.app.runner.trigger('mail', 'second-try');
  await hobkin.asked();
  await hobkin.app.runner.trigger('slow', 'slow-check');
  await hobkin.close();

  assert.deepEqual(seen.filter(message => message.role === 'toolResult'), [], 'a quit reaches the agent as nothing, not as an answer');

  hobkin = await openHobkin(h, { play: planning(seen), check });
  t.after(() => hobkin.close());
  const question = await hobkin.asked();

  assert.equal(briefs(seen).length, 2);
  assert.equal(details(briefs(seen)[1]).resumed, true);
  question.answer(null);
  await hobkin.until(/Mail stays held/);
});
