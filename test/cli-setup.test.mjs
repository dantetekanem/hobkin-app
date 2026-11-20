import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { failureLine, main } from '../src/cli/main.mjs';
import { formatSetup, setupChecks, setupGuide } from '../src/cli/setup.mjs';

const { engines, peerDependencies } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const piPackage = '@earendil-works/pi-coding-agent';
const pinned = peerDependencies[piPackage];
const minimumNode = engines.node.replace('>=', '');

const modelTable = [
  'provider    model           context  max-out  thinking  images',
  'anthropic   claude-x        1M       64K      yes       yes',
  'openrouter  vendor/model-y  1M       64K      yes       no',
  '',
].join('\n');

const installed = {
  'pi --version': `${pinned}\n`,
  'pi --no-approve --list-models': modelTable,
  'git --version': 'git version 2.50.1 (Apple Git-155)\n',
  'hobkin --help': 'Hobkin\nUsage: hobkin [command] [options]\n',
  'gh auth status': 'github.com\n  Logged in to github.com account someone\n',
  'qmd --version': 'qmd 2.1.0\n',
  'pi list': 'User packages:\n  npm:pi-coder\n',
};

const absent = Object.assign(Error('spawn ENOENT'), { code: 'ENOENT' });
const broken = Object.assign(Error('Command failed'), { code: 1 });

/** Answers as the named tools would, and keeps every command, so a check cannot run something new unseen. */
function fakeTools(changes = {}) {
  const calls = [];
  const exec = async (command, args) => {
    const call = [command, ...args].join(' ');
    calls.push(call);
    const answer = { ...installed, ...changes }[call];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw Error(`Unexpected command: ${call}`);
    return answer;
  };
  return { exec, calls };
}

const everyToolIs = answer => Object.fromEntries(Object.keys(installed).map(call => [call, answer]));

function emptyHome(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-setup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function home(t, change = {}) {
  const root = emptyHome(t);
  initialize(root, { cwd: root });
  const file = join(root, 'config.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...change }));
  return root;
}

const addSchedule = (root, id, enabled) => writeFileSync(join(root, 'routines', 'daily', `${id}.md`), `---\n${JSON.stringify({
  id, title: id, at: '09:00', timezone: 'UTC', enabled, harness: 'pi', model: null, effort: 'medium', cwd: root, context: [],
})}\n---\nCheck something.\n`);

const java21 = { path: '/jdk/bin/java', version: '21.0.2', major: 21 };
/** What the proof tools look like to setup, without running Java. */
const proofToolsAre = ({ java = java21, jar = '/home/.hobkin/tools/tla/tla2tools.jar', tlapm = null } = {}) => async () => ({ java, jar, tlapm });

async function checks(root, { tools, ...options } = {}) {
  const rows = await setupChecks(root, { exec: fakeTools(tools).exec, nodeVersion: minimumNode, piSdkVersion: pinned, proofTools: proofToolsAre(), ...options });
  return Object.fromEntries(rows.map(row => [row.name, row]));
}

const chatUses = model => ({ main: { cwd: '/tmp', model, effort: 'medium' } });
const checksUse = model => ({ background: { harness: 'pi', model, effort: 'medium' } });
const startedByLauncher = { launcher: { command: ['my-pi-launcher', 'pi'] } };

test('the two failures a new person meets first point at hobkin setup', () => {
  const missing = Object.assign(Error('ENOENT: no such file, lstat /home/.hobkin/config.json'), { code: 'ENOENT', path: '/home/.hobkin/config.json' });

  assert.equal(failureLine(missing), 'Hobkin: This folder has no Hobkin workspace yet.\nRun hobkin setup to see what is missing and how to fix it.\n');
  assert.match(failureLine(Error('No models available. Use /login to log into a provider.')), /^Hobkin: No models available.*\nRun hobkin setup/s);
  assert.equal(failureLine(Error('Schedule changed.')), 'Hobkin: Schedule changed.\n');
});

test('a ready machine reads as ok, and setup only asks tools about themselves', async t => {
  const root = home(t);
  addSchedule(root, 'morning', true);
  const { exec, calls } = fakeTools();
  const rows = await setupChecks(root, {
    exec,
    nodeVersion: minimumNode,
    piSdkVersion: pinned,
    proofTools: proofToolsAre(),
  });

  assert.deepEqual(rows.filter(row => row.state !== 'ok'), []);
  const optionalRows = rows.slice(-3);
  assert.deepEqual(optionalRows.map(row => row.name), ['qmd', 'pi-coder', 'tlc']);
  assert.ok(optionalRows.every(row => row.group === 'optional'));
  assert.ok(rows.slice(0, -3).every(row => row.group === 'needed'));
  assert.deepEqual(calls.toSorted(), [
    'gh auth status',
    'git --version',
    'hobkin --help',
    'pi --no-approve --list-models',
    'pi --version',
    'pi list',
    'qmd --version',
  ]);
});

test('Pi: missing, on the pinned version, or on another version', async t => {
  const root = home(t);

  const ready = (await checks(root)).Pi;
  assert.equal(ready.state, 'ok');
  assert.match(ready.detail, new RegExp(pinned.replaceAll('.', '\\.')));

  const notThere = (await checks(root, { tools: { 'pi --version': absent } })).Pi;
  assert.equal(notThere.state, 'missing');
  assert.ok(notThere.fix.includes(`npm install -g --ignore-scripts ${piPackage}@${pinned}`));

  for (const other of ['0.9.0', '99.0.0']) {
    const wrong = (await checks(root, { tools: { 'pi --version': `${other}\n` } })).Pi;
    assert.equal(wrong.state, 'missing');
    assert.ok(wrong.detail.includes(other) && wrong.detail.includes(pinned));
    assert.ok(wrong.fix.includes(`${piPackage}@${pinned}`), 'names the exact version to install');
    assert.match(wrong.fix, /pi update/, 'warns that Pi\'s own update leaves the pin');
    assert.match(wrong.fix, /launcher/, 'says how to run a patched Pi');
  }
});

test('Pi: a tool that runs and says nothing useful is not called absent', async t => {
  const root = home(t);
  for (const answer of ['no version here\n', broken]) {
    const row = (await checks(root, { tools: { 'pi --version': answer } })).Pi;
    assert.equal(row.state, 'missing');
    assert.doesNotMatch(row.detail, /not on your PATH/);
  }
});

test('Pi: Hobkin\'s own copy must match too, because the main chat runs on it', async t => {
  const row = (await checks(home(t), { piSdkVersion: '0.9.0' })).Pi;
  assert.equal(row.state, 'missing');
  assert.ok(row.detail.includes('0.9.0'));
  assert.match(row.fix, /pnpm install/);
  assert.equal((await checks(home(t), { piSdkVersion: null })).Pi.state, 'missing');
});

test('Pi: a launcher starts every Pi, so it is asked and its own copy does not count', async t => {
  const root = home(t, startedByLauncher);
  const tools = {
    'my-pi-launcher pi --version': `${pinned}\n`,
    'my-pi-launcher pi --no-approve --list-models': modelTable,
    'pi --version': absent,
    'pi --no-approve --list-models': absent,
  };
  const rows = await checks(root, { tools, piSdkVersion: null });
  assert.equal(rows.Pi.state, 'ok');
  assert.equal(rows['Chat model'].state, 'ok');

  const other = (await checks(root, { tools: { ...tools, 'my-pi-launcher pi --version': '99.0.0\n' } })).Pi;
  assert.equal(other.state, 'missing');
  assert.match(other.fix, /my-pi-launcher pi/);

  const gone = (await checks(root, { tools: { ...tools, 'my-pi-launcher pi --version': absent } })).Pi;
  assert.ok(gone.detail.includes('my-pi-launcher'));
});

test('Node is compared with engines by number, not by text', async t => {
  const root = home(t);
  const [major, minor] = minimumNode.split('.').map(Number);
  const longerMinor = `${major}.${minor + 81}.0`;
  const longerMajor = `${major + 78}.0.0`;

  for (const newEnough of [minimumNode, longerMinor, longerMajor]) {
    assert.equal((await checks(root, { nodeVersion: newEnough })).Node.state, 'ok', newEnough);
  }

  const older = `${major}.${minor - 1}.9`;
  const row = (await checks(root, { nodeVersion: older })).Node;
  assert.equal(row.state, 'missing');
  assert.ok(row.detail.includes(older) && row.detail.includes(minimumNode));
  assert.ok(row.fix);
});

test('git: installed or not', async t => {
  const root = home(t);
  assert.equal((await checks(root)).git.state, 'ok');
  const row = (await checks(root, { tools: { 'git --version': absent } })).git;
  assert.equal(row.state, 'missing');
  assert.ok(row.fix);
});

test('the hobkin command: agents need it on their path', async t => {
  const root = home(t);
  assert.equal((await checks(root)).hobkin.state, 'ok');
  const row = (await checks(root, { tools: { 'hobkin --help': absent } })).hobkin;
  assert.equal(row.state, 'missing');
  assert.match(row.fix, /pnpm add -g \./);
});

test('gh: signed in, signed out or not installed, and it says other hosts work without it', async t => {
  const root = home(t);

  const ready = (await checks(root)).gh;
  assert.equal(ready.state, 'ok');

  const signedOut = (await checks(root, { tools: { 'gh auth status': broken } })).gh;
  assert.equal(signedOut.state, 'missing');
  assert.match(signedOut.fix, /gh auth login/);

  const notThere = (await checks(root, { tools: { 'gh auth status': absent } })).gh;
  assert.equal(notThere.state, 'missing');
  assert.match(notThere.fix, /cli\.github\.com/);

  for (const row of [ready, signedOut, notThere]) {
    assert.match(row.detail, /work mode/i);
    assert.match(row.detail, /GitHub PRs/);
    assert.match(row.detail, /another host/);
  }
});

test('models: Pi\'s default counts once Pi has a model', async t => {
  const rows = await checks(home(t));
  for (const name of ['Chat model', 'Checks model']) {
    assert.equal(rows[name].state, 'ok');
    assert.match(rows[name].detail, /Pi's default/);
  }
});

test('models: a saved model must be one Pi can use', async t => {
  const usable = await checks(home(t, { ...chatUses('anthropic/claude-x'), ...checksUse('openrouter/vendor/model-y') }));
  assert.equal(usable['Chat model'].state, 'ok');
  assert.match(usable['Chat model'].detail, /anthropic\/claude-x/);
  assert.equal(usable['Checks model'].state, 'ok');

  const unusable = await checks(home(t, { ...chatUses('anthropic/gone'), ...checksUse('openai/also-gone') }));
  assert.equal(unusable['Chat model'].state, 'missing');
  assert.match(unusable['Chat model'].detail, /anthropic\/gone/);
  assert.match(unusable['Chat model'].fix, /main\.model/);
  assert.equal(unusable['Checks model'].state, 'missing');
  assert.match(unusable['Checks model'].fix, /background\.model/);

  const shortName = await checks(home(t, chatUses('opus')));
  assert.equal(shortName['Chat model'].state, 'ok', 'Pi matches a short name itself');
});

test('models: no credentials, no Pi, or a Pi that cannot list them', async t => {
  const root = home(t);

  const none = 'No models available. Use /login to log into a provider via OAuth or API key. See:\n  /a path/docs/providers.md\n  /a path/docs/models.md\n';
  const signedOut = await checks(root, { tools: { 'pi --no-approve --list-models': none } });
  for (const name of ['Chat model', 'Checks model']) {
    assert.equal(signedOut[name].state, 'missing');
    assert.match(signedOut[name].fix, /\/login/);
  }

  const noPi = await checks(root, { tools: { 'pi --no-approve --list-models': absent } });
  assert.equal(noPi['Chat model'].state, 'missing');
  assert.match(noPi['Chat model'].fix, /Install Pi first/);

  const stuck = await checks(root, { tools: { 'pi --no-approve --list-models': broken } });
  assert.equal(stuck['Checks model'].state, 'missing');
  assert.match(stuck['Checks model'].fix, /pi --list-models/);
});

test('schedules: none, none enabled, or some running', async t => {
  const root = home(t);

  const none = (await checks(root)).Routines;
  assert.equal(none.state, 'missing');
  assert.match(none.fix, /routine-setup\.md/, 'points at the guide');

  addSchedule(root, 'morning', false);
  const paused = (await checks(root)).Routines;
  assert.equal(paused.state, 'missing');
  assert.match(paused.detail, /1 routine, none enabled/);

  addSchedule(root, 'evening', true);
  const running = (await checks(root)).Routines;
  assert.equal(running.state, 'ok');
  assert.match(running.detail, /2 routines, 1 enabled/);
  assert.equal(running.fix, null);
});

test('schedules: a file that cannot be read is counted and pointed at', async t => {
  const root = home(t);
  addSchedule(root, 'evening', true);
  writeFileSync(join(root, 'routines', 'daily', 'broken.md'), 'not a schedule');
  const row = (await checks(root)).Routines;
  assert.equal(row.state, 'ok');
  assert.match(row.detail, /1 file could not be read/);
  assert.match(row.fix, /hobkin routines/);
});

test('qmd is optional: search works with it and agents read files without it', async t => {
  const root = home(t);
  assert.equal((await checks(root)).qmd.state, 'ok');
  const row = (await checks(root, { tools: { 'qmd --version': absent } })).qmd;
  assert.equal(row.state, 'optional');
  assert.match(row.fix, /npm install -g @tobilu\/qmd/);
});

test('pi-coder is optional: it is how a local PR\'s diff opens, and setup says how to get it', async t => {
  const root = home(t);
  assert.equal((await checks(root))['pi-coder'].state, 'ok');

  const row = (await checks(root, { tools: { 'pi list': 'User packages:\n  npm:pi-other\n' } }))['pi-coder'];

  assert.equal(row.state, 'optional');
  assert.match(row.fix, /pi install npm:pi-coder/);
});

test('tlc is optional: it needs Java and the pinned jar, and setup says how to get each', async t => {
  const root = home(t);
  const ready = (await checks(root)).tlc;
  assert.equal(ready.state, 'ok');
  assert.match(ready.detail, /TLC 1\.7\.4 on Java 21\.0\.2/);
  assert.doesNotMatch(ready.detail, /TLAPS/);
  assert.match((await checks(root, { proofTools: proofToolsAre({ tlapm: '/usr/local/bin/tlapm' }) })).tlc.detail, /TLAPS is here too/);

  const noJava = (await checks(root, { proofTools: proofToolsAre({ java: { path: null, problem: 'Java is not installed. TLC needs Java 11 or newer.' } }) })).tlc;
  assert.equal(noJava.state, 'optional');
  assert.match(noJava.detail, /^Java is not installed/);
  assert.match(noJava.fix, /adoptium\.net.*hobkin proof setup/);

  const noJar = (await checks(root, { proofTools: proofToolsAre({ jar: null }) })).tlc;
  assert.equal(noJar.state, 'optional');
  assert.match(noJar.detail, /Java 21\.0\.2 is here, but not TLC/);
  assert.match(noJar.fix, /hobkin proof setup/);
});

test('a tool that is missing or broken never throws', async t => {
  const everyRow = ['Pi', 'Node', 'git', 'hobkin', 'gh', 'Chat model', 'Checks model', 'Routines', 'qmd', 'pi-coder', 'tlc'];

  for (const answer of [absent, broken]) {
    const rows = await checks(home(t), { tools: everyToolIs(answer) });

    assert.deepEqual(Object.keys(rows), everyRow);
    const gaps = Object.values(rows).filter(row => row.state !== 'ok');
    assert.ok(gaps.every(row => row.detail && row.fix), 'every gap says what is wrong and what to do');
  }
});

test('a broken optional tool is not called absent', async t => {
  const rows = await checks(home(t), { tools: { 'qmd --version': broken, 'git --version': broken } });
  for (const name of ['qmd', 'git']) assert.doesNotMatch(rows[name].detail, /Not installed/, name);
});

test('a home that does not exist yet is reported and left alone', async t => {
  const notCreated = join(emptyHome(t), 'new');

  const rows = await checks(notCreated);

  assert.equal(rows.Routines.state, 'missing');
  assert.equal(rows['Chat model'].state, 'ok');
  assert.equal(existsSync(notCreated), false);
});

test('a damaged home is a row of its own, not a crash', async t => {
  const root = emptyHome(t);
  writeFileSync(join(root, 'config.json'), '{ not json');
  const rows = await checks(root);
  assert.equal(rows['Hobkin folder'].state, 'missing');
  assert.equal(rows['Hobkin folder'].group, 'needed');
  assert.ok(rows['Hobkin folder'].fix);

  const interrupted = emptyHome(t);
  mkdirSync(join(interrupted, 'migration'));
  assert.match((await checks(interrupted))['Hobkin folder'].detail, /Migration is incomplete/);
});

test('the report groups needed and optional rows, and names the guide last', () => {
  const rows = [
    { name: 'Pi', state: 'missing', detail: 'Not there.', fix: 'Install it.', group: 'needed' },
    { name: 'Node', state: 'ok', detail: '26.0.0.', fix: null, group: 'needed' },
    { name: 'pi-coder', state: 'optional', detail: 'Adds diffs.', fix: 'Get it.', group: 'optional' },
    { name: 'qmd', state: 'ok', detail: 'Has search.', fix: 'Type /help.', group: 'optional' },
  ];

  const text = formatSetup('/some/home', rows);

  const [neededPart, optionalPart] = text.split('\nOptional\n');
  assert.match(neededPart, /\/some\/home/);
  assert.match(neededPart, /\nNeeded\n {2}missing\s+Pi: Not there\.\n\s+Fix: Install it\.\n {2}ok\s+Node: 26\.0\.0\.\n/);
  assert.match(optionalPart, /^ {2}optional\s+pi-coder: Adds diffs\.\n\s+To add: Get it\.\n {2}ok\s+qmd: Has search\.\n\s+Next: Type \/help\.\n/);
  assert.match(optionalPart, /1 needed thing is missing/);
  assert.equal(text.trimEnd().split('\n').at(-1), `Setup guide: ${setupGuide}`);

  assert.match(formatSetup('/some/home', rows.slice(1)), /Everything needed is ready/);
});

test('the guide the report names is there to read', () => {
  assert.ok(existsSync(setupGuide));
});

test('hobkin setup is a report: it exits 0 with things missing, and changes nothing', async t => {
  const root = emptyHome(t);
  const output = { text: '', write(text) { this.text += text; } };
  const { exec } = fakeTools(everyToolIs(absent));

  assert.equal(await main(['setup', '--home', root], output, { exec }), 0);

  assert.match(output.text, /^Needed$/m);
  assert.match(output.text, /^Optional$/m);
  assert.match(output.text, /missing\s+Pi:/);
  assert.deepEqual(readdirSync(root), []);
});

test('hobkin setup takes no other arguments, and help lists it', async () => {
  const output = { text: '', write(text) { this.text += text; } };
  await assert.rejects(main(['setup', 'extra'], output), /Unknown or incomplete option: extra/);
  assert.equal(await main(['--help'], output), 0);
  assert.match(output.text, /^ {2}setup {2}/m);
});
