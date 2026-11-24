import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { redactEntry, referencedNames, scrubText, writtenSecrets } from '#shared/integrations/redact.ts'
import { toolEffect } from '#shared/integrations/servers.ts'
import type { ConfiguredServer, PiServerEntry, ServerState, ServerTool } from '#shared/integrations/types.ts'
import { INTEGRATIONS_UNKNOWN, type IntegrationsState } from '#shared/integrations/wire.ts'
import { Unavailable } from './commands.ts'

/**
 * Integrations (_specs/023-integrations): every MCP server in Pi's user-level configuration, with the state Pi
 * reports for it. The host reads and writes that configuration only through Pi's own code (integrations-pi.ts), the
 * same code `pi mcp` and `/mcp` run, so the terminal app and `pi mcp list` see what this screen sees.
 *
 * It reads nothing and starts nothing until someone asks. A look connects to each server the way `pi mcp list` does,
 * reports where it got to, and closes again. Before anything leaves the host, every entry and every message has its
 * secrets hidden.
 */

/** One server as Pi reads it from its configuration: the entry as written, nothing hidden yet. It never leaves the host. */
export interface PiMcpServer {
  name: string
  config: PiServerEntry
}

/** A tool as a server lists it. Only what the screen shows. */
export interface PiMcpTool {
  name: string
  description?: string
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

/** Where a connection got to, in Pi's words for it (`McpServerConnection.state` in Pi's MCP runtime). */
export interface PiMcpCheck {
  state: 'connecting' | 'connected' | 'needs-auth' | 'failed' | 'disconnected' | 'closed'
  tools: PiMcpTool[]
  /** Pi's message when it did not connect. */
  error: string | null
}

/** Pi's MCP configuration and its connections: Pi's own code over its file, or a stand-in in tests. */
export interface McpSource {
  /** The file Pi reads the servers from. */
  readonly path: string
  /** The servers Pi reads from it, in its order, and what it could not read, in its own words. */
  load(): { servers: PiMcpServer[]; problems: string[] }
  /** Connects to one server as `pi mcp list` does, says where it got to as it goes, and closes again. */
  check(server: PiMcpServer, progress: (check: PiMcpCheck) => void, signal: AbortSignal): Promise<PiMcpCheck>
  /** Writes `enabled` for one server, as Pi's `/mcp` does. Everything else in the file stays as it was. */
  setEnabled(name: string, on: boolean): void
  /** Deletes an entry. False when the file does not have it. */
  remove(name: string): boolean
}

/**
 * The Pi agent folder Integrations reads and writes (023-integrations, A10). A live host uses Pi's own, where `pi` and
 * the terminal app look. A scripted host uses the folder named in PI_CODING_AGENT_DIR when one is named on purpose,
 * and otherwise the agent folder in its own home, so a host started for development never touches ~/.pi/agent.
 */
export function piAgentDirFor({ live, root, env, piAgentDir }: { live: boolean; root: string; env: Readonly<Record<string, string | undefined>>; piAgentDir: () => string }): string {
  return live || env.PI_CODING_AGENT_DIR ? piAgentDir() : join(root, 'client', 'scripted-agent')
}

const STATES: Record<PiMcpCheck['state'], ServerState> = {
  connecting: 'connecting',
  connected: 'connected',
  'needs-auth': 'sign-in',
  failed: 'failed',
  // The connection dropped after it was made. Pi says why, and the screen shows it as a server to look at.
  disconnected: 'failed',
  closed: 'failed',
}

/** How much of Pi's message the screen gets. Pi keeps the last part of what a failed server wrote, which is where the reason is. */
const MESSAGE_CHARS = 1500

/** The first sentence of a tool's description, on one line: what the screen shows beside its name. */
export function firstSentence(text = ''): string {
  const line = text.trim().split(/\r?\n/)[0]?.trim() ?? ''
  const end = line.search(/[.!?](\s|$)/)
  const sentence = end === -1 ? line : line.slice(0, end + 1)
  return sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}...` : sentence
}

/** Everything a server's messages must never show: what its entry holds written in, and what its variables hold now. */
function secretsOf(config: PiServerEntry): string[] {
  const values = referencedNames(config)
    .map((name) => process.env[name] ?? '')
    .filter((value) => value.length >= 4)
  return [...writtenSecrets(config), ...values]
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** A path the way the screen names it: ~ for the home folder. */
function shownPath(path: string): string {
  const home = homedir()
  return path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path
}

export interface IntegrationsOptions {
  /** Pi's configuration and connections. Opened when first needed, since it loads Pi. */
  source: () => Promise<McpSource>
  /** The state changed. */
  onChange: () => void
  log?: (line: string) => void
}

export class Integrations {
  private current: IntegrationsState = INTEGRATIONS_UNKNOWN
  private opened: Promise<McpSource> | null = null
  private looking: Promise<IntegrationsState> | null = null
  /** Each server's entry as Pi read it last. It never leaves the host. */
  private configs = new Map<string, PiServerEntry>()
  /** The check under way for each server, so a newer one or a change to the server can stop it. */
  private readonly checks = new Map<string, AbortController>()
  private closed = false
  private readonly options: IntegrationsOptions

  constructor(options: IntegrationsOptions) {
    this.options = options
  }

  get state(): IntegrationsState {
    return this.current
  }

  /** Reads Pi's configuration again and looks at every server that is on. A look already under way answers this one too. */
  refresh(): Promise<IntegrationsState> {
    this.looking ??= this.look().finally(() => {
      this.looking = null
    })
    return this.looking
  }

  async turnOff(name: string): Promise<IntegrationsState> {
    const source = await this.known(name)
    this.stopCheck(name)
    this.write(() => source.setEnabled(name, false))
    this.read(source)
    return this.current
  }

  async turnOn(name: string): Promise<IntegrationsState> {
    const source = await this.known(name)
    this.write(() => source.setEnabled(name, true))
    this.read(source)
    await this.checkOne(source, name)
    return this.current
  }

  async remove(name: string): Promise<IntegrationsState> {
    const source = await this.known(name)
    this.stopCheck(name)
    if (!this.write(() => source.remove(name))) throw new Unavailable(`Pi's configuration has no server named "${name}".`)
    this.read(source)
    return this.current
  }

  close(): void {
    this.closed = true
    for (const name of [...this.checks.keys()]) this.stopCheck(name)
  }

  private async look(): Promise<IntegrationsState> {
    const source = await this.source().catch(() => null)
    if (!source || this.closed) return this.current
    this.change({ checking: true })
    if (!this.read(source)) {
      this.change({ checking: false })
      return this.current
    }
    await Promise.all([...this.configs].filter(([, config]) => config.enabled !== false).map(([name]) => this.checkOne(source, name)))
    this.change({ checking: false, checkedAt: new Date().toISOString() })
    return this.current
  }

  /** Pi's code, loaded once. When this Pi does not have what Integrations uses, the screen says so. */
  private source(): Promise<McpSource> {
    this.opened ??= this.options.source().catch((error: unknown) => {
      this.opened = null
      const message = `Integrations could not load Pi's MCP support: ${scrubText(messageOf(error))}`
      this.options.log?.(message)
      this.change({ error: message })
      throw new Unavailable(message)
    })
    return this.opened
  }

  /** The source, after reading the file again, when it has a server by this name. */
  private async known(name: string): Promise<McpSource> {
    const source = await this.source()
    this.read(source)
    if (!this.configs.has(name)) throw new Unavailable(`Pi's configuration has no server named "${name}".`)
    return source
  }

  /** A change to Pi's file, through Pi. What Pi says when it refuses goes back to whoever asked, without secrets. */
  private write<Result>(change: () => Result, refusal = 'Pi could not change its configuration'): Result {
    try {
      return change()
    } catch (error) {
      throw new Unavailable(`${refusal}: ${scrubText(messageOf(error))}`)
    }
  }

  /**
   * Reads the file again. A server that is turned off is off. One that is on keeps what was last seen of it while its
   * entry is the same, and is connecting otherwise, until it is looked at. False when the file could not be read.
   */
  private read(source: McpSource): boolean {
    let loaded: ReturnType<McpSource['load']>
    try {
      loaded = source.load()
    } catch (error) {
      const message = `Could not read Pi's configuration: ${scrubText(messageOf(error))}`
      this.options.log?.(message)
      this.change({ path: shownPath(source.path), error: message })
      return false
    }
    const before = this.configs
    this.configs = new Map(loaded.servers.map(({ name, config }) => [name, config]))
    const servers = loaded.servers.map(({ name, config }) => {
      if (config.enabled === false) return this.listed(name, config, 'off')
      const seen = this.current.servers.find((server) => server.name === name)
      const same = seen && seen.state !== 'off' && JSON.stringify(before.get(name)) === JSON.stringify(config)
      return same ? { ...seen, entry: redactEntry(config) } : this.listed(name, config, 'connecting')
    })
    this.change({ path: shownPath(source.path), servers, problems: loaded.problems.map((problem) => scrubText(problem)), error: null })
    return true
  }

  /** A server the way it leaves the host: its entry and its message with their secrets hidden, its tools marked. */
  private listed(name: string, config: PiServerEntry, state: ServerState, check?: PiMcpCheck): ConfiguredServer {
    const known = secretsOf(config)
    const tools: ServerTool[] =
      state === 'connected' && check ? check.tools.map((tool) => ({ name: tool.name, does: scrubText(firstSentence(tool.description), known), effect: toolEffect(tool.annotations) })) : []
    const error = state === 'failed' && check?.error ? scrubText(check.error, known).slice(-MESSAGE_CHARS) : null
    return { name, entry: redactEntry(config), state, tools, error }
  }

  /** Connects to one server, through Pi, and shows each step. A newer check of the same server, or closing, stops it. */
  private async checkOne(source: McpSource, name: string): Promise<void> {
    const config = this.configs.get(name)
    if (!config || config.enabled === false || this.closed) return
    this.stopCheck(name)
    const stop = new AbortController()
    this.checks.set(name, stop)
    const show = (check: PiMcpCheck) => {
      if (stop.signal.aborted || this.closed || this.configs.get(name) !== config) return
      this.replace(this.listed(name, config, STATES[check.state], check))
    }
    try {
      show(await source.check({ name, config }, show, stop.signal))
    } catch (error) {
      show({ state: 'failed', tools: [], error: messageOf(error) })
    } finally {
      if (this.checks.get(name) === stop) this.checks.delete(name)
    }
  }

  private stopCheck(name: string): void {
    this.checks.get(name)?.abort()
    this.checks.delete(name)
  }

  private replace(server: ConfiguredServer): void {
    if (!this.current.servers.some(({ name }) => name === server.name)) return
    this.change({ servers: this.current.servers.map((other) => (other.name === server.name ? server : other)) })
  }

  private change(change: Partial<IntegrationsState>): void {
    this.current = { ...this.current, ...change }
    this.options.onChange()
  }
}
