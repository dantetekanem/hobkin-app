import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';

export const TASKPOLICY = '/usr/sbin/taskpolicy';

/**
 * An agent's process, and what it starts, runs at utility priority on macOS, so the window and the host keep the fast cores when every
 * core is busy. `taskpolicy` replaces itself with the command, so the process id, its signals and its pipes stay the command's own.
 * On any other system, or a Mac without `taskpolicy`, the command is returned as it was.
 */
export function atUtilityPriority(command, args = [], { platform = process.platform, taskpolicy = TASKPOLICY, exists = existsSync } = {}) {
  if (platform !== 'darwin' || !exists(taskpolicy)) return { command, args };
  return { command: taskpolicy, args: ['-c', 'utility', command, ...args] };
}

/**
 * Whether `program` is a file that can run where spawn finds it: a path from `cwd`, or a name on `path`. One that cannot is started as it
 * is, so its failure names it (ENOENT, EACCES) instead of reading as taskpolicy's.
 */
export function canRun(program, { cwd = process.cwd(), path = process.env.PATH } = {}) {
  const name = String(program);
  const places = name.includes('/') ? [resolve(cwd, name)] : String(path ?? '').split(delimiter).filter(Boolean).map(folder => resolve(cwd, folder, name));
  return places.some(place => {
    try {
      accessSync(place, constants.X_OK);
      return statSync(place).isFile();
    } catch {
      return false;
    }
  });
}
