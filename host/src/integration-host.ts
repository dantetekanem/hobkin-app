import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Check, Errors } from 'typebox/value'
import { checkIntegration, registerIntegration, unregisterIntegration } from '#shared/commands/registry.ts'
import type { IntegrationManifest } from '#shared/integration/manifest.ts'
import type { PullRequest } from '#shared/protocol/pulls.ts'
import { Unavailable, type CommandHooks } from './commands.ts'
import type { AgentTool, CommandCall, CommandDone, CommandSource, HookedCall, HostContext, HostPart, HostPartFactory, Merged, ToolCall, ToolHooks } from './integration-contract.ts'
import { REPOSITORY_ROOT } from './home.ts'
import type { GhCall } from './review/gh.ts'
import type { WorkApp } from './work.ts'

/**
 * The integrations the host runs (_specs/065-integration-drops): the folders under `integrations/`, each with a
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
  /** The folder of its workflows (`workflows/<name>.md`), when it has one. */
  workflows?: string
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
  /** hobkin's workflows: starts one by its id (`<integration>/<name>`), and the rows of the snapshot's `schedules`, which say what starts each. Without it no workflow starts. */
  workflows?: {
    start(id: string, input?: unknown): Promise<{ run: string }>
    rows(): readonly unknown[]
  }
  /** How long a tool hook may take before the call goes on without it. Ten seconds when not given. */
  hookTimeoutMs?: number
}

/** What the host hands hobkin's application as `integrations` (hobkin's `src/cli/integrations.mjs`). */
export interface RuntimeIntegrations {
  tools(): { name: string; description: string; parameters: Record<string, unknown>; agents?: readonly string[] }[]
  callTool(name: string, args: unknown, call: { agent: string; id: string }, signal?: AbortSignal): Promise<{ text: string; failed?: boolean }>
  hookedTools(): string[] | 'all'
  beforeTool(call: HookedCall): Promise<{ block: string } | { args: Record<string, unknown> } | null>
  afterTool(call: HookedCall, result: { text: string; failed: boolean }): Promise<{ text?: string; failed?: boolean } | null>
  workflowFolders(): { id: string; folder: string; tools: string[] }[]
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
      const workflows = join(path, 'workflows')
      found.push({ folder: name, manifest, ...(host ? { host } : {}), ...(isFolder(workflows, 'workflows') ? { workflows } : {}) })
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
  /** Its tools by the name agents know them by. */
  tools: Map<string, AgentTool<any>>
  workflows?: string
}

/** A tool's own short name. */
const TOOL_NAME = /^[a-z][a-z0-9_]{0,40}$/
const WORKFLOW_NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/
const TOOL_AGENTS = ['main', 'runs', 'durable']
const HOOK_MS = 10_000

const plain = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** The tools of a part by their names for agents, or the first thing wrong with them. */
function toolsOf(id: string, part: HostPart, taken: ReadonlySet<string>): Map<string, AgentTool<any>> {
  const tools = new Map<string, AgentTool<any>>()
  for (const tool of part.tools ?? []) {
    if (typeof tool?.name !== 'string' || !TOOL_NAME.test(tool.name)) throw Error(`a tool is named "${String(tool?.name)}", which is not a short name of lowercase letters, digits and _`)
    const full = `${id.replaceAll('-', '_')}_${tool.name}`
    if (tools.has(full) || taken.has(full)) throw Error(`the tool ${full} is given twice`)
    if (typeof tool.description !== 'string' || !tool.description.trim()) throw Error(`the tool ${tool.name} has no description`)
    if (!plain(tool.parameters) || tool.parameters.type !== 'object') throw Error(`the tool ${tool.name} has no object schema for its parameters`)
    if (typeof tool.execute !== 'function') throw Error(`the tool ${tool.name} has no execute`)
    if (tool.agents !== undefined && (!Array.isArray(tool.agents) || tool.agents.some((agent) => !TOOL_AGENTS.includes(agent)))) throw Error(`the tool ${tool.name} names agents that are not main, runs or durable`)
    tools.set(full, tool)
  }
  return tools
}

function hooksProblem(hooks: ToolHooks | undefined): string | null {
  if (hooks === undefined) return null
  if (!hooks || (hooks.tools !== 'all' && (!Array.isArray(hooks.tools) || hooks.tools.some((name) => typeof name !== 'string')))) return 'its toolHooks do not name the tools they hook'
  return null
}

const covers = (hooks: ToolHooks | undefined, name: string): boolean => hooks !== undefined && (hooks.tools === 'all' || hooks.tools.includes(name))

export class IntegrationHost {
  private readonly running: Running[]
  private readonly options: IntegrationHostOptions

  private constructor(running: Running[], options: IntegrationHostOptions) {
    this.running = running
    this.options = options
  }

  /** Loads every integration. One that fails is logged and left out, and never fails the host. */
  static async load(options: IntegrationHostOptions): Promise<IntegrationHost> {
    const log = options.log ?? (() => {})
    const given = options.integrations ?? INTEGRATIONS_FOLDER
    const modules = typeof given === 'string' ? await modulesIn(given, log) : [...given].sort((left, right) => left.folder.localeCompare(right.folder))
    const running: Running[] = []
    for (const { folder, manifest, host, workflows } of modules) {
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
          startWorkflow: async (name, input) => {
            if (!options.workflows) throw new Unavailable('hobkin is not open in this host, so no workflow starts.')
            if (!WORKFLOW_NAME.test(name)) throw new Unavailable(`"${name}" is not a workflow's file name.`)
            return options.workflows.start(`${id}/${name}`, input)
          },
        }
        const part: HostPart = host ? await host(context) : {}
        if (!part || typeof part !== 'object') throw Error('host.ts did not give a part')
        const stray = Object.keys(part.handlers ?? {}).find((name) => !Object.hasOwn(manifest.commands, name))
        if (stray) throw Error(`host.ts handles ${stray}, which its manifest does not have`)
        const badHooks = hooksProblem(part.toolHooks)
        if (badHooks) throw Error(badHooks)
        const tools = toolsOf(id, part, new Set(running.flatMap((other) => [...other.tools.keys()])))
        registerIntegration(manifest)
        running.push({ manifest, part, log: say, tools, ...(workflows ? { workflows } : {}) })
      } catch (error) {
        log(`The integration ${folder} is left out: ${message(error)}`)
      }
    }
    return new IntegrationHost(running, options)
  }

  /** The ids of the integrations that loaded, in order. */
  ids(): string[] {
    return this.running.map(({ manifest }) => manifest.id)
  }

  /** Whether any part wants to hear tool calls, so the host looks for them only then. */
  hearsToolCalls(): boolean {
    return this.running.some(({ part }) => part.onToolCall !== undefined)
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
    this.startAfter(done)
  }

  /**
   * A command that ended well starts each workflow that lists `after:<command>` in its `on`, with the command, its
   * arguments and its answer as the input. A start that fails is logged and changes nothing.
   */
  private startAfter({ name, args, outcome }: CommandDone): void {
    const { workflows } = this.options
    if (!workflows || !outcome.ok) return
    let rows: readonly unknown[] = []
    try {
      rows = workflows.rows()
    } catch (error) {
      this.options.log?.(`Workflows could not be read: ${message(error)}`)
    }
    for (const row of rows) {
      const { id, on, integration, enabled } = (row ?? {}) as { id?: unknown; on?: unknown; integration?: unknown; enabled?: unknown }
      if (typeof id !== 'string' || typeof integration !== 'string' || enabled === false || !Array.isArray(on) || !on.includes(`after:${name}`)) continue
      workflows.start(id, { command: name, args, answer: outcome.value }).catch((error: unknown) => this.options.log?.(`${id} did not start after ${name}: ${message(error)}`))
    }
  }

  /**
   * What hobkin's application is given as `integrations`: the tools its parts offer, a call to run one, the tool
   * calls its parts hook, and the folders of workflows. Null when no part gives any, so no agent loads anything new.
   */
  runtimeOption(): RuntimeIntegrations | null {
    const folders = this.running.flatMap(({ manifest, tools, workflows }) => (workflows ? [{ id: manifest.id, folder: workflows, tools: [...tools.keys()] }] : []))
    const hooked = this.hookedTools()
    const offered = this.running.some(({ tools }) => tools.size > 0)
    if (!offered && hooked.length === 0 && !folders.length) return null
    return {
      tools: () => this.running.flatMap(({ tools }) => [...tools].map(([name, tool]) => ({
        name,
        description: tool.description,
        parameters: JSON.parse(JSON.stringify(tool.parameters)) as Record<string, unknown>,
        ...(tool.agents ? { agents: [...tool.agents] } : {}),
      }))),
      callTool: (name, args, call, signal) => this.callTool(name, args, call, signal),
      hookedTools: () => (hooked === 'all' ? 'all' : hooked),
      beforeTool: (call) => this.beforeTool(call),
      afterTool: (call, result) => this.afterTool(call, result),
      workflowFolders: () => folders,
    }
  }

  /** The tool names the parts hook, or every tool. */
  private hookedTools(): string[] | 'all' {
    const names = new Set<string>()
    for (const { part } of this.running) {
      const hooks = part.toolHooks
      if (!hooks || (!hooks.before && !hooks.after)) continue
      if (hooks.tools === 'all') return 'all'
      for (const name of hooks.tools) names.add(name)
    }
    return [...names]
  }

  private async callTool(name: string, args: unknown, call: { agent: string; id: string }, signal?: AbortSignal): Promise<{ text: string; failed?: boolean }> {
    const running = this.running.find(({ tools }) => tools.has(name))
    const tool = running?.tools.get(name)
    if (!running || !tool) return { text: `There is no tool named ${name}.`, failed: true }
    if (!Check(tool.parameters, args)) {
      const why = Errors(tool.parameters, args)[0]
      return { text: `${name} was given arguments that do not fit${why ? `: ${why.instancePath ? `${why.instancePath.slice(1).replaceAll('/', '.')} ` : ''}${why.message}` : ''}.`, failed: true }
    }
    try {
      const answer = await tool.execute(args, { agent: call.agent, id: call.id, ...(signal ? { signal } : {}) })
      return typeof answer === 'string' ? { text: answer } : { text: String(answer?.text ?? ''), ...(answer?.failed ? { failed: true } : {}) }
    } catch (error) {
      running.log(`The tool ${name} failed: ${message(error)}`)
      return { text: message(error), failed: true }
    }
  }

  /** Runs one hook, giving up on it after its time. */
  private async guarded<Value>(run: () => Value | Promise<Value>): Promise<{ ok: true; value: Value } | { ok: false; why: string }> {
    const ms = this.options.hookTimeoutMs ?? HOOK_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const slow = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error(`it did not answer within ${ms / 1000} seconds`)), ms)
      timer.unref()
    })
    try {
      return { ok: true, value: await Promise.race([Promise.resolve().then(run), slow]) }
    } catch (error) {
      return { ok: false, why: message(error) }
    } finally {
      clearTimeout(timer)
    }
  }

  /** The hooks of the parts, in folder order, that cover a tool. */
  private hooksFor(name: string, step: 'before' | 'after') {
    return this.running.filter(({ part }) => part.toolHooks?.[step] && covers(part.toolHooks, name))
  }

  private async beforeTool(call: HookedCall): Promise<{ block: string } | { args: Record<string, unknown> } | null> {
    let args = call.args
    let changed = false
    for (const { manifest, part, log } of this.hooksFor(call.name, 'before')) {
      const hooks = part.toolHooks!
      const answer = await this.guarded(() => hooks.before!({ ...call, args }))
      if (!answer.ok) {
        log(`Its before hook failed for ${call.name}, so the call ${hooks.failClosed ? 'was refused' : 'went through'}: ${answer.why}`)
        if (hooks.failClosed) return { block: `The ${manifest.id} integration's check of this call failed, so it was refused: ${answer.why}.` }
        continue
      }
      const value = answer.value as { block?: unknown; args?: unknown } | void
      if (value && typeof value.block === 'string' && value.block.trim()) return { block: value.block }
      if (value && plain(value.args)) {
        args = value.args
        changed = true
      }
    }
    return changed ? { args } : null
  }

  private async afterTool(call: HookedCall, result: { text: string; failed: boolean }): Promise<{ text?: string; failed?: boolean } | null> {
    let current = result
    let changed = false
    for (const { manifest, part, log } of this.hooksFor(call.name, 'after')) {
      const hooks = part.toolHooks!
      const answer = await this.guarded(() => hooks.after!(call, current))
      if (!answer.ok) {
        log(`Its after hook failed for ${call.name}, so ${hooks.failClosed ? 'its result was withheld' : 'the agent read it as it was'}: ${answer.why}`)
        if (hooks.failClosed) return { text: `The ${manifest.id} integration's check of this result failed, so it is withheld: ${answer.why}.`, failed: true }
        continue
      }
      const value = answer.value as { text?: unknown; failed?: unknown } | void
      if (value && (typeof value.text === 'string' || typeof value.failed === 'boolean')) {
        current = { text: typeof value.text === 'string' ? value.text : current.text, failed: typeof value.failed === 'boolean' ? value.failed : current.failed }
        changed = true
      }
    }
    return changed ? current : null
  }

  /** A tool call of an agent, as it starts or as it ends. */
  toolCall(call: ToolCall): void {
    this.tell((part) => part.onToolCall?.(call), `onToolCall failed for ${call.name}`)
  }

  /** A pull request that left the open ones: merged through the app, or merged or closed elsewhere as the host saw it. */
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
