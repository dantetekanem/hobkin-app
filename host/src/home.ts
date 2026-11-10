import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repository this host runs from. Its `.dev-home` is the development home. */
export const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

export interface HomeRequest {
  /** The folder named with `--home`. */
  home?: string | null
  userHome?: string
  repoRoot?: string
  env?: { HOBKIN_HOME?: string }
}

export interface ResolvedHome {
  root: string
  /** The home the terminal app uses: `~/.hobkin`, or what `HOBKIN_HOME` names. */
  real: boolean
  /** What to tell the person starting the host. */
  notice: string | null
}

/** The folder a path really is, following links. A path that does not exist yet is itself. */
const actual = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Which home to open. Development never reaches the real home by accident: without `--home` it is `.dev-home`
 * in this repository, and a development home that turns out to be the real one is refused. `HOBKIN_HOME` only
 * says where the real home is. It never chooses the home, because a shell that exports it would then open it unasked.
 */
export function resolveHome({ home = null, userHome = homedir(), repoRoot = REPOSITORY_ROOT, env = process.env }: HomeRequest = {}): ResolvedHome {
  const root = resolve(home ?? join(repoRoot, '.dev-home'))
  const realHomes = [join(userHome, '.hobkin'), ...(env.HOBKIN_HOME ? [env.HOBKIN_HOME] : [])].map(actual)
  const real = realHomes.includes(actual(root))

  if (real && home === null) {
    throw Error(`${root} is the real hobkin home. The host opens it only when --home names it.`)
  }
  return { root, real, notice: real ? `Using the real hobkin home at ${root}.` : null }
}
