import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, rmSync, symlinkSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialize } from '../src/cli/config.mjs';
import { main } from '../src/cli/main.mjs';
import { readPresentationState } from '../src/cli/view.mjs';
import { setProfile } from '../src/cli/profile.mjs';
import { fileDecision } from '../src/cli/decisions.mjs';
import { chooseProject, fileItem, recordLaunch, updateItem } from '../src/cli/work/store.mjs';

function fixture(t, isTTY = false) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-main-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initialize(root, { cwd: root });
  const signals = new EventEmitter();
  const output = { isTTY, text: '', write(text) { this.text += text; } };
  return { root, signals, output };
}

function freshHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'hobkin-first-run-'));
  const original = { HOME: process.env.HOME, HOBKIN_HOME: process.env.HOBKIN_HOME };
  process.env.HOME = home;
  delete process.env.HOBKIN_HOME;
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  });
  return { home, root: join(home, '.hobkin') };
}

test('interactive launch initializes the default workspace without touching legacy data', async t => {
  const { home, root } = freshHome(t);
  const legacy = join(home, '.pi/agent/hobkin');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, 'state.json'), '{"legacy":"preserved"}');
  const signals = new EventEmitter();
  let opens = 0;
  const dependencies = {
    signals,
    input: { isTTY: true },
    startDashboard: () => ({ update() {}, stop() {} }),
    openApplication: async selectedRoot => {
      assert.equal(selectedRoot, root);
      assert.equal(JSON.parse(readFileSync(join(root, 'config.json'))).version, 2);
      opens++;
      signals.emit('SIGTERM');
      return { close: async () => {} };
    },
  };
  assert.equal(await main([], { isTTY: true, write() {} }, dependencies), 0);
  const config = readFileSync(join(root, 'config.json'), 'utf8');
  assert.equal(await main([], { isTTY: true, write() {} }, dependencies), 0);
  assert.equal(readFileSync(join(root, 'config.json'), 'utf8'), config);
  assert.equal(opens, 2);
  for (const cadence of ['daily', 'weekly', 'monthly']) {
    assert.equal(existsSync(join(root, 'routines', cadence)), true);
  }
  assert.equal(readFileSync(join(legacy, 'state.json'), 'utf8'), '{"legacy":"preserved"}');
  assert.equal(existsSync(`${legacy}-control`), false);
  assert.equal(existsSync(join(root, 'migration')), false);
});

test('finite reads do not initialize, and connected startup cannot bypass an incomplete migration', async t => {
  const { root } = freshHome(t);
  const dependencies = {
    input: { isTTY: true },
    openApplication: () => { throw Error('Must not open'); },
  };
  for (const [args, isTTY] of [[[], false], [['--plain'], true], [['routines'], true], [['schedules'], true]]) {
    await assert.rejects(main(args, { isTTY, write() {} }, dependencies), { code: 'ENOENT' });
    assert.equal(existsSync(root), false);
  }
  mkdirSync(join(root, 'migration'), { recursive: true });
  await assert.rejects(main([], { isTTY: true, write() {} }, dependencies), /Migration is incomplete/);
  assert.equal(existsSync(join(root, 'config.json')), false);
});

test('the published hobkin executable runs from PATH outside the checkout and preserves failure exits', t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-bin-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const entry = manifest.bin['hobkin'];
  assert.equal(typeof entry, 'string');
  const executable = join(root, 'hobkin');
  const home = join(root, 'home');
  symlinkSync(fileURLToPath(new URL(`../${entry}`, import.meta.url)), executable);
  const options = {
    cwd: root,
    env: { ...process.env, PATH: `${root}:${process.env.PATH}` },
    encoding: 'utf8',
    timeout: 10000,
  };

  const initialized = spawnSync('hobkin', ['init', '--home', home], options);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(existsSync(join(home, 'config.json')), true);
  assert.ok(initialized.stdout.length > 0);

  const rejected = spawnSync('hobkin', ['invalid-command', '--home', home], options);
  assert.equal(rejected.status, 1);
  assert.ok(rejected.stderr.length > 0);
});

test('the dashboard holds one owner until a signal, then closes and removes handlers', async t => {
  const h = fixture(t, true);
  const started = Promise.withResolvers();
  let closes = 0;
  const work = main(['--home', h.root], h.output, {
    signals: h.signals,
    input: { isTTY: true },
    startDashboard: () => ({ update() {}, stop() {} }),
    openApplication: async () => {
      started.resolve();
      return { close: async () => { closes++; } };
    },
  });

  await started.promise;
  await new Promise(resolve => setImmediate(resolve));
  h.signals.emit('SIGTERM');

  assert.equal(await work, 0);
  assert.equal(closes, 1);
  assert.equal(h.signals.listenerCount('SIGTERM'), 0);
  assert.equal(h.signals.listenerCount('SIGINT'), 0);
});

function quittingWith(h, agents, answer) {
  const closes = [];
  const asked = [];
  const opened = Promise.withResolvers();
  const work = main(['--home', h.root], h.output, {
    signals: h.signals,
    input: { isTTY: true },
    startDashboard: (_view, handlers) => {
      opened.resolve(handlers);
      return { update() {}, askQuestion: async request => { asked.push(request); return answer; }, stop() {} };
    },
    openApplication: async () => ({ agentsAtWork: () => agents, close: async options => { closes.push(options); } }),
  });
  return { work, opened: opened.promise, closes, asked };
}
const applicationOpen = () => new Promise(resolve => setImmediate(resolve));

test('quitting with agents at work asks, and letting them finish leaves them going', async t => {
  const h = fixture(t, true);
  const { work, opened, closes, asked } = quittingWith(h, 2, 'finish');
  const handlers = await opened;
  await applicationOpen();

  await handlers.onQuit();
  await work;

  assert.match(asked[0].question, /You are quitting, and 2 agents are still working/);
  assert.deepEqual(asked[0].choices.map(({ value }) => value), ['finish', 'stop']);
  assert.deepEqual(closes, [{ letFinish: true }]);
});

test('stopping them closes as it always did, and Esc stays open', async t => {
  const stopping = fixture(t, true);
  const stopped = quittingWith(stopping, 1, 'stop');
  const handlers = await stopped.opened;
  await applicationOpen();
  await handlers.onQuit();
  await stopped.work;
  assert.deepEqual(stopped.closes, [{ letFinish: false }]);
  assert.match(stopped.asked[0].question, /1 agent is still working. Stop it or let it finish/);

  const staying = fixture(t, true);
  const stayed = quittingWith(staying, 1, null);
  const kept = await stayed.opened;
  await applicationOpen();
  await kept.onQuit();
  assert.deepEqual(stayed.closes, [], 'Esc keeps hobkin open');
  staying.signals.emit('SIGTERM');
  await stayed.work;
  assert.deepEqual(stayed.closes, [{ letFinish: true }], 'a signal cannot be asked, and leaving them going loses nothing');
});

test('with no agent at work a quit asks nothing', async t => {
  const h = fixture(t, true);
  const { work, opened, closes, asked } = quittingWith(h, 0, 'stop');
  const handlers = await opened;
  await applicationOpen();

  await handlers.onQuit();
  await work;

  assert.deepEqual(asked, []);
  assert.deepEqual(closes, [{ letFinish: false }]);
});

test('connected command exits the process only after the application has closed', async t => {
  const h = fixture(t, true);
  const started = Promise.withResolvers();
  const steps = [];
  const work = main(['--home', h.root], h.output, {
    signals: h.signals,
    input: { isTTY: true },
    startDashboard: () => ({ update() {}, stop() {} }),
    exit: code => { steps.push(`exit ${code}`); },
    openApplication: async () => {
      started.resolve();
      return {
        close: async () => {
          await Promise.resolve();
          steps.push('closed');
        },
      };
    },
  });

  await started.promise;
  h.signals.emit('SIGINT');
  await work;

  assert.deepEqual(steps, ['closed', 'exit 0']);
});

test('quitting during startup exits cleanly without waiting for the connection', async t => {
  const h = fixture(t, true);
  const started = Promise.withResolvers();
  const connecting = Promise.withResolvers();
  const exits = [];
  const work = main(['--home', h.root], h.output, {
    signals: h.signals,
    input: { isTTY: true },
    startDashboard: () => ({ update() {}, stop() {} }),
    exit: code => { exits.push(code); },
    openApplication: () => {
      started.resolve();
      return connecting.promise;
    },
  });

  await started.promise;
  h.signals.emit('SIGINT');

  assert.equal(await work, 0);
  assert.deepEqual(exits, [0]);

  const closed = Promise.withResolvers();
  connecting.resolve({ close: async () => { closed.resolve(); } });
  await closed.promise;
});

test('a connection that fails after a quit stays silent', async t => {
  const h = fixture(t, true);
  const started = Promise.withResolvers();
  const connecting = Promise.withResolvers();
  const work = main(['--home', h.root], h.output, {
    signals: h.signals,
    input: { isTTY: true },
    startDashboard: () => ({ update() {}, stop() {} }),
    openApplication: () => {
      started.resolve();
      return connecting.promise;
    },
  });

  await started.promise;
  h.signals.emit('SIGINT');
  assert.equal(await work, 0);

  connecting.reject(Error('This operation was aborted'));
  await new Promise(resolve => setImmediate(resolve));
});

test('a new home signs in before the dashboard, then starts setup once the chat is ready', async t => {
  const h = fixture(t, true);
  const steps = [];

  await main(['--home', h.root], h.output, {
    signals: h.signals,
    input: { isTTY: true },
    signIn: async () => { steps.push('sign in'); },
    startDashboard: () => {
      steps.push('dashboard');
      return {
        update() {},
        stop() {},
        startSetup() {
          steps.push('setup');
          h.signals.emit('SIGTERM');
        },
      };
    },
    openApplication: async () => {
      steps.push('open');
      return { close: async () => {} };
    },
  });

  assert.deepEqual(steps, ['sign in', 'dashboard', 'open', 'setup']);
});

test('hobkin login signs in on request, and only in a terminal', async t => {
  const h = fixture(t, true);
  const requests = [];
  const signIn = async request => { requests.push(request); };

  assert.equal(await main(['login', '--home', h.root], h.output, { input: { isTTY: true }, signIn }), 0);
  await assert.rejects(main(['login', '--home', h.root], { isTTY: false, write() {} }, { input: { isTTY: true }, signIn }), /needs a terminal/);

  assert.deepEqual(requests, [{ always: true }]);
});

test('a home with a name saved does not start setup by itself', async t => {
  const h = fixture(t, true);
  setProfile(h.root, 'call', 'Ada');
  let started = 0;

  await main(['--home', h.root], h.output, {
    signals: h.signals,
    input: { isTTY: true },
    signIn: async () => {},
    startDashboard: () => ({ update() {}, stop() {}, startSetup() { started++; } }),
    openApplication: async () => {
      setImmediate(() => h.signals.emit('SIGTERM'));
      return { close: async () => {} };
    },
  });

  assert.equal(started, 0);
});

test('dashboard paints before connection, wires sends and restores terminal on startup failure', async t => {
  const h = fixture(t, true);
  let painted = false;
  let stopped = false;

  await assert.rejects(main(['--home', h.root], h.output, {
    signals: h.signals,
    input: { isTTY: true },
    startDashboard: (view, handlers, options) => {
      painted = true;
      assert.equal(view.connection, 'offline');
      assert.equal(typeof handlers.send, 'function');
      assert.equal(options.theme.cwd, view.config.main.cwd);
      return { update() {}, askQuestion: request => request.choices[0].value, stop() { stopped = true; } };
    },
    openApplication: async (_root, options) => {
      assert.equal(painted, true);
      assert.equal(await options.askQuestion({ choices: [{ value: 'keep' }] }), 'keep');
      throw Error('Synthetic startup failure');
    },
  }), /Synthetic startup failure/);

  assert.equal(stopped, true);
  assert.equal(h.signals.listenerCount('SIGTERM'), 0);
});

test('interactive dashboard wiring persists clear state through the activated root', async t => {
  const h = fixture(t, true);
  const started = Promise.withResolvers();
  let handlers;
  const work = main(['--home', h.root], h.output, {
    signals: h.signals,
    input: { isTTY: true },
    startDashboard: (_view, next) => {
      handlers = next;
      started.resolve();
      return { update() {}, stop() {} };
    },
    openApplication: async () => ({ close: async () => {} }),
  });

  await started.promise;
  assert.deepEqual((await handlers.clear(['visible'])).hiddenMessageIds, ['visible']);
  assert.deepEqual(readPresentationState(h.root).hiddenMessageIds, ['visible']);
  h.signals.emit('SIGTERM');
  assert.equal(await work, 0);
});

test('interactive pasting goes through the connected application, and images go out with their message', async t => {
  const h = fixture(t, true);
  const started = Promise.withResolvers();
  const connecting = Promise.withResolvers();
  const calls = [];
  let handlers;
  const work = main(['--home', h.root], h.output, {
    signals: h.signals,
    input: { isTTY: true },
    startDashboard: (_view, next) => {
      handlers = next;
      started.resolve();
      return { update() {}, stop() {} };
    },
    openApplication: async () => {
      await connecting.promise;
      return {
        close: async () => {},
        pasteImage: () => calls.push('paste'),
        dropImages: images => calls.push(images),
        send: (...sent) => calls.push(sent),
      };
    },
  });

  await started.promise;
  assert.throws(() => handlers.pasteImage(), /connecting/);
  connecting.resolve();
  await new Promise(resolve => setImmediate(resolve));
  handlers.pasteImage();
  handlers.dropImages(['one']);
  handlers.send('look', null, ['one']);

  assert.deepEqual(calls, ['paste', ['one'], ['look', null, ['one']]]);
  h.signals.emit('SIGTERM');
  assert.equal(await work, 0);
});

test('interactive reset awaits the connected application and refreshes the dashboard', async t => {
  const h = fixture(t, true);
  const started = Promise.withResolvers();
  const resetStarted = Promise.withResolvers();
  const releaseReset = Promise.withResolvers();
  const updates = [];
  let handlers;
  const work = main(['--home', h.root], h.output, {
    signals: h.signals,
    input: { isTTY: true },
    startDashboard: (_view, next) => {
      handlers = next;
      started.resolve();
      return { update: view => updates.push(view), stop() {} };
    },
    openApplication: async (_root, options) => ({
      async reset() {
        resetStarted.resolve();
        await releaseReset.promise;
        const view = { connection: 'connected', refreshed: true };
        options.onChange(view);
        return { sessionId: 'fresh-session' };
      },
      async close() {},
    }),
  });
  t.after(async () => {
    releaseReset.resolve();
    h.signals.emit('SIGTERM');
    await work;
  });

  await started.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof handlers.reset, 'function');

  let completed = false;
  const reset = handlers.reset().then(result => {
    completed = true;
    return result;
  });
  await resetStarted.promise;
  assert.equal(completed, false);
  releaseReset.resolve();
  assert.deepEqual(await reset, { sessionId: 'fresh-session' });
  assert.equal(completed, true);
  assert.ok(updates.some(view => view.refreshed));

  h.signals.emit('SIGTERM');
  assert.equal(await work, 0);
});

test('interactive dashboard cancellation delegates outcomes to the connected application', async t => {
  const h = fixture(t, true);
  const started = Promise.withResolvers();
  const requested = [];
  let handlers;
  const work = main(['--home', h.root], h.output, {
    signals: h.signals,
    input: { isTTY: true },
    startDashboard: (_view, next) => {
      handlers = next;
      started.resolve();
      return { update() {}, stop() {} };
    },
    openApplication: async () => ({
      kill: async runId => {
        requested.push(runId);
        if (runId === 'error') throw Error('Cancellation unavailable.');
        return runId === 'live-job';
      },
      async close() {},
    }),
  });

  await started.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await handlers.kill('live-job'), true);
  assert.equal(await handlers.kill('stale-job'), false);
  await assert.rejects(handlers.kill('error'), /Cancellation unavailable/);
  assert.deepEqual(requested, ['live-job', 'stale-job', 'error']);
  h.signals.emit('SIGTERM');
  assert.equal(await work, 0);
});

test('interactive dashboard reaches learning through the connected application and says when it is still connecting', async t => {
  const h = fixture(t, true);
  const started = Promise.withResolvers();
  const connecting = Promise.withResolvers();
  let handlers;
  const work = main(['--home', h.root], h.output, {
    signals: h.signals,
    input: { isTTY: true },
    startDashboard: (_view, next) => {
      handlers = next;
      started.resolve();
      return { update() {}, stop() {} };
    },
    openApplication: () => connecting.promise,
  });
  t.after(async () => {
    h.signals.emit('SIGTERM');
    await work;
  });

  await started.promise;
  assert.throws(() => handlers.toggleLearning(), /hobkin is still connecting\./);

  connecting.resolve({ toggleLearning: async () => ({ enabled: true }), async close() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await handlers.toggleLearning(), { enabled: true });
});

test('plain status never opens an application even on a TTY', async t => {
  const h = fixture(t, true);
  const code = await main(['status', '--plain', '--home', h.root], h.output, {
    input: { isTTY: true },
    openApplication: () => { throw Error('Must not open'); },
  });

  assert.equal(code, 0);
  assert.match(h.output.text, /Main not connected/);
});

test('plain status shows the main binding and a configured launcher', async t => {
  const h = fixture(t);
  const file = join(h.root, 'config.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({
    ...config,
    main: { ...config.main, model: 'provider/main-model', effort: 'low' },
    launcher: { command: ['my-pi-launcher', 'pi'], env: { EXAMPLE_MODE: '1' }, managedExtensions: true },
  }));
  assert.equal(await main(['status', '--plain', '--home', h.root], h.output), 0);
  assert.match(h.output.text, new RegExp(`Main low \u00b7 provider/main-model \u00b7 ${h.root}`));
  assert.match(h.output.text, /Launcher my-pi-launcher pi \u00b7 managed extensions/);
});

test('reports lists the whole inventory and delete removes only known reports', async t => {
  const h = fixture(t);
  const report = (id, at) => ({ id, title: id, body: `Body ${id}`, at, outcome: 'completed' });
  mkdirSync(join(h.root, 'runtime'), { mode: 0o700 });
  writeFileSync(join(h.root, 'runtime/view.json'), JSON.stringify({
    version: 1,
    reports: [
      report('check:2026-01-01', '2026-01-01T09:00:00Z'),
      report('check:2026-01-08', '2026-01-08T09:00:00Z'),
    ],
  }));

  assert.equal(await main(['reports', '--home', h.root], h.output), 0);
  const listed = JSON.parse(h.output.text).map(item => item.id);
  assert.deepEqual(listed, ['check:2026-01-08', 'check:2026-01-01']);

  const withUnknown = main(['reports', 'delete', 'check:2026-01-01', 'missing', '--home', h.root], h.output);
  await assert.rejects(withUnknown, /missing/);

  h.output.text = '';
  assert.equal(await main(['reports', 'delete', 'check:2026-01-01', '--home', h.root], h.output), 0);
  assert.deepEqual(JSON.parse(h.output.text), { deleted: ['check:2026-01-01'], before: 2, after: 1 });

  await assert.rejects(main(['status', 'extra', '--home', h.root], h.output), /Unknown/);
});

test('hobkin pending prints what is waiting as JSON and changes nothing', async t => {
  const h = fixture(t);
  fileDecision(h.root, { from: 'Routine mail', question: 'Reply to the bank?', choices: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] });
  const files = () => readdirSync(h.root, { recursive: true }).toSorted();
  const before = files();

  assert.equal(await main(['pending', '--home', h.root], h.output), 0);

  assert.deepEqual(JSON.parse(h.output.text).groups.map(({ name, count, label }) => [name, count, label]), [['questions', 1, 'question']]);
  assert.equal(JSON.parse(h.output.text).total, 1);
  assert.deepEqual(files(), before);
});

test('hobkin pending drops a launch that went wrong once its fix has landed', async t => {
  const h = fixture(t);
  chooseProject(h.root, '/repos/api', 'important');
  recordLaunch(h.root, 'api', { item: 'abc', stage: 'closed', outcome: 'trouble', note: 'new error' });
  const fix = fileItem(h.root, 'api', { key: 'trouble:abc', kind: 'fix', title: 'Fix it', brief: 'Evidence and first change.', causedBy: 'abc' });

  await main(['pending', '--home', h.root], h.output);
  assert.equal(JSON.parse(h.output.text).total, 1);

  updateItem(h.root, 'api', fix.id, { state: 'merged' });
  h.output.text = '';
  await main(['pending', '--home', h.root], h.output);
  assert.equal(JSON.parse(h.output.text).total, 0);
});

test('hobkin pending counts a launch that went wrong', async t => {
  const h = fixture(t);
  chooseProject(h.root, '/repos/api', 'important');
  recordLaunch(h.root, 'api', { item: 'abc', stage: 'live', outcome: 'trouble', note: 'new error' });
  recordLaunch(h.root, 'api', { item: 'def', stage: 'live', outcome: 'held' });

  assert.equal(await main(['pending', '--home', h.root], h.output), 0);

  assert.deepEqual(JSON.parse(h.output.text).groups, [{ name: 'wrong', count: 1, label: 'went wrong', fact: 'api, new error' }]);
});
const readConfig = root => JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));

test('hobkin learning says where it stands in words, and on and off change only that in the chosen home', async t => {
  const h = fixture(t);
  const before = readConfig(h.root);
  const learning = async (...args) => {
    h.output.text = '';
    assert.equal(await main(['learning', ...args, '--home', h.root], h.output), 0);
    return h.output.text;
  };

  assert.match(await learning(), /^Learning is off\./);
  assert.deepEqual(JSON.parse(await learning('on')), { enabled: true });
  assert.match(await learning(), /^Learning is on\./);
  assert.deepEqual(readConfig(h.root), { ...before, learning: { enabled: true } });

  assert.deepEqual(JSON.parse(await learning('off')), { enabled: false });
  assert.match(await learning(), /^Learning is off\./);
  assert.deepEqual(readConfig(h.root), { ...before, learning: { enabled: false } });
});

test('hobkin learning refuses what it does not know and changes nothing', async t => {
  const h = fixture(t);
  const before = readConfig(h.root);

  for (const args of [['maybe'], ['ON'], ['on', 'off'], ['clear'], ['answer', 'abc123']]) {
    await assert.rejects(main(['learning', ...args, '--home', h.root], h.output), /^Error: Usage: hobkin learning/);
  }

  assert.deepEqual(readConfig(h.root), before);
});

test('the usage names hobkin learning', async t => {
  const h = fixture(t);

  await main(['--help'], h.output);

  assert.match(h.output.text, /learning \[on \| off \| clear <id> \| clear all \| answer <id> yes\|later\|no\]/);
});
