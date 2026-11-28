import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initialize } from '../src/cli/config.mjs';
import { approveRun, changeRun, folderState, machineTiers, planRun, readRun, releaseHolds } from '../src/cli/ludicrous/run.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { pauseWork, resumeWork } from '../src/cli/work/controls.mjs';
import { chooseProject, readProject } from '../src/cli/work/store.mjs';
import { commit, git, repository, withOrigin } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const MAIN = fileURLToPath(new URL('../src/cli/main.mjs', import.meta.url));
const roomy = () => ({ cores: 18, memoryMb: 65536, freeDiskMb: 1_000_000, stdioMcp: 0 });
const prOn = state => async args => {
  assert.deepEqual(args.slice(0, 2), ['pr', 'view']);
  return JSON.stringify({ state });
};

function home(t, { origin = true } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-ludicrous-run-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const folder = repository(base, 'harbor');
  if (origin) withOrigin(base, folder);
  chooseProject(root, folder, 'important', NOW);
  return { base, root, folder };
}

const plan = (root, change = {}) => planRun(root, { slug: 'harbor', idea: 'A harbor master for every dock.', tier: 30, ...change }, { now: NOW, measure: roomy });

test('the tier hobkin picks from the computer\'s measure', () => {
  // S1's computer, with its Gmail server in every agent: 100 does not fit beside a quarter kept free and three checks, 50 does.
  const measured = machineTiers({ cores: 18, memoryMb: 65536, stdioMcp: 1 });
  assert.equal(measured.picked, 50);
  assert.equal(measured.checks, 3);
  assert.deepEqual(measured.tiers.map(({ agents, fits }) => [agents, fits]), [[30, true], [50, true], [100, false]]);
  assert.equal(measured.tiers[1].risk, null);
  assert.match(measured.tiers[2].risk, /^More than this computer measures: its agents need about 46 GB and 42 GB is free/);
  assert.match(measured.tiers[0].line, /^Takes the longest\. Leaves about \d+ GB of memory for everything else\.$/);

  // Without a stdio server each agent is a bare Pi, and the same computer fits 100.
  assert.equal(machineTiers({ cores: 18, memoryMb: 65536, stdioMcp: 0 }).picked, 100);
  // A small computer fits none, so hobkin offers the smallest and says what it risks.
  const small = machineTiers({ cores: 8, memoryMb: 16384, stdioMcp: 0 });
  assert.equal(small.picked, 30);
  assert.equal(small.checks, 1);
  assert.ok(small.tiers.every(({ risk }) => risk));
});

test('Let\'s plan this pauses the project in Work until the run\'s pull request is merged or closed', async t => {
  const { root, folder } = home(t);
  const run = await plan(root);

  assert.equal(run.phase, 'planning');
  assert.equal(run.branch, 'ludicrous/harbor');
  assert.equal(git(folder, 'branch', '--show-current'), 'ludicrous/harbor');
  assert.equal(run.baseCommit, git(folder, 'rev-parse', 'main'));
  const held = readProject(root, 'harbor');
  assert.equal(held.paused, true);
  assert.equal(held.ludicrous.run, run.id);
  assert.throws(() => resumeWork(root, 'harbor'), /Ludicrous mode is building harbor, so Work stays paused there until its pull request is merged or closed/);
  await assert.rejects(plan(root), /Ludicrous is already working on harbor\. One run goes at a time\./);

  // Built, stopped and compiled: its pull request is open, so the hold stays.
  changeRun(root, readRun(root), { phase: 'stopped', planned: true, pr: { url: 'https://github.invalid/the-user/harbor/pull/7', draft: true } });
  assert.deepEqual(await releaseHolds(root, { gh: prOn('OPEN') }), []);
  assert.equal(readProject(root, 'harbor').paused, true);

  // The user merges it on the code host: Work comes back, as unpaused as it was before.
  assert.deepEqual(await releaseHolds(root, { gh: prOn('MERGED') }), ['harbor']);
  assert.equal(readProject(root, 'harbor').paused, false);
  assert.equal(readProject(root, 'harbor').ludicrous, null);
});

test('a pause the user asks for while a run holds the project outlasts the hold', async t => {
  const { root } = home(t);
  await plan(root);
  pauseWork(root, 'harbor');
  changeRun(root, readRun(root), { phase: 'stopped', planned: true, pr: { url: 'https://github.invalid/the-user/harbor/pull/8', draft: true } });
  await releaseHolds(root, { gh: prOn('CLOSED') });
  assert.equal(readProject(root, 'harbor').paused, true);
});

test('a folder with changes keeps Let\'s plan this from running, and says why', async t => {
  const { root, folder } = home(t);
  writeFileSync(join(folder, 'draft.txt'), 'not committed\n');
  assert.deepEqual(await folderState(root, 'harbor'), {
    clean: false,
    reason: 'This folder has uncommitted changes. Ludicrous works in it on its own branch, so commit them or put them away first.',
  });
  await assert.rejects(plan(root), /This folder has uncommitted changes/);
  assert.equal(git(folder, 'branch', '--show-current'), 'main');
  assert.equal(readProject(root, 'harbor').paused, undefined);
  assert.equal(readRun(root), null);
});

test('Go Ludicrous builds only a plan that is ready, or a run that stopped after planning', async t => {
  const { root } = home(t);
  await plan(root);
  assert.throws(() => approveRun(root, {}, NOW), /Go Ludicrous waits for a plan, and this run is planning/);
  changeRun(root, readRun(root), { phase: 'plan-ready', planned: true });
  const building = approveRun(root, { answers: { q1: 'b' } }, NOW + 1000);
  assert.equal(building.phase, 'building');
  assert.equal(building.approved, true);
  assert.deepEqual(building.answers, { q1: 'b' });
  assert.equal(building.buildingSince, new Date(NOW + 1000).toISOString());
});

test('a project with no remote keeps its branch here, and its hold lets go once that branch is merged', async t => {
  const { root, folder } = home(t, { origin: false });
  const run = await plan(root);
  assert.equal(run.remote, null);
  assert.match(run.lines[0], /no remote, so its branch stays on this computer/);
  mkdirSync(join(folder, '_specs', 'ludicrous'), { recursive: true });
  commit(folder, '_specs/ludicrous/plan.md', 'The plan.\n');
  changeRun(root, readRun(root), { phase: 'stopped', planned: true });
  assert.deepEqual(await releaseHolds(root, { gh: prOn('OPEN') }), []);
  git(folder, 'switch', '-q', 'main');
  git(folder, 'merge', '-q', '--no-edit', 'ludicrous/harbor');
  assert.deepEqual(await releaseHolds(root, { gh: prOn('OPEN') }), ['harbor']);
});

test('no hobkin command an agent can run starts or stops a run', async t => {
  const { root } = home(t);
  await assert.rejects(runWorkCommand(root, ['ludicrous', 'plan']), /Usage: hobkin work/);
  const help = execFileSync(process.execPath, [MAIN, 'help'], { encoding: 'utf8' });
  assert.doesNotMatch(help, /ludicrous/i);
});
