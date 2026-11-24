import type { Static, TSchema } from 'typebox'
import type { PullRequest } from '#shared/protocol/pulls.ts'
import type { CommandOutcome } from './commands.ts'
import type { GhCall } from './review/gh.ts'
import type { WorkApp } from './work.ts'

/**
 * What an integration's host part is given and what it gives back (_specs/065-integration-drops). The folder's
 * `host.ts` default-exports a `HostPartFactory`. The host calls it once at start, with a context of its own, and never
 * imports anything else of the folder. Everything an integration does in the host goes through these two shapes.
 */

/** Who ran a command: a click or a key in the window, or hobkin through its `client` tool. */
export type CommandSource = 'window' | 'hobkin'

export interface CommandCall {
  name: string
  /** As checked against the command's schema. */
  args: unknown
  from: CommandSource
}

export interface CommandDone extends CommandCall {
  outcome: CommandOutcome
}

/**
 * One tool call of an agent, as the host sees it: in hobkin's main conversation (`agent` is `#main`) or in a run, by
 * the run's id. Each call is given when it starts and once more when it ends.
 */
export interface ToolCall {
  agent: string
  /** The call's id, unique within its agent. */
  id: string
  /** The tool's name, such as `bash` or `client`. */
  name: string
  /** Its arguments: the main conversation's as Pi gave them, a run's as the JSON text hobkin keeps for it. */
  args: unknown
  state: 'running' | 'completed' | 'failed'
  /** What it gave back, as text, once it has ended. A run's may be cut in the middle, as its feed keeps it. */
  output?: string
}

/** A pull request the host saw merge, by its address, or by its repository and number. */
export interface Merged {
  url?: string
  repo?: string
  number?: number
}

/** Which of hobkin's agents a tool goes to: the main conversation, its runs (routines, Work, sessions), or a durable hobkin's turns. */
export type ToolAgents = 'main' | 'runs' | 'durable'

/** What a tool's `execute` is told of the call. */
export interface ToolRun {
  /** The agent that called it: `#main` for the main conversation, or the run's id. */
  agent: string
  /** The call's id, unique within its agent. */
  id: string
  signal?: AbortSignal
}

/** What a tool gives the agent: its words, and whether the call failed. */
export type ToolAnswer = string | { text: string; failed?: boolean }

/**
 * A tool an integration gives agents (_specs/065-integration-drops). The host names it `<id with _ for ->_<name>`, so
 * `find_pull` of `github` is `github_find_pull`. Its `execute` runs in the host, and what it returns is what the agent
 * reads. One that throws is read as a failed call with the reason.
 */
export interface AgentTool<Parameters extends TSchema = TSchema> {
  /** Its own short name: lowercase letters, digits and `_`, starting with a letter. */
  name: string
  /** What it does and when to use it, as the agent reads it. */
  description: string
  parameters: Parameters
  /** Which agents get it. All three when left out. */
  agents?: readonly ToolAgents[]
  execute(args: Static<Parameters>, run: ToolRun): ToolAnswer | Promise<ToolAnswer>
}

/** A tool as a call names it, in the agent's own name for it, with its arguments. */
export interface HookedCall {
  agent: string
  id: string
  /** The tool's name as the agent knows it: `bash`, or `github_find_pull`. */
  name: string
  args: Record<string, unknown>
}

/**
 * Hooks on the calls of the tools a part names, or of every tool. Hooks run in folder order: the first refusal wins,
 * and changed arguments pass to the next hook. One that throws or has not answered in 10 seconds lets the call through
 * as it was, and the host logs why, unless `failClosed` says the call must be refused when the hook fails.
 */
export interface ToolHooks {
  /** The tools it hooks, by the names agents know them by, or every tool. */
  tools: readonly string[] | 'all'
  /** Before a call runs. Nothing lets it through, `{ block }` refuses it with a reason the agent reads, `{ args }` runs it with other arguments. */
  before?(call: HookedCall): void | { block: string } | { args: Record<string, unknown> } | Promise<void | { block: string } | { args: Record<string, unknown> }>
  /** After a call ended: what the agent reads instead, and whether it counts as failed. Nothing changes it. */
  after?(call: HookedCall, result: { text: string; failed: boolean }): void | { text?: string; failed?: boolean } | Promise<void | { text?: string; failed?: boolean }>
  failClosed?: boolean
}

export interface HostContext {
  /** The integration's id, its folder's name. */
  readonly id: string
  /** A live host: the user's own hobkin and the real services. A scripted host, for development and tests, is not. */
  readonly live: boolean
  /** gh, when this host may run it: a live host, or a scripted one started with `--github`. Absent otherwise. */
  readonly gh?: GhCall
  /** What a test hands this integration (`HostOptions.integrationOptions[id]`). Empty otherwise. */
  readonly options: Readonly<Record<string, unknown>>
  log(line: string): void
  /** Its state changed: the host asks `state()` again and sends it to the windows when it differs. */
  changed(): void
  /** A window is connected now. */
  connected(): boolean
  /** hobkin's application. Throws `Unavailable`, with the reason, while hobkin is not open in this host. */
  hobkin(): WorkApp
  /** The folder hobkin's home data is in. Throws `Unavailable` while hobkin is not open. */
  dataRoot(): string
  /** The `work` key of hobkin's snapshot as it is now, or undefined before hobkin has one. A new object each time it changes. */
  snapshotWork(): unknown
  /**
   * Starts one run of this integration's workflow (`workflows/<name>.md`) now, with `input` in the run's context as
   * `input`. Answers the run's id. Throws `Unavailable`, with the reason, when hobkin is not open, its runtime has no
   * workflows, or the workflow is unknown or turned off.
   */
  startWorkflow(name: string, input?: unknown): Promise<{ run: string }>
}

/** Everything is optional: an integration gives only what it uses. */
export interface HostPart {
  /** Its slice of the state: sent to every window whole whenever it differs, and with every reset. JSON only, and nothing secret. */
  state?(): unknown
  /** One handler for each command of its manifest, by the command's full name. Its arguments are checked before it is called. */
  handlers?: Readonly<Record<string, (args: never) => unknown>>
  /** Called once the host is serving. */
  start?(): void
  /** Called once as the host stops. */
  close?(): void
  /** Tools it gives hobkin's agents, run in the host. With none, and no hooks, no agent loads anything new. */
  tools?: readonly AgentTool<any>[]
  /** Hooks on the tool calls of any agent. */
  toolHooks?: ToolHooks
  /** Before every command the host runs, its own included. Throwing `Unavailable` refuses the command with that reason. */
  beforeCommand?(call: CommandCall): void | Promise<void>
  /** After every command the host ran, with how it ended. What it throws is logged and changes nothing. */
  afterCommand?(call: CommandDone): void
  /** Every tool call of every agent the host sees, when it starts and when it ends. What it throws is logged and changes nothing. */
  onToolCall?(call: ToolCall): void
  /**
   * A pull request that left the open ones: merged through the app (Change Review's verdict), or merged or closed
   * elsewhere, as the host's watch of the pull requests hobkin opened saw it.
   */
  onMerged?(pull: Merged): void
  /** The open pull requests it knows, for Change Review's background (spec 053). Made-up ones say `sample` and are never reviewed. */
  pulls?(): { mine: readonly PullRequest[]; waiting: readonly PullRequest[]; sample: boolean } | null
}

export type HostPartFactory = (context: HostContext) => HostPart | Promise<HostPart>

/** Types a tool's arguments from its schema. */
export const defineTool = <Parameters extends TSchema>(tool: AgentTool<Parameters>): AgentTool<Parameters> => tool
