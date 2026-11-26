import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, symlinkSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialize } from '../src/cli/config.mjs';
import { main } from '../src/cli/main.mjs';
import { fileDecision } from '../src/cli/decisions.mjs';
import { chooseProject, fileItem, recordLaunch, updateItem } from '../src/cli/work/store.mjs';

function fixture(t, isTTY = false) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-main-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initialize(root, { cwd: root });
  const output = { isTTY, text: '', write(text) { this.text += text; } };
  return { root, output };
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

test('a new default workspace is created without touching legacy data', t => {
  const { home, root } = freshHome(t);
  const legacy = join(home, '.pi/agent/hobkin');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, 'state.json'), '{"legacy":"preserved"}');

  // The app creates a missing home this way (host/src/owner.ts, prepareHome).
  initialize(root, { cwd: root });
  const config = readFileSync(join(root, 'config.json'), 'utf8');
  assert.equal(JSON.parse(config).version, 2);
  initialize(root, { cwd: root });
  assert.equal(readFileSync(join(root, 'config.json'), 'utf8'), config);
  for (const cadence of ['daily', 'weekly', 'monthly']) {
    assert.equal(existsSync(join(root, 'routines', cadence)), true);
  }
  assert.equal(readFileSync(join(legacy, 'state.json'), 'utf8'), '{"legacy":"preserved"}');
  assert.equal(existsSync(`${legacy}-control`), false);
  assert.equal(existsSync(join(root, 'migration')), false);
});

test('finite reads do not initialize, and a status cannot bypass an incomplete migration', async t => {
  const { root } = freshHome(t);
  const dependencies = { input: { isTTY: true } };
  for (const [args, isTTY] of [[[], false], [[], true], [['--plain'], true], [['routines'], true], [['schedules'], true]]) {
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

test('status prints the saved state on a TTY too, with or without --plain', async t => {
  const h = fixture(t, true);
  for (const args of [['status'], ['status', '--plain'], []]) {
    h.output.text = '';
    assert.equal(await main([...args, '--home', h.root], h.output, { input: { isTTY: true } }), 0);
    assert.match(h.output.text, /Main not connected/);
  }
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

test('version, --version and -v print the version in package.json, and the usage starts with it', async t => {
  const h = fixture(t);
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  for (const args of [['version'], ['--version'], ['-v']]) assert.equal(await main(args, h.output), 0);
  assert.equal(h.output.text, `hobkin ${version}\n`.repeat(3));

  await main(['--help'], h.output);
  assert.match(h.output.text, new RegExp(`hobkin ${version.replaceAll('.', '\\.')}\\nUsage: hobkin`));
});
