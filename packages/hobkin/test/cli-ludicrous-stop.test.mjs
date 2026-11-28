import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { killGroup, startProcess, sweep } from '../src/cli/ludicrous/agents.mjs';
import { ludicrousReports } from '../src/cli/ludicrous/compile.mjs';
import { readRun, runDirectory } from '../src/cli/ludicrous/run.mjs';
import { git } from './helpers/work-fixture.mjs';
import { ludicrousHome, NOW, PLAN, roleOf, taskOf, write } from './helpers/ludicrous.mjs';

const packets = (area, count) => Array.from({ length: count }, (_, n) => ({ id: `${area}-${n + 1}`, paths: [`src/${area}/part-${n + 1}.ts`] }));
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (check, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise(done => setTimeout(done, 50));
  }
  return check();
};

/** A code host as the compile meets it: no pull request open yet, and the one it opens. */
function codeHost() {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'list') return '[]';
    if (args[0] === 'pr' && args[1] === 'create') return 'https://github.invalid/the-user/harbor/pull/12\n';
    return '';
  };
  return { calls, gh };
}

// An agent that starts a server of its own outside its process group, the way `npm run dev &` would, and writes both pids down.
const AGENT = `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const server = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
server.unref();
writeFileSync(process.env.PIDS_DIR + '/' + process.env.LUDICROUS_AGENT, JSON.stringify({ agent: process.pid, server: server.pid }));
setInterval(() => {}, 1000);`;

test('Stop kills every process group and leaves nothing running', async t => {
  const h = ludicrousHome(t);
  // Each test's run has its own mark, so a sweep here never reaches another test's processes.
  h.clock.now = NOW + (process.pid % 100000) * 60000;
  await h.building(PLAN, { statuses: { foundation: { contracts: true } }, queues: { api: packets('api', 2) } });
  const start = ({ cwd, env, log }) => startProcess({ command: process.execPath, args: ['-e', AGENT], cwd, env: { ...env, PIDS_DIR: h.base }, log });
  const conductor = h.conductor({ start, kill: killGroup, sweepRun: sweep });
  t.after(() => conductor.close());
  await h.ticks(conductor, 6);
  const names = conductor.running().map(agent => agent.id);
  assert.equal(names.length, 4);
  assert.ok(await until(() => names.every(name => existsSync(join(h.base, name)))));
  const pids = names.flatMap(name => Object.values(JSON.parse(readFileSync(join(h.base, name), 'utf8'))));
  assert.ok(pids.every(alive));

  const asked = Date.now();
  await conductor.stop();
  assert.ok(await until(() => !pids.some(alive), 10000 - (Date.now() - asked)), 'something of the run was still running 10 seconds after Stop');
  assert.equal(readRun(h.root).phase, 'compiling');
});

test('the compile keeps only verified commits, saves the rest as patches, and opens a draft pull request', async t => {
  const h = ludicrousHome(t);
  const run = await h.building(PLAN, { statuses: { foundation: { contracts: true } }, queues: { api: packets('api', 2) } });
  const host = codeHost();
  const conductor = h.conductor({ gh: host.gh });
  await h.ticks(conductor, 5);
  const workers = h.pis.running().filter(agent => roleOf(agent) === 'worker');
  assert.equal(workers.length, 2);

  // api-1 landed before the stop. api-2's worker was halfway: an edit and a new file, never committed. A leader's queue edit waits too.
  write(h.folder, 'src/api/part-1.ts', 'export const one = 1;\n');
  git(h.folder, 'add', 'src/api/part-1.ts');
  git(h.folder, 'commit', '-qm', 'api-1: part one\n\nPacket: api-1');
  const landed = git(h.folder, 'rev-parse', 'HEAD');
  write(h.folder, 'src/api/part-2.ts', 'export const two = ');
  write(h.folder, 'src/api/part-2.helpers.ts', 'half');
  write(h.folder, '_specs/ludicrous/trails/api/status.json', '{"contracts": true}');

  await conductor.stop();
  await h.ticks(conductor, 2);
  const directory = runDirectory(h.root, run.id);
  const patch = join(directory, 'unfinished', 'api-2.patch');
  assert.match(readFileSync(patch, 'utf8'), /export const two =/);
  assert.match(readFileSync(join(directory, 'unfinished', 'rest.patch'), 'utf8'), /part-2\.helpers\.ts|status\.json/);
  assert.equal(git(h.folder, 'status', '--porcelain'), '');
  assert.equal(git(h.folder, 'rev-parse', 'ludicrous/harbor'), landed);
  const states = JSON.parse(readFileSync(join(directory, 'packets.json'), 'utf8'));
  assert.equal(states['api-2'].state, 'back');
  assert.equal(states['api-2'].patch, patch);

  // One compile agent, told where the report goes and what was saved.
  const compile = h.pis.running().find(agent => roleOf(agent) === 'compile');
  assert.ok(compile);
  assert.match(taskOf(compile), /It was stopped by the user\./);
  assert.match(taskOf(compile), new RegExp(`- api-2: ${patch.replaceAll('/', '\\/')}`));
  write(join(directory), 'report.md', 'Ludicrous built half of the API.\n');
  compile.finish();
  await h.ticks(conductor, 2);

  const stopped = readRun(h.root);
  assert.equal(stopped.phase, 'stopped');
  assert.deepEqual(stopped.pr, { url: 'https://github.invalid/the-user/harbor/pull/12', draft: true });
  const created = host.calls.find(args => args[1] === 'create');
  assert.ok(created.includes('--draft'));
  assert.equal(git(h.base, '--git-dir', 'origin.git', 'rev-parse', 'ludicrous/harbor'), landed);
  assert.equal(ludicrousReports(h.root)[0].body, 'Ludicrous built half of the API.\n');
  assert.ok(!host.calls.some(args => args.includes('merge')));
});

test('Go Ludicrous after a stop resumes from the trails, with each patch back on its packet', async t => {
  const h = ludicrousHome(t);
  await h.building(PLAN, { statuses: { foundation: { contracts: true } }, queues: { api: packets('api', 1) } });
  const conductor = h.conductor({ gh: codeHost().gh });
  await h.ticks(conductor, 4);
  write(h.folder, 'src/api/part-1.ts', 'export const one = ');
  await conductor.stop();
  await h.ticks(conductor, 2);
  h.pis.running().forEach(agent => agent.finish());
  await h.ticks(conductor, 2);
  assert.equal(readRun(h.root).phase, 'stopped');

  const before = h.pis.started.length;
  await conductor.go();
  await h.ticks(conductor, 4);
  const resumed = h.pis.started.slice(before);
  assert.ok(resumed.every(agent => roleOf(agent) !== 'planner'));
  const worker = resumed.find(agent => roleOf(agent) === 'worker');
  assert.match(taskOf(worker), /An earlier worker on this packet was stopped\. Its unfinished edits are in .+\/unfinished\/api-1\.patch: apply them first\./);
});

test('with no remote the branch stays local and the report says so', async t => {
  const h = ludicrousHome(t, { origin: false });
  await h.building(PLAN, { statuses: { foundation: { contracts: true } } });
  const host = codeHost();
  const conductor = h.conductor({ gh: host.gh });
  await h.ticks(conductor, 2);
  await conductor.stop();
  await h.ticks(conductor, 3);
  h.pis.running().forEach(agent => agent.finish());
  await h.ticks(conductor, 2);

  const run = readRun(h.root);
  assert.equal(run.phase, 'stopped');
  assert.equal(run.pr, null);
  assert.match(run.lines.at(-1), /no remote, so its branch stays on this computer and no pull request opened/);
  assert.deepEqual(host.calls, []);
  assert.match(ludicrousReports(h.root)[0].body, /The compile agent wrote no report, so hobkin wrote this one/);
});
