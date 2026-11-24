import type { PullRequest } from '#shared/protocol/pulls.ts'
import type { CommandOutcome } from './commands.ts'
import type { GhCall } from './review/gh.ts'
import type { WorkApp } from './work.ts'

/**
 * What an integration's host part is given and what it gives back (_specs/064-integration-drops). The folder's
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
  /** Before every command the host runs, its own included. Throwing `Unavailable` refuses the command with that reason. */
  beforeCommand?(call: CommandCall): void | Promise<void>
  /** After every command the host ran, with how it ended. What it throws is logged and changes nothing. */
  afterCommand?(call: CommandDone): void
  /** Every tool call of every agent the host sees, when it starts and when it ends. What it throws is logged and changes nothing. */
  onToolCall?(call: ToolCall): void
  /** A pull request merged through the app, such as from Change Review's verdict. */
  onMerged?(pull: Merged): void
  /** The open pull requests it knows, for Change Review's background (spec 053). Made-up ones say `sample` and are never reviewed. */
  pulls?(): { mine: readonly PullRequest[]; waiting: readonly PullRequest[]; sample: boolean } | null
}

export type HostPartFactory = (context: HostContext) => HostPart | Promise<HostPart>
