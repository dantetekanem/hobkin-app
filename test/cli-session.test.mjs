import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArguments } from '../src/cli/main.mjs';
import { readBrief, startSession } from '../src/cli/session.mjs';
import { WorkPanes } from '../src/cli/work/panes.mjs';

const herdr = { HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w1' };

const dataFolder = t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-session-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

const fakeHerdr = (tabs = []) => {
  const calls = [];
  const exec = async (_command, args) => {
    calls.push(args);
    if (args[0] === 'tab' && args[1] === 'list') return JSON.stringify({ result: { tabs } });
    if (args[0] === 'tab' && args[1] === 'create') return JSON.stringify({ result: { root_pane: { pane_id: 'w1:p9' } } });
    return JSON.stringify({ result: {} });
  };
  return { calls, panes: new WorkPanes({ workspace: 'w1', exec, tab: 'Hobkin' }) };
};

const briefIn = prompt => /^Read (.+) and follow it\.$/.exec(prompt[3])[1];

test('a session\'s Pi has every extension and every tool the user has, and only skips the permission prompts', async t => {
  const { calls, panes } = fakeHerdr();

  await startSession({ root: dataFolder(t), cwd: '/repos/api', brief: 'Go.', env: herdr, panes });

  const start = calls.find(args => args[1] === 'start');
  assert.deepEqual(start.slice(start.indexOf('--') + 1), ['--approve']);
});

test('a session started the ordinary way limits nothing either', async t => {
  const root = dataFolder(t);
  const log = join(root, 'herdr.log');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'herdr'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\necho '{"result":{"tabs":[],"root_pane":{"pane_id":"w1:p9"}}}'\n`, { mode: 0o755 });
  const { PATH, HERDR_WORKSPACE_ID } = process.env;
  process.env.PATH = `${bin}:${PATH}`;
  process.env.HERDR_WORKSPACE_ID = 'w1';
  t.after(() => {
    process.env.PATH = PATH;
    if (HERDR_WORKSPACE_ID === undefined) delete process.env.HERDR_WORKSPACE_ID;
    else process.env.HERDR_WORKSPACE_ID = HERDR_WORKSPACE_ID;
  });

  await startSession({ root, cwd: root, brief: 'Go.', env: herdr });

  const start = readFileSync(log, 'utf8').split('\n').find(line => line.startsWith('agent start'));
  assert.match(start, / -- --approve$/);
});

test('a session is a full Pi with every permission, in its own tab, and starts on the brief', async t => {
  const { calls, panes } = fakeHerdr();

  const root = dataFolder(t);
  const { name, pane } = await startSession({ root, title: 'Rebuild the importer!', cwd: '/repos/api', brief: 'Rebuild it all.', env: herdr, panes });

  assert.equal(pane, 'w1:p9');
  assert.match(name, /^hobkin-rebuild-the-importer-[0-9a-f]{4}$/);
  assert.ok(name.length <= 32);
  const [create, start, prompt] = calls.filter(args => args[1] !== 'list');
  assert.deepEqual(create.slice(0, 2), ['tab', 'create']);
  assert.equal(create[create.indexOf('--label') + 1], 'Hobkin');
  assert.equal(create[create.indexOf('--cwd') + 1], '/repos/api');
  assert.ok(create.includes('--no-focus'), 'the user stays where they are');
  assert.deepEqual([start[0], start[1], start[2]], ['agent', 'start', name]);
  assert.equal(start[start.indexOf('--kind') + 1], 'pi');
  assert.deepEqual(start.slice(start.indexOf('--') + 1), ['--approve']);
  assert.deepEqual(prompt.slice(0, 3), ['agent', 'prompt', name]);
  assert.match(readFileSync(briefIn(prompt), 'utf8'), /^Rebuild it all\./);
});

test('a brief of any length reaches the agent as a private file', async t => {
  const root = dataFolder(t);
  const { calls, panes } = fakeHerdr();
  const brief = 'Everything the conversation established. '.repeat(2000);

  await startSession({ root, cwd: '/repos/api', brief, env: herdr, panes });

  const prompt = calls.find(args => args[1] === 'prompt');
  assert.ok(prompt[3].length < 200, 'only the path travels through the terminal');
  const file = briefIn(prompt);
  assert.ok(file.startsWith(root));
  assert.ok(readFileSync(file, 'utf8').startsWith(brief));
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('work handed to a session is followed, and its brief says where the report goes', async t => {
  const root = dataFolder(t);
  const { calls, panes } = fakeHerdr();
  const followed = [];

  const started = await startSession({ root, brief: 'Rebuild it all.', env: herdr, panes, follow: session => followed.push(session) });

  assert.deepEqual(followed, [started]);
  assert.ok(started.report.startsWith(root));
  assert.ok(readFileSync(briefIn(calls.find(args => args[1] === 'prompt')), 'utf8').includes(started.report));
});

test('a conversation the user means to carry on in stays open', async t => {
  const { calls, panes } = fakeHerdr();
  const followed = [];

  const started = await startSession({ root: dataFolder(t), brief: 'Carry on from here.', keep: true, env: herdr, panes, follow: session => followed.push(session) });

  assert.deepEqual(followed, []);
  assert.equal(started.report, undefined);
  assert.equal(readFileSync(briefIn(calls.find(args => args[1] === 'prompt')), 'utf8'), 'Carry on from here.');
  assert.equal(parseArguments(['session', '--keep']).keep, true);
});

const closingHerdr = onAgent => {
  const closed = [];
  const exec = async (_command, args) => {
    if (args[0] === 'pane' && args[1] === 'close') closed.push(args[2]);
    if (args[0] === 'agent' && args[1] === 'get') return JSON.stringify({ result: { agent: { agent_status: onAgent() } } });
    return JSON.stringify({ result: {} });
  };
  return { closed, panes: new WorkPanes({ workspace: 'w1', exec, pollMs: 1, idleGraceMs: 0 }) };
};

test('a followed session closes its pane when its report appears', async t => {
  const report = join(dataFolder(t), 'report.md');
  const { closed, panes } = closingHerdr(() => {
    writeFileSync(report, 'Done.');
    return 'working';
  });

  await panes.followSession({ name: 'hobkin-job', pane: 'w1:p9', report });

  assert.deepEqual(closed, ['w1:p9']);
});

test('a session that stops without a report still closes its pane', async t => {
  const { closed, panes } = closingHerdr(() => 'idle');

  await panes.followSession({ name: 'hobkin-job', pane: 'w1:p9', report: join(dataFolder(t), 'never.md') });

  assert.deepEqual(closed, ['w1:p9']);
});

test('a session whose agent has gone still closes its pane', async t => {
  const { closed, panes } = closingHerdr(() => { throw Error('agent_not_found'); });

  await panes.followSession({ name: 'hobkin-job', pane: 'w1:p9', report: join(dataFolder(t), 'never.md') });

  assert.deepEqual(closed, ['w1:p9']);
});

test('the watcher runs as a process of its own and closes the pane', t => {
  const folder = dataFolder(t);
  const log = join(folder, 'herdr.log');
  writeFileSync(join(folder, 'herdr'), `#!/bin/sh\necho "$*" >> "${log}"\necho '{"result":{}}'\n`, { mode: 0o755 });
  const report = join(folder, 'report.md');
  writeFileSync(report, 'Done.');
  const script = fileURLToPath(new URL('../src/cli/session-follow.mjs', import.meta.url));

  const { status, stderr } = spawnSync(process.execPath, [script, 'hobkin-job', 'w1:p9', report], { env: { ...process.env, PATH: `${folder}:${process.env.PATH}` }, encoding: 'utf8' });

  assert.equal(status, 0, stderr);
  assert.match(readFileSync(log, 'utf8'), /pane close w1:p9/);
});

test('a pane whose shell is still starting gets another try, and the agent starts', async t => {
  const closed = [];
  const starts = [];
  const exec = async (_command, args) => {
    if (args[0] === 'tab' && args[1] === 'list') return JSON.stringify({ result: { tabs: [] } });
    if (args[0] === 'tab') return JSON.stringify({ result: { root_pane: { pane_id: 'w1:p9' } } });
    if (args[0] === 'pane' && args[1] === 'close') closed.push(args[2]);
    if (args[1] === 'start') {
      starts.push(args);
      if (starts.length < 3) throw Object.assign(Error('Command failed'), { stderr: '{"error":{"code":"agent_start_input_failed"}}' });
    }
    return JSON.stringify({ result: {} });
  };
  const panes = new WorkPanes({ workspace: 'w1', exec, tab: 'Hobkin', pollMs: 1 });

  const { pane } = await startSession({ root: dataFolder(t), cwd: '/repos/api', brief: 'Go.', env: herdr, panes });

  assert.equal(pane, 'w1:p9');
  assert.equal(starts.length, 3);
  assert.deepEqual(closed, []);
});

test('a shell that never gets ready ends the attempt and closes the pane', async t => {
  const closed = [];
  const exec = async (_command, args) => {
    if (args[0] === 'tab' && args[1] === 'list') return JSON.stringify({ result: { tabs: [] } });
    if (args[0] === 'tab') return JSON.stringify({ result: { root_pane: { pane_id: 'w1:p9' } } });
    if (args[0] === 'pane' && args[1] === 'close') closed.push(args[2]);
    if (args[1] === 'start') throw Object.assign(Error('Command failed'), { stderr: '{"error":{"code":"agent_start_input_failed"}}' });
    return JSON.stringify({ result: {} });
  };
  const panes = new WorkPanes({ workspace: 'w1', exec, tab: 'Hobkin', pollMs: 1, startTimeoutMs: 10 });

  await assert.rejects(startSession({ root: dataFolder(t), cwd: '/repos/api', brief: 'Go.', env: herdr, panes }), /Command failed/);

  assert.deepEqual(closed, ['w1:p9']);
});

test('a Pi that cannot start does not leave an empty pane behind', async t => {
  const closed = [];
  const exec = async (_command, args) => {
    if (args[0] === 'tab' && args[1] === 'list') return JSON.stringify({ result: { tabs: [] } });
    if (args[0] === 'tab') return JSON.stringify({ result: { root_pane: { pane_id: 'w1:p9' } } });
    if (args[0] === 'pane' && args[1] === 'close') closed.push(args[2]);
    if (args[0] === 'agent') throw Error('agent_not_ready');
    return JSON.stringify({ result: {} });
  };
  const panes = new WorkPanes({ workspace: 'w1', exec, tab: 'Hobkin' });

  await assert.rejects(startSession({ root: dataFolder(t), brief: 'Rebuild it all.', env: herdr, panes }), /agent_not_ready/);

  assert.deepEqual(closed, ['w1:p9']);
});

test('a brief that may not have arrived says where the session is, so nobody starts a second one', async t => {
  const closed = [];
  const exec = async (_command, args) => {
    if (args[0] === 'tab' && args[1] === 'list') return JSON.stringify({ result: { tabs: [] } });
    if (args[0] === 'tab') return JSON.stringify({ result: { root_pane: { pane_id: 'w1:p9' } } });
    if (args[0] === 'pane' && args[1] === 'close') closed.push(args[2]);
    if (args[0] === 'agent' && args[1] === 'prompt') throw Error('agent_prompt_stalled');
    return JSON.stringify({ result: {} });
  };
  const panes = new WorkPanes({ workspace: 'w1', exec, tab: 'Hobkin' });

  await assert.rejects(startSession({ root: dataFolder(t), title: 'big job', brief: 'Rebuild it all.', env: herdr, panes }), /w1:p9.*hobkin-big-job/);

  assert.deepEqual(closed, [], 'the session stays for the user to look at');
});

test('a long brief survives being cut mid-character', async () => {
  const text = Buffer.from('Reforma do módulo de relatórios. ✅');
  const cut = text.indexOf(Buffer.from('✅')) + 1;

  const brief = await readBrief(Readable.from([text.subarray(0, cut), text.subarray(cut)]));

  assert.equal(brief, 'Reforma do módulo de relatórios. ✅');
});

test('outside Herdr there is no pane to open, so the agent is told to do the work itself', async () => {
  const { calls, panes } = fakeHerdr();

  await assert.rejects(startSession({ brief: 'Rebuild it all.', env: {}, panes }), /do this work here/);

  assert.deepEqual(calls, []);
});

test('a session needs a brief, since nobody is there to give it one', async () => {
  const { panes } = fakeHerdr();

  await assert.rejects(startSession({ brief: '  \n', env: herdr, panes }), /brief/);
});
