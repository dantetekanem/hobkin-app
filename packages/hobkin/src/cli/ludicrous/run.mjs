import { existsSync, readdirSync, statfsSync } from 'node:fs';
import { cpus, homedir, totalmem } from 'node:os';
import { join } from 'node:path';
import { atomicJson } from '../config.mjs';
import { nameOf } from '../work/names.mjs';
import { holdForLudicrous, isGoal, readJson, readProject, readProjects } from '../work/store.mjs';
import { defaultBranch, gitOrNothing, gitWithin } from '../work/tree.mjs';

/**
 * Ludicrous mode (076): one run at a time builds a whole project with a full tier of agents. This file holds the run's record in hobkin's
 * home (`ludicrous/<run>/run.json`), its phases, the machine tier and the hold that keeps Work off the project. The conductor
 * (`conductor.mjs`) starts and stops the agents, and only the window calls any of it.
 */

/** How many Ludicrous agents run at once. A compute setting: the plan and the quality are the same at each, only the time and the load differ. */
export const TIERS = [30, 50, 100];
export const PHASES = ['planning', 'plan-ready', 'building', 'waiting', 'compiling', 'stopped', 'done'];
// A run in one of these is under way, so no other can start.
const UNDER_WAY = ['planning', 'plan-ready', 'building', 'waiting', 'compiling'];

// What an agent and a check cost, measured in S1 (`_specs/076-ludicrous-mode/notes.md`).
export const AGENT_MB = 250;
export const STDIO_MCP_MB = 225;
export const CHECK_MB = 2048;
/** One agent starts each second: a start costs under a second of one core's time. */
export const START_SPACING_MS = 1000;
const MIN_RESERVE_MB = 8192;
const MIN_FREE_DISK_MB = 10240;
const CORES_PER_CHECK = 6;
const MOST_CHECKS = 4;

const git = gitWithin(120000);
const iso = time => new Date(time).toISOString();

export const ludicrousRoot = root => join(root, 'ludicrous');
export const runDirectory = (root, id) => join(ludicrousRoot(root), id);
const currentFile = root => join(ludicrousRoot(root), 'current.json');
const runFile = (root, id) => join(runDirectory(root, id), 'run.json');

/** The run the page shows: the last one planned, whatever its phase, or null when there was never one. */
export function readRun(root, id = readJson(currentFile(root), null)?.run) {
  return id ? readJson(runFile(root, id), null) : null;
}

export function writeRun(root, run) {
  atomicJson(runFile(root, run.id), run);
  return run;
}

/** A change to the run, written at once, so a restart finds the run as it stood. */
export const changeRun = (root, run, change) => writeRun(root, { ...run, ...change });

export const underWay = run => UNDER_WAY.includes(run?.phase);

/** How long the run has built, stopped stretches left out. */
export const buildingMs = (run, now = Date.now()) => (run.builtMs ?? 0) + (run.buildingSince ? Math.max(0, now - Date.parse(run.buildingSince)) : 0);

// The stdio MCP servers Pi starts for each agent, from its own settings: each one is a process of its own in every agent.
function stdioServers(agentDir) {
  const servers = readJson(join(agentDir, 'mcp.json'), {})?.mcpServers;
  if (!servers || typeof servers !== 'object') return 0;
  return Object.values(servers).filter(server => typeof server?.command === 'string' && server.enabled !== false).length;
}

/** The computer as the tier reads it. `mcp` says whether Ludicrous agents get the user's MCP servers, which decides what each one costs. */
export function measureComputer({ folder = homedir(), agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), mcp = true } = {}) {
  const { bavail, bsize } = statfsSync(folder);
  return {
    cores: cpus().length,
    memoryMb: Math.round(totalmem() / 2 ** 20),
    freeDiskMb: Math.round((bavail * bsize) / 2 ** 20),
    stdioMcp: mcp ? stdioServers(agentDir) : 0,
  };
}

const gb = mb => `${Math.max(0, Math.round(mb / 1024))} GB`;
const SPEED = { 30: 'Takes the longest', 50: 'Done in about three fifths of the time 30 takes', 100: 'Done in about a third of the time 30 takes' };

/**
 * The three tiers on this computer: what each needs, whether it fits beside a quarter of the memory kept for everything else (never under
 * 8 GB) and the check runs, and the line the page shows for it. hobkin picks the largest that fits, and 30 when none does.
 */
export function machineTiers({ cores, memoryMb, stdioMcp = 0 }) {
  const checks = Math.min(MOST_CHECKS, Math.max(1, Math.floor(cores / CORES_PER_CHECK)));
  const spareMb = memoryMb - Math.max(MIN_RESERVE_MB, Math.round(memoryMb / 4)) - checks * CHECK_MB;
  const perAgentMb = AGENT_MB + stdioMcp * STDIO_MCP_MB;
  const tiers = TIERS.map(agents => {
    const needsMb = agents * perAgentMb;
    const fits = needsMb <= spareMb;
    const leaves = memoryMb - needsMb - checks * CHECK_MB;
    return {
      agents, needsMb, fits,
      line: `${SPEED[agents]}. Leaves about ${gb(leaves)} of memory for everything else.`,
      risk: fits ? null : `More than this computer measures: its agents need about ${gb(needsMb)} and ${gb(spareMb)} is free beside your other work, so everything slows down while it swaps to disk.`,
    };
  });
  const fitting = tiers.filter(tier => tier.fits);
  return { picked: fitting.at(-1)?.agents ?? TIERS[0], checks, perAgentMb, spareMb, tiers };
}

const DIRTY = 'This folder has uncommitted changes. Ludicrous works in it on its own branch, so commit them or put them away first.';

/** Whether Let's plan this can run on a project's folder now, and why not. */
export async function folderState(root, slug) {
  const project = readProject(root, slug);
  if (!project?.path || !existsSync(project.path)) return { clean: false, reason: `${project ? nameOf(project) : slug} has no folder on this computer.` };
  const changes = await gitOrNothing(project.path, 'status', '--porcelain', '--untracked-files=normal');
  return changes ? { clean: false, reason: DIRTY } : { clean: true, reason: null };
}

// A branch an earlier run left keeps its name, so a new run takes the next free one.
async function freeBranch(folder, wanted) {
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? wanted : `${wanted}-${n}`;
    if (!await gitOrNothing(folder, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`)) return name;
  }
}

const runIdOf = (now, slug) => `${iso(now).replace(/\D/g, '').slice(0, 12)}-${slug}`;

function assertProject(project, slug) {
  if (!project || project.state !== 'chosen') throw Error(`${slug} is not a project Work has.`);
  if (isGoal(project)) throw Error(`${nameOf(project)} is a goal, and Ludicrous builds code.`);
}

/**
 * Let's plan this: the user's idea, a project and a tier. The project's folder must be clean, since every agent works in it on the run's
 * branch, `ludicrous/<slug>`, made from the default branch here and checked out in that folder. Work stops starting anything there.
 * A run stopped while it planned plans again on the same project from the round files it wrote. One on another project is left as it is.
 */
export async function planRun(root, { slug, idea, tier }, { now = Date.now(), measure = measureComputer } = {}) {
  const current = readRun(root);
  if (underWay(current)) throw Error(`Ludicrous is already working on ${current.name}. One run goes at a time.`);
  const project = readProject(root, slug);
  assertProject(project, slug);
  const words = String(idea ?? '').trim();
  if (!words) throw Error('Write what you want first.');
  if (!TIERS.includes(tier)) throw Error(`The machine tier is ${TIERS.join(', ')} agents.`);
  const { clean, reason } = await folderState(root, slug);
  if (!clean) throw Error(reason);
  const { freeDiskMb } = measure({ folder: project.path });
  if (freeDiskMb < MIN_FREE_DISK_MB) throw Error(`Ludicrous needs ${gb(MIN_FREE_DISK_MB)} of free disk for its checks and its work, and this computer has ${gb(freeDiskMb)}.`);

  // The same project after a stop in planning: the same run, its branch and its round files.
  if (current?.phase === 'stopped' && !current.planned && current.slug === slug) {
    await git(project.path, 'switch', '-q', current.branch);
    return changeRun(root, current, { idea: words, tier, phase: 'planning', round: 1, stoppedAt: null, lines: [] });
  }
  if (current?.phase === 'stopped' && !current.planned) holdForLudicrous(root, current.slug, null);

  const folder = project.path;
  const base = await defaultBranch(folder);
  const baseCommit = await git(folder, 'rev-parse', '--verify', `${base}^{commit}`);
  const branch = await freeBranch(folder, `ludicrous/${slug}`);
  await git(folder, 'switch', '-q', '-c', branch, baseCommit);
  const remote = (await gitOrNothing(folder, 'remote', 'get-url', 'origin')) || null;
  const run = {
    id: runIdOf(now, slug), slug, name: nameOf(project), folder, remote, base, baseCommit, branch, idea: words, tier,
    phase: 'planning', round: 1, planned: false, approved: false, answers: {},
    startedAt: iso(now), buildingSince: null, builtMs: 0, waitingUntil: null, stoppedAt: null, doneAt: null,
    spawned: 0, tokens: 0, pr: null, lines: remote ? [] : ['This project has no remote, so its branch stays on this computer and no pull request opens.'],
  };
  holdForLudicrous(root, slug, run.id);
  writeRun(root, run);
  atomicJson(currentFile(root), { run: run.id });
  return run;
}

/**
 * Go Ludicrous: the user's approval of the plan, and after a stop the word to carry on. Its answers to the planners' questions stand in for
 * their picks. Only the window says it, and it is the user's word for this run alone (076, Building).
 */
export function approveRun(root, { answers = {} } = {}, now = Date.now()) {
  const run = readRun(root);
  if (!run) throw Error('Plan a run first, with Let\'s plan this.');
  const resumes = run.phase === 'stopped' && run.planned;
  if (run.phase !== 'plan-ready' && !resumes) throw Error(`Go Ludicrous waits for a plan, and this run is ${run.phase}.`);
  return changeRun(root, run, {
    approved: true, answers: { ...run.answers, ...answers }, phase: 'building', buildingSince: iso(now), stoppedAt: null, waitingUntil: null,
  });
}

const prState = async (gh, run) => {
  const { state } = JSON.parse(await gh(['pr', 'view', run.pr.url, '--json', 'state'], run.folder));
  return state;
};

/** Whether the work a run held its project for has landed or been let go: its pull request merged or closed, or, with no remote, its branch merged or gone. */
async function letGo(run, gh) {
  if (underWay(run)) return false;
  if (run.pr?.url) return ['MERGED', 'CLOSED'].includes(await prState(gh, run).catch(() => 'OPEN'));
  if (run.remote && run.planned) return false;
  if (!run.planned) return true;
  const tip = await gitOrNothing(run.folder, 'rev-parse', '--verify', '--quiet', `refs/heads/${run.branch}`);
  if (!tip) return true;
  return (await gitOrNothing(run.folder, 'branch', '--merged', run.base, '--list', run.branch)) !== '';
}

/**
 * Lets Work back onto each project a run held once that run's work landed or was let go (`letGo`). The window's refresh calls it, now and
 * then, since a pull request merges on the code host and nothing here hears it.
 */
export async function releaseHolds(root, { gh }) {
  const released = [];
  for (const project of readProjects(root).filter(each => each.ludicrous?.run)) {
    const run = readRun(root, project.ludicrous.run);
    if (run && !await letGo(run, gh)) continue;
    holdForLudicrous(root, project.slug, null);
    released.push(project.slug);
  }
  return released;
}

/** Every run's id, oldest first. */
export const runIds = root => (existsSync(ludicrousRoot(root)) ? readdirSync(ludicrousRoot(root), { withFileTypes: true }) : [])
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
