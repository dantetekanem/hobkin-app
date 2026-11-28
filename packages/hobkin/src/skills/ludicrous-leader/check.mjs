#!/usr/bin/env node
/**
 * `check`: how a Ludicrous leader runs its area's checks (076, Checks). Only leaders run checks, and only on committed code: the check runs
 * in a check worktree moved to the branch head, never in the shared folder, where other agents' files are half written. An area runs one
 * check at a time, the computer runs at most LUDICROUS_CHECK_SLOTS at once (S1), and a leader waits for a free worktree. The commands are
 * the area's `checks` in `_specs/ludicrous/plan.json`, run in order until one fails. A failure becomes a fix packet in the area's queue that
 * names the failing check, the commit that brought it and the trail whose assumption was wrong.
 *
 * The conductor sets LUDICROUS_BRANCH, LUDICROUS_AREA, LUDICROUS_BASE, LUDICROUS_RUN, LUDICROUS_CHECKS and LUDICROUS_CHECK_SLOTS. It runs
 * in the project's folder. Exit 0: passed, 1: failed, 3: this area's check is running already.
 */
import { execFile, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const env = process.env;
const POLL_MS = Number(env.LUDICROUS_CHECK_POLL_MS ?? 2000);
const WAIT_MS = Number(env.LUDICROUS_CHECK_WAIT_MS ?? 3600000);
const COMMAND_MS = Number(env.LUDICROUS_CHECK_TIMEOUT_MS ?? 1800000);
const TAIL_LINES = 60;

const git = async (args, cwd) => (await exec('git', cwd ? ['-C', cwd, ...args] : args, { env: { ...env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
const short = commit => commit.slice(0, 12);
const sleep = ms => new Promise(done => setTimeout(done, ms));
const trails = area => `_specs/ludicrous/trails/${area}`;
const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const queueOf = area => (existsSync(`${trails(area)}/queue.jsonl`) ? readFileSync(`${trails(area)}/queue.jsonl`, 'utf8') : '').split('\n')
  .flatMap(line => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });

const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

// A lock just made has no pid in it for a moment, and is not stale for that.
const FRESH_LOCK_MS = 10000;
const holderOf = lock => {
  try {
    return Number(readFileSync(join(lock, 'pid'), 'utf8'));
  } catch {
    return 0;
  }
};
const fresh = lock => {
  try {
    return Date.now() - statSync(lock).mtimeMs < FRESH_LOCK_MS;
  } catch {
    return false;
  }
};

/** A lock is a folder with its holder's pid in it. One whose holder is gone is taken over. */
function take(lock) {
  mkdirSync(join(lock, '..'), { recursive: true });
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'pid'), String(process.pid));
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const holder = holderOf(lock);
      if (holder ? alive(holder) : fresh(lock)) return false;
      rmSync(lock, { recursive: true, force: true });
    }
  }
}

const release = lock => rmSync(lock, { recursive: true, force: true });

/** The first free check worktree, made when it is not there yet, or null once the wait runs out. */
async function freeSlot(locks, slots) {
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    for (let n = 1; n <= slots; n += 1) if (take(join(locks, `slot-${n}`))) return n;
    await sleep(POLL_MS);
  }
  return null;
}

async function moveTo(tree, head) {
  if (!existsSync(tree)) {
    mkdirSync(join(tree, '..'), { recursive: true });
    await git(['worktree', 'add', '-q', '--detach', '-f', tree, head]);
    return;
  }
  await git(['checkout', '-q', '-f', '--detach', head], tree);
  await git(['clean', '-fdq'], tree);
}

/** Runs one command in the worktree, its output to the log, and answers its exit code. */
function runCommand(command, tree, log) {
  return new Promise(resolve => {
    appendFileSync(log, `$ ${command}\n`);
    const child = spawn('/bin/sh', ['-c', command], { cwd: tree, env: { ...env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), COMMAND_MS);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => appendFileSync(log, chunk));
    child.on('close', code => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

const tailOf = log => readFileSync(log, 'utf8').trimEnd().split('\n').slice(-TAIL_LINES).join('\n');

/** The area's commits since `since`, newest first: those whose Packet trailer is one of its packets, or its leader. */
async function areaCommits(area, since, head) {
  const ids = new Set(queueOf(area).map(packet => packet.id));
  const listed = await git(['log', '--format=%H%x1f%(trailers:key=Packet,valueonly,separator=%x1e)', `${since}..${head}`]);
  return listed.split('\n').filter(Boolean).map(line => {
    const [commit, packet] = line.split('\x1f');
    return { commit, packet: packet.trim() };
  }).filter(({ packet }) => ids.has(packet) || packet === `${area} leader`);
}

/** The fix packet a failure files: the newest packet that landed since the last pass is the likeliest to have brought it. */
function fileFix(area, command, head, brought) {
  const queue = queueOf(area);
  const packets = brought.map(({ packet }) => queue.filter(each => each.id === packet).at(-1)).filter(Boolean);
  const newest = brought.find(({ packet }) => queue.some(each => each.id === packet));
  const number = queue.filter(each => each.id.startsWith(`${area}-fix-`)).length + 1;
  const fix = {
    id: `${area}-fix-${number}`,
    step: packets[0]?.step ?? null,
    title: `Fix the failing check: ${command}`,
    paths: [...new Set(packets.flatMap(packet => packet.paths ?? []))],
    tier: 'mid',
    fix: { check: command, commit: newest?.commit ?? head, trail: newest ? `${trails(area)}/${newest.packet}.md` : null, head },
  };
  mkdirSync(trails(area), { recursive: true });
  appendFileSync(`${trails(area)}/queue.jsonl`, `${JSON.stringify(fix)}\n`);
  return fix;
}

function recordStatus(area, checked) {
  const file = `${trails(area)}/status.json`;
  mkdirSync(trails(area), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...readJson(file, {}), checked }, null, 2)}\n`);
}

async function main() {
  const { LUDICROUS_BRANCH: branch, LUDICROUS_AREA: area, LUDICROUS_BASE: base, LUDICROUS_RUN: run, LUDICROUS_CHECKS: checks } = env;
  const slots = Number(env.LUDICROUS_CHECK_SLOTS ?? 1);
  if (!branch || !area || !base || !run || !checks) {
    process.stderr.write('check runs only for a Ludicrous leader, which names its branch, area, run and check worktrees.\n');
    return 1;
  }
  const commands = readJson('_specs/ludicrous/plan.json', {}).areas?.find(each => each.id === area)?.checks ?? [];
  const locks = join(run, 'locks');
  const areaLock = join(locks, `area-${area}`);
  if (!take(areaLock)) {
    process.stderr.write(`A check of ${area} is running already. Wait for its result in ${join(run, 'checks', `${area}.json`)}.\n`);
    return 3;
  }
  try {
    const head = await git(['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]);
    const last = readJson(`${trails(area)}/status.json`, {}).checked;
    if (last?.head && !(await areaCommits(area, last.head, head)).length) {
      process.stdout.write(`Nothing new in ${area} since ${short(last.head)}, which ${last.passed ? 'passed' : 'failed'}.\n`);
      return last.passed ? 0 : 1;
    }
    if (!commands.length) {
      process.stdout.write(`The plan names no checks for ${area}, so nothing ran.\n`);
      return 0;
    }
    const slot = await freeSlot(locks, slots);
    if (!slot) {
      process.stderr.write('No check worktree came free in time. Run check again.\n');
      return 3;
    }
    try {
      const tree = join(checks, `ludicrous-check-${slot}`);
      await moveTo(tree, head);
      mkdirSync(join(run, 'checks'), { recursive: true });
      const log = join(run, 'checks', `${area}-${short(head)}.log`);
      const startedAt = new Date().toISOString();
      writeFileSync(log, '');
      let failed = null;
      for (const command of commands) {
        const code = await runCommand(command, tree, log);
        if (code !== 0) {
          failed = { command, code, tail: tailOf(log) };
          break;
        }
      }
      const result = { area, head, passed: !failed, startedAt, endedAt: new Date().toISOString(), slot, log, ...(failed ? { failed } : {}) };
      writeFileSync(join(run, 'checks', `${area}.json`), `${JSON.stringify(result, null, 2)}\n`);
      appendFileSync(join(run, 'checks.jsonl'), `${JSON.stringify(result)}\n`);
      recordStatus(area, { head, passed: !failed, at: result.endedAt });
      if (!failed) {
        process.stdout.write(`${area} passed on ${short(head)}: ${commands.join('; ')}.\n`);
        return 0;
      }
      const fix = fileFix(area, failed.command, head, await areaCommits(area, last?.head ?? base, head));
      process.stdout.write(`${area} failed at ${failed.command} on ${short(head)}. Filed ${fix.id} in the queue. The log is ${log}, and it ends:\n${failed.tail}\n`);
      return 1;
    } finally {
      release(join(locks, `slot-${slot}`));
    }
  } finally {
    release(areaLock);
  }
}

process.exitCode = await main();
