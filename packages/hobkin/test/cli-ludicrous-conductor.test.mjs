import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { groupsLeft, killGroup } from '../src/cli/ludicrous/agents.mjs';
import { changeRun, readRun, runDirectory } from '../src/cli/ludicrous/run.mjs';
import { git } from './helpers/work-fixture.mjs';
import { ludicrousHome, PLAN, roleOf, write } from './helpers/ludicrous.mjs';

const packets = (area, count, from = 1) => Array.from({ length: count }, (_, n) => ({ id: `${area}-${from + n}`, paths: [`src/${area}/part-${from + n}.ts`] }));
const areaOf = agent => agent.env.LUDICROUS_AREA;
const packetsOf = h => JSON.parse(readFileSync(join(runDirectory(h.root, readRun(h.root).id), 'packets.json'), 'utf8'));

test('the tier is never exceeded, and it fills again while packets are ready', async t => {
  const h = ludicrousHome(t, { tier: 30 });
  await h.building(PLAN, { statuses: { foundation: { contracts: true } }, queues: { foundation: packets('foundation', 20), api: packets('api', 40) } });
  const conductor = h.conductor();

  let most = 0;
  await h.ticks(conductor, 40, () => {
    most = Math.max(most, h.pis.running().length);
  });
  assert.equal(most, 30);
  assert.equal(h.pis.running().length, 30);
  const workers = h.pis.running().filter(agent => roleOf(agent) === 'worker');
  // A share of the workers for each area by its ready packets: api has twice the foundation's.
  const [foundation, api] = ['foundation', 'api'].map(area => workers.filter(agent => areaOf(agent) === area).length);
  assert.equal(foundation + api, 28);
  assert.ok(api > foundation * 1.5, `api ${api}, foundation ${foundation}`);

  // Five workers end without landing: their packets go back, and the tier is full again within five spacings.
  workers.slice(0, 5).forEach(agent => agent.finish());
  await h.ticks(conductor, 1);
  assert.equal(h.pis.running().length, 26);
  await h.ticks(conductor, 5, () => {
    most = Math.max(most, h.pis.running().length);
  });
  assert.equal(h.pis.running().length, 30);
  assert.equal(most, 30);
  assert.equal(readRun(h.root).spawned, 35);
});

test('one leader for each open area, and workers start only from its queue', async t => {
  const h = ludicrousHome(t);
  await h.building(PLAN, { statuses: { foundation: { contracts: false } }, queues: { foundation: packets('foundation', 3), api: packets('api', 3) } });
  const conductor = h.conductor();
  await h.ticks(conductor, 10);

  // Until the foundation's contracts are committed, only the foundation is open.
  const started = () => h.pis.started.map(agent => `${roleOf(agent)} ${areaOf(agent)}`);
  assert.deepEqual(started(), ['leader foundation', 'worker foundation', 'worker foundation', 'worker foundation']);
  const queued = new Set(['foundation-1', 'foundation-2', 'foundation-3']);
  assert.deepEqual(new Set(Object.keys(packetsOf(h))), queued);

  write(h.folder, '_specs/ludicrous/trails/foundation/status.json', JSON.stringify({ contracts: true }));
  await h.ticks(conductor, 10);
  assert.deepEqual(started().slice(4), ['leader api', 'worker api', 'worker api', 'worker api']);

  // A leader that ends while its area is open is followed by a fresh one, and never two at once.
  const leaders = area => h.pis.running().filter(agent => roleOf(agent) === 'leader' && areaOf(agent) === area);
  h.clock.now += 120000;
  leaders('api')[0].finish();
  await h.ticks(conductor, 2);
  assert.equal(leaders('api').length, 1);
  assert.equal(h.pis.started.filter(agent => roleOf(agent) === 'leader' && areaOf(agent) === 'api').length, 2);

  // One that ends at once rests a minute before the next, so a leader that cannot start does not spin.
  leaders('api')[0].finish();
  await h.ticks(conductor, 30);
  assert.equal(leaders('api').length, 0);
  await h.ticks(conductor, 35);
  assert.equal(leaders('api').length, 1);
});

test('agents share the folder, and the only worktrees are the check worktrees', async t => {
  const h = ludicrousHome(t);
  await h.building(PLAN, { statuses: { foundation: { contracts: true } }, queues: { foundation: packets('foundation', 4), api: packets('api', 4) } });
  const conductor = h.conductor();
  await h.ticks(conductor, 12);
  assert.equal(h.pis.started.length, 10);
  assert.ok(h.pis.started.every(agent => agent.cwd === h.folder));
  assert.equal(git(h.folder, 'worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length, 1);
  // Each knows where the check worktrees go, the only ones a run makes (`check`), and how many the computer takes.
  assert.ok(h.pis.started.every(agent => agent.env.LUDICROUS_CHECKS === join(h.root, 'work', 'harbor', 'trees') && agent.env.LUDICROUS_CHECK_SLOTS === '3'));
});

test('a restart kills the old process groups and builds again from the trails', async t => {
  const h = ludicrousHome(t);
  const run = await h.building(PLAN, { statuses: { foundation: { contracts: true } }, queues: { api: packets('api', 1) } });
  const directory = runDirectory(h.root, run.id);
  const sessions = join(directory, 'sessions');
  mkdirSync(sessions, { recursive: true });
  // What a hobkin that stopped left running: a worker in its own process group.
  const left = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', join(sessions, '0001-worker-api.jsonl')], { detached: true, stdio: 'ignore' });
  t.after(() => killGroup(left.pid));
  const gone = new Promise(resolve => left.once('exit', resolve));
  writeFileSync(join(directory, 'agents.json'), JSON.stringify([{ id: '0001-worker-api', role: 'worker', area: 'api', packet: 'api-1', pid: left.pid }]));
  writeFileSync(join(directory, 'packets.json'), JSON.stringify({ 'api-1': { area: 'api', state: 'running', tries: 1 } }));

  const conductor = h.conductor({ kill: killGroup, left: groupsLeft });
  await conductor.open();
  await gone;
  assert.equal(packetsOf(h)['api-1'].state, 'back');
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'agents.json'), 'utf8')), []);

  await h.ticks(conductor, 5);
  assert.deepEqual(h.pis.started.map(agent => `${roleOf(agent)} ${areaOf(agent)}`), ['leader foundation', 'leader api', 'worker api']);
  assert.equal(packetsOf(h)['api-1'].tries, 2);
});

test('the computer is held awake only while building', async t => {
  const h = ludicrousHome(t);
  const run = await h.building(PLAN, { statuses: { foundation: { contracts: true } } });
  const conductor = h.conductor();
  changeRun(h.root, run, { phase: 'plan-ready' });
  await h.ticks(conductor, 3);
  assert.equal(h.awake.holds, 0);

  changeRun(h.root, readRun(h.root), { phase: 'building' });
  await h.ticks(conductor, 3);
  assert.equal(h.awake.holds, 1);
  assert.equal(h.awake.releases, 0);
  await conductor.close();
  assert.equal(h.awake.releases, 1);
});
