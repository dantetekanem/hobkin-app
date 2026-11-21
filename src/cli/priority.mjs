import { existsSync } from 'node:fs';

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
