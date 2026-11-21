import { readFileSync, realpathSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

/**
 * hobkin's lock on a home, so one process runs hobkin in it at a time. The holder refreshes it every 10 seconds, and a
 * lock nobody refreshed for 5 minutes is free. A holder killed outright, as a host is when it does not close in time,
 * never lets go, and its home used to stay shut for those 5 minutes. So the holder writes down its process and which
 * lock it took, and a lock whose holder no longer runs is taken over at once.
 */
export const LOCKED = 'Hobkin is already running for this home.';
const STALE_MS = 300_000;
const UPDATE_MS = 10_000;

const lockPath = directory => `${realpathSync(directory)}.lock`;
const holderPath = directory => join(directory, 'lock-holder.json');

/** Which lock is there: one made again in the same place is another lock. */
function lockNow(directory) {
  const lock = statSync(lockPath(directory), { throwIfNoEntry: false });
  return lock ? `${lock.ino}:${lock.birthtimeMs}` : null;
}

function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** The lock is there, and the process that wrote it down as its own no longer runs. */
export function lockHolderGone(directory) {
  const lock = lockNow(directory);
  if (!lock) return false;
  try {
    const holder = JSON.parse(readFileSync(holderPath(directory), 'utf8'));
    return holder.lock === lock && Number.isInteger(holder.pid) && !running(holder.pid);
  } catch {
    return false;
  }
}

/** Takes the lock on `directory` and returns its release, or fails with `LOCKED` while another process holds it. */
export async function lockHome(directory, { onCompromised }) {
  const take = () => lockfile.lock(directory, { retries: 0, stale: STALE_MS, update: UPDATE_MS, onCompromised }).catch(error => {
    throw error.code === 'ELOCKED' ? Error(LOCKED) : error;
  });
  let release;
  try {
    release = await take();
  } catch (error) {
    if (error.message !== LOCKED || !lockHolderGone(directory)) throw error;
    try {
      rmdirSync(lockPath(directory));
    } catch {
      // Another process took it over first, and the next take says so.
    }
    release = await take();
  }
  try {
    writeFileSync(holderPath(directory), `${JSON.stringify({ pid: process.pid, lock: lockNow(directory) })}\n`, { mode: 0o600 });
  } catch {
    // Without it, a holder that is killed keeps the home shut for the 5 minutes, as before.
  }
  return release;
}
