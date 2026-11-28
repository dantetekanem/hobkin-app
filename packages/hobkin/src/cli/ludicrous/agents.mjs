import { execFile, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { promisify } from 'node:util';

/**
 * The processes of a Ludicrous run (076): each agent is a Pi started in the background in a process group of its own, so Stop can kill
 * it and everything it started at once. Every process an agent starts carries the run's mark in its environment, which finds the ones
 * that left its group, such as a dev server. Only the conductor starts or stops any of them.
 */

export const MARK = 'HOBKIN_LUDICROUS';
const exec = promisify(execFile);

/** Starts one agent's process, its output to `log`. Answers its pid and a promise of how it ended. */
export function startProcess({ command, args, cwd, env, log }) {
  const out = openSync(log, 'a', 0o600);
  try {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', out, out] });
    const exited = new Promise(resolve => {
      child.once('error', error => resolve({ code: null, signal: null, error: error.message }));
      child.once('exit', (code, signal) => resolve({ code, signal, error: null }));
    });
    child.unref();
    return { pid: child.pid ?? null, exited };
  } finally {
    closeSync(out);
  }
}

/** Kills a whole process group at once. One that is gone already is no failure. */
export function killGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

async function table(columns, { environment = false } = {}) {
  const { stdout } = await exec('ps', ['-A', ...(environment ? ['-E', '-ww'] : []), '-o', columns], { maxBuffer: 256 * 1024 * 1024 });
  return stdout.split('\n').filter(line => line.trim());
}

// A recorded agent's process is still the run's when it is still running and started when the run recorded it, give or take this.
const SAME_START_MS = 10000;

// `ps` writes elapsed time as [[dd-]hh:]mm:ss.
function secondsOf(elapsed) {
  const [days, rest] = elapsed.includes('-') ? elapsed.split('-') : ['0', elapsed];
  return rest.split(':').map(Number).reduce((total, part) => total * 60 + part, 0) + Number(days) * 86400;
}

/** How long each of these processes has run, in seconds, by pid. One that is gone is not in it. */
async function ages(pids) {
  if (!pids.length) return new Map();
  const { stdout } = await exec('ps', ['-o', 'pid=,etime=', '-p', pids.join(',')]).catch(() => ({ stdout: '' }));
  const rows = stdout.split('\n').filter(line => line.trim()).map(line => line.trim().split(/\s+/));
  return new Map(rows.map(([pid, elapsed]) => [Number(pid), secondsOf(elapsed)]));
}

/**
 * The recorded agents whose process group still runs and is still theirs. Pi names its own process `pi`, so nothing in the process list
 * says which run it is; its age does. A group whose leader went and whose number came back to another program started at another time,
 * and is left alone.
 */
export async function groupsLeft(recorded, { now = Date.now() } = {}) {
  const running = await ages(recorded.map(agent => agent.pid).filter(Boolean));
  const stillOurs = ({ pid, startedAt }) => {
    const age = running.get(pid);
    if (age === undefined || !startedAt) return false;
    return Math.abs(now - age * 1000 - Date.parse(startedAt)) < SAME_START_MS;
  };
  return recorded.filter(stillOurs).map(agent => agent.pid);
}

/**
 * The processes whose environment carries this run's mark. It reads every process's environment in memory and keeps only the pids, so
 * nothing of another program's environment is ever written down.
 */
export async function marked(runId, { self = process.pid } = {}) {
  const needle = ` ${MARK}=${runId}`;
  return (await table('pid=,command=', { environment: true }))
    .filter(line => line.includes(needle))
    .map(line => Number(line.trim().split(/\s+/, 1)[0]))
    .filter(pid => pid !== self);
}

/** Kills each marked process that is still running, after its group went. Answers how many it found. */
export async function sweep(runId, { kill = pid => process.kill(pid, 'SIGKILL') } = {}) {
  const left = await marked(runId);
  for (const pid of left) {
    try {
      kill(pid);
    } catch {
      // Gone between the read and the kill.
    }
  }
  return left.length;
}

const MOST_READ_BYTES = 8 * 1024 * 1024;

/**
 * The tokens a session file added since `offset`, read from where the last read stopped, so a long run is never read whole twice. Every
 * entry with usage counts: the agent's own messages, summaries and cache warming.
 */
export function tokensSince(sessionFile, offset = 0) {
  if (!existsSync(sessionFile)) return { tokens: 0, offset };
  const size = statSync(sessionFile).size;
  if (size <= offset) return { tokens: 0, offset };
  const length = Math.min(size - offset, MOST_READ_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(sessionFile, 'r');
  try {
    readSync(fd, buffer, 0, length, offset);
  } finally {
    closeSync(fd);
  }
  const text = buffer.toString('utf8');
  // Only whole lines count; the rest is read next time.
  const whole = text.lastIndexOf('\n') + 1;
  let tokens = 0;
  for (const line of text.slice(0, whole).split('\n')) {
    if (!line.includes('"totalTokens"')) continue;
    try {
      const entry = JSON.parse(line);
      tokens += entry.usage?.totalTokens ?? entry.message?.usage?.totalTokens ?? 0;
    } catch {
      // A line that is not an entry adds nothing.
    }
  }
  return { tokens, offset: offset + Buffer.byteLength(text.slice(0, whole)) };
}

/** The last thing an agent's session says went wrong, from its end: the error its last reply stopped on, or null when it ended well. */
export function lastError(sessionFile) {
  if (!existsSync(sessionFile)) return null;
  const size = statSync(sessionFile).size;
  const length = Math.min(size, 256 * 1024);
  const buffer = Buffer.alloc(length);
  const fd = openSync(sessionFile, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  const replies = buffer.toString('utf8').split('\n').flatMap(line => {
    try {
      const entry = JSON.parse(line);
      return entry.type === 'message' && entry.message?.role === 'assistant' ? [entry.message] : [];
    } catch {
      return [];
    }
  });
  const last = replies.at(-1);
  return last?.stopReason === 'error' ? last.errorMessage ?? 'The model stopped on an error.' : null;
}
