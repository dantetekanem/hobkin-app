import { join } from 'node:path'
import { Unavailable } from './commands.ts'
import { listLauncher, type Launcher, type LauncherRun } from './launcher-models.ts'

/**
 * The first-run setup of a work computer asks for the command the company provides to start Pi (025-onboarding). It is
 * kept as the `launcher` in the hobkin config only after it has listed models, the way hobkin's own setup check asks.
 */

/** Words as a shell reads them: split on spaces, with single or double quotes keeping a word whole. */
export function splitCommand(text: string): string[] {
  const words: string[] = []
  let word = ''
  let quote: string | null = null
  let started = false
  for (const char of text.trim()) {
    if (quote) {
      if (char === quote) quote = null
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started || word) words.push(word)
      word = ''
      started = false
    } else word += char
  }
  if (quote) throw new Unavailable('The command has a quote that is never closed.')
  if (started || word) words.push(word)
  return words
}

export interface UseLauncherDeps {
  run?: LauncherRun
  /** hobkin's own rule for a launcher: it throws a plain sentence for one it would refuse. */
  validate: (launcher: Launcher) => void
  /** The home's config as it is now, and its replacement, written whole through hobkin's own code. */
  read: () => Record<string, unknown>
  write: (config: Record<string, unknown>) => void
  /** Starts the main conversation again, so it runs behind the launcher. */
  restart: () => Promise<void>
}

/**
 * Tests the command by asking it for its models, and keeps it as the launcher in the config only when it lists some.
 * A command that lists none is refused with what it printed, and nothing is written. Never replaces another launcher.
 */
export async function useLauncher(text: string, { run, validate, read, write, restart }: UseLauncherDeps): Promise<Launcher> {
  const command = splitCommand(text)
  if (!command.length) throw new Unavailable('Type the command that starts Pi.')
  const launcher: Launcher = { command }
  try {
    validate(launcher)
  } catch (error) {
    throw new Unavailable(`hobkin cannot use that command: ${error instanceof Error ? error.message : String(error)}`)
  }
  const config = read()
  if (config.launcher !== undefined) throw new Unavailable('The hobkin config already names a launcher.')

  try {
    await listLauncher(launcher, run)
  } catch (error) {
    throw new Unavailable(`\`${command.join(' ')}\` listed no models. It printed:\n${error instanceof Error ? error.message : String(error)}`)
  }
  write({ ...config, launcher })
  await restart()
  return launcher
}

/** The launcher the home's `config.json` names now, read each time with hobkin's own code. Undefined when it names none. */
export async function configLauncher(root: string): Promise<Launcher | undefined> {
  const { loadConfig } = await import('hobkin/src/cli/config.mjs')
  return loadConfig(root).launcher as Launcher | undefined
}

/**
 * hobkin's own checks and write for the home's config, as `useLauncher` takes them. A new home has no config until its
 * main conversation first opens (`prepareHome` in owner.ts), and on a work computer that cannot open before the launcher
 * is kept. So reading the config makes it first, the same way, for a home that has none; one that has it is only read.
 */
export async function configDeps(root: string): Promise<Pick<UseLauncherDeps, 'validate' | 'read' | 'write'>> {
  const { atomicJson, initialize, validateConfig } = await import('hobkin/src/cli/config.mjs')
  const { validateLauncher } = await import('hobkin/src/cli/launcher.mjs')
  const { resolveDataRoot } = await import('hobkin/src/cli/migration/admission.mjs')
  return {
    validate: (launcher) => validateLauncher(launcher),
    read: () => ({ ...initialize(root, { cwd: root }) }),
    write: (config) => {
      validateConfig(config, { allowLegacyHarness: true })
      atomicJson(join(resolveDataRoot(root), 'config.json'), config)
    },
  }
}
