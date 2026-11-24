import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkIntegration, registerIntegration, unregisterIntegration } from '#shared/commands/registry.ts'
import type { IntegrationManifest } from '#shared/integration/manifest.ts'
import type { PullRequest } from '#shared/protocol/pulls.ts'
import { Unavailable, type CommandHooks } from './commands.ts'
import type { CommandCall, CommandDone, CommandSource, HostContext, HostPart, HostPartFactory, Merged, ToolCall } from './integration-contract.ts'
import { REPOSITORY_ROOT } from './home.ts'
import type { GhCall } from './review/gh.ts'
import type { WorkApp } from './work.ts'

/**
 * The integrations the host runs (_specs/064-integration-drops): the folders under `integrations/`, each with a
 * manifest and, if it has one, a host part. The core never imports one by name. This finds them when the host starts,
 * gives each part its context, and passes on what the host does: commands, tool calls, merges, state. A folder that
 * fails anywhere is logged with why and left out whole, its commands never registered.
 */

/** A folder's code, ready made: what a test hands in instead of a folder on disk. */
export interface IntegrationModule {
  /** The folder's name, which the manifest's id must equal. */
  folder: string
  manifest: IntegrationManifest
  host?: HostPartFactory
}

/** The pull requests the integrations know, as Change Review's background reads them. */
export interface KnownPulls {
  mine: readonly PullRequest[]
  waiting: readonly PullRequest[]
  sample: boolean
}

export interface IntegrationHostOptions {
  /** A folder holding one folder per integration, or the modules themselves. The repository's own folder when not given. */
  integrations?: string | readonly IntegrationModule[]
  live: boolean
  gh?: GhCall
  /** What a test hands each integration, by id. */
  integrationOptions?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  log?: (line: string) => void
  /** An integration's state changed: the host publishes. */
  changed: () => void
  connected: () => boolean
  hobkin: () => WorkApp
  dataRoot: () => string
  snapshotWork: () => unknown
}

/** The folder the repository keeps its integrations in. */
export const INTEGRATIONS_FOLDER = join(REPOSITORY_ROOT, 'integrations')

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The first thing wrong with a manifest's shape, or null. What the registry also checks is left to it. */
function manifestProblem(manifest: unknown): string | null {
  const given = manifest as Partial<IntegrationManifest> | null
  if (!given || typeof given !== 'object') return 'integration.ts has no default export'
  for (const field of ['id', 'name', 'line'] as const) if (typeof given[field] !== 'string') return `its manifest has no ${field}`
  if (!given.commands || typeof given.commands !== 'object') return 'its manifest has no commands'
  for (const [name, command] of Object.entries(given.commands)) {
    if (!command || typeof command.description !== 'string' || !command.args || (command.runs !== 'host' && command.runs !== 'view')) return `${name} is not a command definition`
  }
  if (!Array.isArray(given.screens)) return 'its manifest has no screens'
  for (const screen of given.screens) {
    if (!screen || typeof screen.id !== 'string' || typeof screen.label !== 'string' || typeof screen.line !== 'string' || !Array.isArray(screen.keywords)) return 'a screen is not a screen definition'
  }
  return null
}

/** Whether a folder holds an integration: not hidden, and a folder. */
const isFolder = (path: string, name: string): boolean => !name.startsWith('.') && statSync(path, { throwIfNoEntry: false })?.isDirectory() === true

/** Imports each folder's `integration.ts`, and its `host.ts` when it has one. A folder that cannot be loaded is logged and left out. */
async function modulesIn(folder: string, log: (line: string) => void): Promise<IntegrationModule[]> {
  if (!existsSync(folder)) return []
  const found: IntegrationModule[] = []
  for (const name of readdirSync(folder).sort()) {
    const path = join(folder, name)
    if (!isFolder(path, name)) continue
    try {
      const manifestFile = join(path, 'integration.ts')
      if (!existsSync(manifestFile)) throw Error('it has no integration.ts')
      const manifest = ((await import(pathToFileURL(manifestFile).href)) as { default?: IntegrationManifest }).default as IntegrationManifest
      const hostFile = join(path, 'host.ts')
      let host: HostPartFactory | undefined
      if (existsSync(hostFile)) {
        const factory = ((await import(pathToFileURL(hostFile).href)) as { default?: unknown }).default
        if (typeof factory !== 'function') throw Error('host.ts has no default export that is a function')
        host = factory as HostPartFactory
      }
      found.push({ folder: name, manifest, ...(host ? { host } : {}) })
    } catch (error) {
      log(`The integration ${name} is left out: ${message(error)}`)
    }
  }
  return found
}

const isRefusal = (error: unknown): boolean => error instanceof Unavailable || (error instanceof Error && error.constructor.name === 'Unavailable')

interface Running {
  manifest: IntegrationManifest
  part: HostPart
  log: (line: string) => void
}

export class IntegrationHost {
  private readonly running: Running[]

  private constructor(running: Running[]) {
    this.running = running
  }

  /** Loads every integration. One that fails is logged and left out, and never fails the host. */
  static async load(options: IntegrationHostOptions): Promise<IntegrationHost> {
    const log = options.log ?? (() => {})
    const given = options.integrations ?? INTEGRATIONS_FOLDER
    const modules = typeof given === 'string' ? await modulesIn(given, log) : [...given].sort((left, right) => left.folder.localeCompare(right.folder))
    const running: Running[] = []
    for (const { folder, manifest, host } of modules) {
      try {
        const problem = manifestProblem(manifest)
        if (problem) throw Error(problem)
        if (manifest.id !== folder) throw Error(`its manifest's id is "${manifest.id}", not its folder's name`)
        // Asked before its code runs, so a folder the app refuses has run nothing.
        checkIntegration(manifest)
        const id = manifest.id
        const say = (line: string) => log(`${id}: ${line}`)
        const context: HostContext = {
          id,
          live: options.live,
          ...(options.gh ? { gh: options.gh } : {}),
          options: Object.freeze({ ...options.integrationOptions?.[id] }),
          log: say,
          changed: options.changed,
          connected: options.connected,
          hobkin: options.hobkin,
          dataRoot: options.dataRoot,
          snapshotWork: options.snapshotWork,
        }
        const part: HostPart = host ? await host(context) : {}
        if (!part || typeof part !== 'object') throw Error('host.ts did not give a part')
        const stray = Object.keys(part.handlers ?? {}).find((name) => !Object.hasOwn(manifest.commands, name))
        if (stray) throw Error(`host.ts handles ${stray}, which its manifest does not have`)
        registerIntegration(manifest)
        running.push({ manifest, part, log: say })
      } catch (error) {
        log(`The integration ${folder} is left out: ${message(error)}`)
      }
    }
    return new IntegrationHost(running)
  }

  /** The ids of the integrations that loaded, in order. */
  ids(): string[] {
    return this.running.map(({ manifest }) => manifest.id)
  }

  /** The parts' handlers, merged. */
  handlers(): Record<string, (args: never) => unknown> {
    return Object.assign({}, ...this.running.map(({ part }) => part.handlers ?? {}))
  }

  /** Each part's state by its id. A part with none, or whose state cannot be read, is left out. */
  slices(): Record<string, unknown> {
    const slices: Record<string, unknown> = {}
    for (const { manifest, part, log } of this.running) {
      if (!part.state) continue
      try {
        slices[manifest.id] = part.state()
      } catch (error) {
        log(`Its state could not be read: ${message(error)}`)
      }
    }
    return slices
  }

  /** What the hooks give `runCommand`, for a command that came `from` the window or hobkin. */
  hooks(from: CommandSource): CommandHooks {
    return { from, before: (call) => this.before(call), after: (done) => this.after(done) }
  }

  /** Before a command runs: the reason a part refused it, or null. What else a hook throws is logged and ignored. */
  async before(call: CommandCall): Promise<string | null> {
    for (const { part, log } of this.running) {
      if (!part.beforeCommand) continue
      try {
        await part.beforeCommand(call)
      } catch (error) {
        if (isRefusal(error)) return message(error)
        log(`beforeCommand failed for ${call.name}: ${message(error)}`)
      }
    }
    return null
  }

  /** After a command ended, with how. */
  after(done: CommandDone): void {
    this.tell((part) => part.afterCommand?.(done), `afterCommand failed for ${done.name}`)
  }

  /** A tool call of an agent, as it starts or as it ends. */
  toolCall(call: ToolCall): void {
    this.tell((part) => part.onToolCall?.(call), `onToolCall failed for ${call.name}`)
  }

  /** A pull request that merged through the app. */
  merged(pull: Merged): void {
    this.tell((part) => part.onMerged?.(pull), 'onMerged failed')
  }

  /**
   * The open pull requests the parts know, together, or null when none says. A part with made-up ones is heard only
   * when no part has real ones, so a sample is never reviewed beside the real.
   */
  pulls(): KnownPulls | null {
    const known: KnownPulls[] = []
    for (const { part, log } of this.running) {
      if (!part.pulls) continue
      try {
        const pulls = part.pulls()
        if (pulls) known.push({ mine: pulls.mine, waiting: pulls.waiting, sample: pulls.sample })
      } catch (error) {
        log(`Its pull requests could not be read: ${message(error)}`)
      }
    }
    if (!known.length) return null
    const real = known.filter(({ sample }) => !sample)
    const used = real.length ? real : known
    return { mine: used.flatMap(({ mine }) => mine), waiting: used.flatMap(({ waiting }) => waiting), sample: real.length === 0 }
  }

  /** Once the host is serving. */
  start(): void {
    this.tell((part) => part.start?.(), 'start failed')
  }

  /** Once the host stops: the parts close, and the commands and screens leave the registry. */
  close(): void {
    this.tell((part) => part.close?.(), 'close failed')
    for (const { manifest } of this.running) unregisterIntegration(manifest)
  }

  /** Calls a hook on each part. What it throws, or what a promise it returns rejects with, is logged and changes nothing. */
  private tell(call: (part: HostPart) => unknown, what: string): void {
    for (const { part, log } of this.running) {
      try {
        const result = call(part)
        if (result instanceof Promise) result.catch((error: unknown) => log(`${what}: ${message(error)}`))
      } catch (error) {
        log(`${what}: ${message(error)}`)
      }
    }
  }
}
