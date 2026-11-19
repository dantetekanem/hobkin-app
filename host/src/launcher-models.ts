import { execFile } from 'node:child_process'
import type { ModelChoice, ProviderAccess } from '#shared/protocol/models.ts'
import type { ModelAccess } from './model-access.ts'

/**
 * The launcher named in hobkin's `config.json`, as hobkin's own `hobkin setup` check treats it (its
 * `src/cli/launcher.mjs`, `src/cli/setup.mjs`): a command that starts Pi, so a Pi that company tooling wraps. Pi inside
 * this process never sees the providers or credentials the launcher brings, so the launcher is asked for its models,
 * with `--no-approve --list-models`, and counts as one connected account.
 */
export interface Launcher {
  command: string[]
  env?: Record<string, string>
  managedExtensions?: boolean
}

/** The id of the one account the launcher makes. */
export const LAUNCHER_ACCOUNT = 'launcher'

const ASK_MS = 15_000
/** How long an answer is kept before the launcher is asked again. */
export const LAUNCHER_KEEP_MS = 5 * 60_000

/** Every thinking level the picker knows, lowest first. Pi brings a level down to what a model has. */
const THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export interface LauncherModel {
  provider: string
  id: string
  thinks: boolean
  contextWindow: number | null
}

const SIZE = /^(\d+(?:\.\d+)?)([KkMm])?$/

function sizeOf(text: string | undefined): number | null {
  const found = SIZE.exec(text ?? '')
  if (!found) return null
  const unit = found[2]?.toUpperCase()
  return Math.round(Number(found[1]) * (unit === 'M' ? 1_000_000 : unit === 'K' ? 1000 : 1))
}

/** Pi prints a table, or a paragraph when it has no model, and the paragraph can hold a path with spaces. */
export function parseLauncherModels(text: string): LauncherModel[] {
  const [header = '', ...lines] = text.split('\n')
  const names = header.trim().split(/\s+/)
  if (names[0] !== 'provider' || names[1] !== 'model') return []
  const thinking = names.indexOf('thinking')
  const context = names.indexOf('context')
  const models: LauncherModel[] = []
  for (const line of lines) {
    const columns = line.trim().split(/\s+/)
    const [provider, id] = columns
    if (!provider || !id) continue
    models.push({ provider, id, thinks: thinking > 1 && columns[thinking]?.toLowerCase() === 'yes', contextWindow: context > 1 ? sizeOf(columns[context]) : null })
  }
  return models
}

export type LauncherRun = (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<{ text: string }>

const realRun: LauncherRun = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: ASK_MS, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', env }, (error, stdout, stderr) => {
      if (error) reject(error)
      // Pi prints its table on stdout, and some launchers print it on stderr.
      else resolve({ text: stdout.trim() ? stdout : stderr })
    })
  })

export interface LauncherAnswer {
  /** The one connected account the launcher makes, named by its command. */
  account: ProviderAccess
  models: ModelChoice[]
}

export interface LauncherModelsOptions {
  /** The launcher in the home's config now, read each time so a change is seen. Undefined when it names none. */
  launcher: () => Launcher | undefined | Promise<Launcher | undefined>
  run?: LauncherRun
  now?: () => number
}

/** Asks the launcher for its models, and keeps the answer five minutes, or until the launcher in the config changes. */
export class LauncherModels {
  private kept: { key: string; at: number; answer: Promise<LauncherAnswer | null> } | null = null
  private readonly run: LauncherRun
  private readonly now: () => number

  private readonly options: LauncherModelsOptions

  constructor(options: LauncherModelsOptions) {
    this.options = options
    this.run = options.run ?? realRun
    this.now = options.now ?? Date.now
  }

  /** The launcher's account and models, or null when the config names none, or it lists no model or could not be asked. */
  async list(): Promise<LauncherAnswer | null> {
    let launcher: Launcher | undefined
    try {
      launcher = await this.options.launcher()
    } catch {
      return null
    }
    if (!launcher) return null
    const key = JSON.stringify(launcher)
    const kept = this.kept
    if (kept && kept.key === key && this.now() - kept.at < LAUNCHER_KEEP_MS) return kept.answer
    const answer = this.ask(launcher)
    this.kept = { key, at: this.now(), answer }
    return answer
  }

  private async ask({ command, env = {} }: Launcher): Promise<LauncherAnswer | null> {
    const [file, ...rest] = command
    if (!file) return null
    try {
      const { text } = await this.run(file, [...rest, '--no-approve', '--list-models'], { ...process.env, ...env })
      const models = parseLauncherModels(text)
      if (!models.length) return null
      return {
        account: { id: LAUNCHER_ACCOUNT, name: command.join(' '), connected: true, connectedBy: 'launcher' },
        models: models.map(({ provider, id, thinks, contextWindow }) => ({ id, provider, name: id, thinking: thinks ? THINKING : ['off'], contextWindow })),
      }
    } catch {
      return null
    }
  }
}

/**
 * Pi's model access with the launcher's account and models added to what it lists, so the app counts as signed in.
 * A launcher that cannot be asked leaves the list as Pi alone gave it.
 */
export function withLauncher(access: ModelAccess, launcher: LauncherModels): ModelAccess {
  return {
    ...access,
    list: async () => {
      const [state, found] = await Promise.all([access.list(), launcher.list().catch(() => null)])
      if (!found) return state
      return { providers: [...state.providers, found.account], models: [...state.models, ...found.models] }
    },
  }
}
