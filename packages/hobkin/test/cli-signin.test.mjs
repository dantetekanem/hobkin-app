import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { signIn } from '../src/cli/signin.mjs';

const ENTER = '\r';
const ESC = '\x1b';

class FakeTerminal {
  columns = 100;
  rows = 30;
  writes = [];
  stopped = false;
  start(input, resize) {
    this.input = input;
    this.resize = resize;
  }
  stop() { this.stopped = true; }
  drainInput() { return Promise.resolve(); }
  write(data) { this.writes.push(data); }
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

const providers = [
  { id: 'acme', name: 'Acme AI', auth: { apiKey: { name: 'API key', login: () => {} } } },
  { id: 'ambient', name: 'Ambient Cloud', auth: { apiKey: { name: 'Cloud credentials' } } },
];

function fakeRuntime({ available = [], login = async () => ({}) } = {}) {
  const calls = [];
  return {
    calls,
    getAvailable: async () => available,
    getProviders: () => providers,
    getProviderAuthStatus: () => ({ configured: false }),
    isUsingOAuth: () => false,
    login: async (...request) => {
      calls.push(request);
      return login(...request);
    },
  };
}

const painted = terminal => stripTerminalSequences(terminal.writes.join(''));

async function until(terminal, text) {
  const deadline = Date.now() + 3000;
  while (!painted(terminal).includes(text)) {
    assert.ok(Date.now() < deadline, `${text} is on screen`);
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('a model that is already available means no screen and no sign-in', async () => {
  const terminal = new FakeTerminal();
  const modelRuntime = fakeRuntime({ available: [{ id: 'model' }] });

  await signIn({ modelRuntime, terminal });

  assert.deepEqual(terminal.writes, []);
  assert.deepEqual(modelRuntime.calls, []);
});

test('a launcher decides what Pi can use, so hobkin does not ask', async () => {
  const terminal = new FakeTerminal();
  const modelRuntime = fakeRuntime();

  await signIn({ modelRuntime, terminal, launcher: { command: ['wrapper'] } });

  assert.deepEqual(terminal.writes, []);
});

test('a model check that fails never stops hobkin opening', async () => {
  const terminal = new FakeTerminal();
  const modelRuntime = { ...fakeRuntime(), getAvailable: async () => { throw Error('no network'); } };

  await signIn({ modelRuntime, terminal });

  assert.deepEqual(terminal.writes, []);
});

test('with no model it offers the providers, signs in to the one picked and hands the terminal back', async () => {
  const terminal = new FakeTerminal();
  const modelRuntime = fakeRuntime({
    login: async (_id, _type, { prompt }) => ({ key: await prompt({ type: 'text', message: 'Paste your key' }) }),
  });

  const finished = signIn({ modelRuntime, terminal });
  await until(terminal, 'Acme AI');
  assert.match(painted(terminal), /hobkin needs a model/);
  terminal.input(ENTER);
  await until(terminal, 'Paste your key');
  terminal.input('secret');
  terminal.input(ENTER);
  await finished;

  assert.deepEqual(modelRuntime.calls.map(([id, type]) => [id, type]), [['acme', 'api_key']]);
  assert.equal(terminal.stopped, true);
});

test('a provider signed in outside Pi is not offered', async () => {
  const terminal = new FakeTerminal();
  const modelRuntime = fakeRuntime();

  const finished = signIn({ modelRuntime, terminal });
  await until(terminal, 'Acme AI');
  const offered = painted(terminal);
  terminal.input(ESC);
  await finished;

  assert.doesNotMatch(offered, /Ambient Cloud/);
});

test('Esc on the list carries on without a sign-in', async () => {
  const terminal = new FakeTerminal();
  const modelRuntime = fakeRuntime();

  const finished = signIn({ modelRuntime, terminal });
  await until(terminal, 'Acme AI');
  terminal.input(ESC);
  await finished;

  assert.deepEqual(modelRuntime.calls, []);
  assert.equal(terminal.stopped, true);
});

test('a failed sign-in says why and goes back to the list', async () => {
  const terminal = new FakeTerminal();
  const modelRuntime = fakeRuntime({ login: async () => { throw Error('The key was refused'); } });

  const finished = signIn({ modelRuntime, terminal });
  await until(terminal, 'Acme AI');
  terminal.input(ENTER);
  await until(terminal, 'The key was refused');
  terminal.input(ESC);
  await finished;

  assert.equal(modelRuntime.calls.length, 1);
});

test('backing out of a sign-in goes back to the list without an error', async () => {
  const terminal = new FakeTerminal();
  const modelRuntime = fakeRuntime({ login: async () => { throw Error('Login cancelled'); } });

  const finished = signIn({ modelRuntime, terminal });
  await until(terminal, 'Acme AI');
  terminal.input(ENTER);
  await until(terminal, 'Acme AI');
  await new Promise(resolve => setTimeout(resolve, 50));
  terminal.input(ESC);
  await finished;

  assert.doesNotMatch(painted(terminal), /Login cancelled/);
});

test('asked for directly it signs in even with a model available and a launcher set', async () => {
  const terminal = new FakeTerminal();
  const modelRuntime = fakeRuntime({ available: [{ id: 'model' }] });

  const finished = signIn({ always: true, launcher: { command: ['wrapper'] }, modelRuntime, terminal });
  await until(terminal, 'Acme AI');
  assert.doesNotMatch(painted(terminal), /needs a model/);
  terminal.input(ENTER);
  await finished;

  assert.deepEqual(modelRuntime.calls.map(([id]) => id), ['acme']);
});
