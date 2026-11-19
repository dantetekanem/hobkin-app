import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

/** The folder a path really is, following links. A path that does not exist yet is itself. */
function actual(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** A home upgraded in place keeps its data in `migration/<id>/data`, and that data is still the home's. */
function homeOf(root) {
  const upgraded = basename(root) === 'data' && basename(dirname(dirname(root))) === 'migration';
  return upgraded ? dirname(dirname(dirname(root))) : root;
}

/** The home the user's hobkin runs on: `~/.hobkin`, or the folder `HOBKIN_HOME` names, compared by real path. */
export function isRealHome(root, { env = process.env, userHome = homedir() } = {}) {
  const named = env.HOBKIN_HOME ? [env.HOBKIN_HOME] : [];
  const realHomes = [join(userHome, '.hobkin'), ...named].map(actual);
  return realHomes.includes(homeOf(actual(root)));
}

/**
 * Only the real home talks to hobkin's server. Any other home, such as one a test opens, never enrolls and never
 * sends usage or feedback, unless its caller hands over a fetch of its own.
 */
export function talksToServer(root, { fetch } = {}) {
  const ownFetch = typeof fetch === 'function' && fetch !== globalThis.fetch;
  return ownFetch || isRealHome(root);
}
