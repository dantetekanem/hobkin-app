import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createAgentSession, ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { isHoldBrief } from '../src/cli/holds.mjs';
import { main } from '../src/cli/main.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';
import { startDashboard } from '../src/cli/ui.mjs';
import { isolatePiHome } from './helpers/pi-session.mjs';

const LEFT = '\x1b[D';
const DOWN = '\x1b[B';
const ENTER = '\r';
const ESCAPE = '\x1b';
const CHROME_DOWN = 'Timed out: the Chrome extension is not polling (last seen never).';
const BLOCKED = 'Blocked: Chrome is not polling.\n\nDetails.';
const PLAN = 'Mail is held. Its last two runs stopped at a Chrome test and never called Gmail, which was fine. I propose to remove that test from its memory, then run it once.';
const QUESTION = {
  question: 'Remove the Chrome test from the memory of Mail and run it once?',
  choices: [{ value: 'leave', label: 'Leave it held' }, { value: 'fix', label: 'Yes, fix it and run it once' }],
};

class FakeTerminal {
  columns = 100;
  rows = 40;
  start(input, resize) {
    this.input = input;
    this.resize = resize;
  }
  stop() {}
  drainInput() { return Promise.resolve(); }
  write() {}
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
  get kittyProtocolActive() { return false; }
}

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-hold-flow-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  isolatePiHome(t, join(base, 'agent'));
  const root = join(base, 'home');
  mkdirSync(root);
  const config = initialize(root, { cwd: base, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
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
        ...sdkOptions, agentDir, modelRuntime: models, model, tools: ['ask_question', 'run_routine'],
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
      });
      result.session.agent.streamFunction = streamFrom(play);
      return result;
    },
  });
}

/** The real `main()` on a fake terminal. `play` is the model behind the main agent and `check` every scheduled run. */
async function openHobkin(h, { play, check }) {
  const signals = new EventEmitter();
  const terminal = new FakeTerminal();
  const createMain = await mainAgent(h, play);
  let ui;
  let app;
  const finished = main(['--home', h.root], { isTTY: true, write() {} }, {
    signals,
    input: { isTTY: true },
    startDashboard: (view, handlers, options) => {
      ui = startDashboard(view, handlers, { ...options, terminal, agentDir: h.root, theme: undefined });
      return ui;
    },
    openApplication: async (home, options) => {
      app = await HobkinApplication.open(home, {
        ...options,
        memoryIndex: null,
        intervalMs: 100,
        createMain,
        // Only the check is scripted here. An editor that cannot run leaves its report as written.
        runHarness: async (run, settings) => (run.purpose === 'humanizer'
          ? { status: 'failed', text: '' }
          : { status: 'completed', text: await check(run, settings) }),
      });
      return app;
    },
  });
  const screen = (width = 120, height = 45) => stripTerminalSequences(ui.render(width, height).join('\n'));
  const hobkin = {
    screen,
    get app() { return app; },
    state: () => ui.state(),
    async until(expected, { timeout = 8000 } = {}) {
      const deadline = Date.now() + timeout;
      while (!expected.test(screen())) {
        if (Date.now() > deadline) assert.fail(`Never saw ${expected} on this screen:\n${screen()}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
    press: data => terminal.input(data),
    type(text) {
      for (const character of text) terminal.input(character);
    },
    send(text) {
      hobkin.type(text);
      terminal.input(ENTER);
    },
    async close() {
      signals.emit('SIGTERM');
      await finished;
    },
  };
  await hobkin.until(/connected/);
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
  await hobkin.until(/hobkin asks/);
  await hobkin.until(/stopped at a Chrome test/);
  const asked = hobkin.screen();
  for (const text of ['Paused until', 'stopped at a Chrome test', 'then run it once', QUESTION.question, 'Leave it held', 'Yes, fix it and run it once']) {
    assert.ok(asked.includes(text), `Chat should say ${text}:\n${asked}`);
  }
  assert.doesNotMatch(asked, /hobkin-hold/);
  assert.equal(briefs(seen).length, 1);
  const brief = details(briefs(seen)[0]);
  assert.equal(brief.routineFile, join(h.root, 'routines/daily/mail.md'));
  assert.deepEqual(brief.runs.at(-1).toolErrors, [{ tool: 'chrome_tab', error: CHROME_DOWN }]);

  hobkin.press(DOWN);
  hobkin.press(ENTER);
  await hobkin.until(/Mail is running once to prove the fix/);
  await hobkin.until(/Mail: Sent two follow-ups\./);

  hobkin.press(LEFT);
  await hobkin.until(/UPCOMING/);
  assert.doesNotMatch(hobkin.screen(), /held, retries/);
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
  await hobkin.until(/hobkin asks/);

  // The do-nothing choice comes first, so Enter on its own never approves anything.
  hobkin.press(ENTER);
  await hobkin.until(/Mail stays held/);
  hobkin.press(LEFT);
  await hobkin.until(/held, retries/);
  await rest(300);
  await hobkin.close();

  hobkin = await openHobkin(h, { play: planning(seen), check });
  t.after(() => hobkin.close());
  await hobkin.until(/Mail stays held/);
  await rest(400);

  assert.doesNotMatch(hobkin.screen(), /hobkin asks/);
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
  assert.doesNotMatch(hobkin.screen(), /hobkin asks/);

  thinking.resolve();
  await hobkin.until(/hobkin asks/);
  await hobkin.until(/Your answer\./);

  assert.deepEqual(seen.filter(message => message.role === 'user').map(message => isHoldBrief(textOf(message))), [false, true], 'one turn, then the other');
});

test('an Enter meant for a draft cannot approve anything, and the draft survives', async t => {
  const h = fixture(t);
  const seen = [];
  const hobkin = await openHobkin(h, { play: planning(seen), check: async run => failingRun(run.sessionFile) });
  t.after(() => hobkin.close());
  await hobkin.until(/Mail: Chrome is not polling\./);

  hobkin.type('half a thought');
  await hobkin.app.runner.trigger('mail', 'second-try');
  await hobkin.until(/hobkin asks/);
  assert.equal(hobkin.state().draft, 'half a thought');

  hobkin.press(ENTER);
  await hobkin.until(/Mail stays held/);

  assert.equal(hobkin.state().draft, 'half a thought');
  assert.equal(hobkin.state().view, 'conversation');
  assert.equal(logLines(h).length, 2, 'it ran nothing');
});

test('the question reaches the user on another tab, opens in Chat, and leaves them back where they were', async t => {
  const h = fixture(t);
  const seen = [];
  const hobkin = await openHobkin(h, { play: planning(seen), check: async run => failingRun(run.sessionFile) });
  t.after(() => hobkin.close());
  await hobkin.until(/Mail: Chrome is not polling\./);
  hobkin.press(LEFT);
  await hobkin.until(/UPCOMING/);

  await hobkin.app.runner.trigger('mail', 'second-try');
  await hobkin.until(/hobkin asks/);

  // The main agent's question is about the message just above it, so it opens there whichever tab the user was on.
  assert.equal(hobkin.state().view, 'conversation');
  assert.ok(hobkin.screen().includes(QUESTION.question), 'the question has to stand alone here');

  hobkin.press(ENTER);
  await rest(100);
  assert.doesNotMatch(hobkin.screen(), /hobkin asks/);
  // Answering takes the user back to the tab they left, so the held check is still in front of them.
  assert.equal(hobkin.state().view, 'schedules');
  assert.match(hobkin.screen(), /held, retries/);
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
  await hobkin.until(/hobkin asks/);
  await hobkin.app.runner.trigger('slow', 'slow-check');
  await hobkin.close();

  assert.deepEqual(seen.filter(message => message.role === 'toolResult'), [], 'a quit reaches the agent as nothing, not as an answer');

  hobkin = await openHobkin(h, { play: planning(seen), check });
  t.after(() => hobkin.close());
  await hobkin.until(/hobkin asks/);

  assert.equal(briefs(seen).length, 2);
  assert.equal(details(briefs(seen)[1]).resumed, true);
  hobkin.press(ESCAPE);
  await hobkin.until(/Mail stays held/);
});
