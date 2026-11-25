import type { ActivityEntry } from './activity.ts'
import type { ExecutionTarget } from '../commands/registry.ts'
import type { HobkinSummary } from './hobkins.ts'
import type { MemoryNote } from './memory.ts'
import type { RunPulse } from './pulse.ts'
import type { AgentSchedule } from './schedules.ts'
import type { TeamsAgents } from './teams.ts'

/**
 * hobkin's snapshot as it travels to the UI. hobkin builds it in `src/cli/application.mjs` (`project`).
 * Only the parts the client reads are typed. Everything else passes through as it is.
 */

export type NoticeTone = 'critical' | 'blocked' | 'useful' | 'quiet'

export type MessageRole = 'user' | 'assistant' | 'notice' | 'system' | 'custom' | 'bashExecution'

export interface ShellFields {
  command: string
  output: string
  exitCode: number | null
  cancelled: boolean
  /** Pi cut the captured output, independently of our displayed preview. */
  truncated: boolean
  commandPreviewCut: boolean
  outputPreviewCut: boolean
  excludeFromContext: boolean
}

/** Only native settled shell records qualify; local log paths never cross this boundary. */
export function shellFields(value: unknown): ShellFields | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (row.role !== 'bashExecution' || typeof row.command !== 'string' || !row.command.trim()) return null
  const output = typeof row.output === 'string' ? row.output : ''
  return {
    command: row.command.slice(0, 8192), output: output.slice(0, 8192),
    exitCode: typeof row.exitCode === 'number' && Number.isFinite(row.exitCode) ? row.exitCode : null,
    cancelled: row.cancelled === true, truncated: row.truncated === true,
    commandPreviewCut: row.commandPreviewCut === true || row.command.length > 8192,
    outputPreviewCut: row.outputPreviewCut === true || output.length > 8192,
    excludeFromContext: row.excludeFromContext === true,
  }
}

export interface ChatMessage extends Partial<ShellFields> {
  /** A hash of the stored message, or `notice:...` for a line hobkin posts by itself. A changed message has a new id. */
  id: string
  role: MessageRole
  content: string
  /** When it was said: an ISO date or milliseconds since the epoch. */
  at?: string | number
  /** Title of the report the message is about. */
  about?: string
  /** How many images the message carries. */
  images?: number
  tone?: NoticeTone
  /** On a line hobkin posts when an agent changes a memory (`057-shared-memory`): which, so the line offers Undo and See. */
  memory?: MemoryNote
}

export interface RunSummary {
  id?: string
  title: string
  state: string
  kind?: 'main' | 'background' | 'repair'
  scheduleId?: string
  model?: string
  effort?: string
  /**
   * The tier its model came from when it started, one of `fast`, `mid`, `high` and `max`: a session's own, or a work
   * run's from its project's level. hobkin keeps it when the run's model changes. None for a run on no tier, as a
   * routine, and from a hobkin before its commit 1c74964.
   */
  tier?: string
  cwd?: string
  startedAt?: string
  work?: { slug?: string; item?: string; lane?: string }
  /** The host sent this run to Claude Code (033-claude-code-agents), so the window draws a crab pal beside its face. A host from before sends none. */
  onClaudeCode?: true
  stalled?: boolean
  /**
   * A run whose state is `waiting` (spec 053) ended its turn to carry on at a time, with no process: when, as an ISO
   * time, the agent's own note of what it will do then, and how many times it has waited. A host from before sends none.
   */
  waitUntil?: string
  waitNote?: string
  waits?: number
  /**
   * A job that lives until its agent says done (spec 072) sits idle between its turns: its process waits for a message.
   * Only while its state is `running`, with when its last turn ended, as an ISO time. A host from before sends none.
   */
  idle?: true
  idleSince?: string
}

/** Bounded public owned descendants, or legacy teams rows without ancestry. Never a private transcript. */
export interface RunChild {
  /** Exact runtime ancestry; absent on legacy teams rows. */
  id?: string
  parentId?: string
  rootId?: string
  depth?: number
  activity?: readonly ActivityEntry[]
  name: string
  role?: string
  modelSlot?: string
  /** The model (`provider/id`) and thinking level it runs on, when hobkin sends them. */
  model?: string
  thinking?: string
  /**
   * `reported`: its report reached the run, which says nothing of whether the work is right. `failed`: it could not
   * start or reported a failure. `stopped`: the run ended before it reported, so how it ended is unknown.
   */
  state: 'queued' | 'running' | 'cancelling' | 'unknown' | 'completed' | 'failed' | 'cancelled' | 'reported' | 'stopped'
  queuePosition?: number
  /** The completion group of the swarm it came in. A group reports once for all its agents. */
  group?: string
  /** Its phase and tool as teams last gave them, when the run asked (`get_agent_status`). */
  phase?: string
  activeTool?: string
  /** Milliseconds since the epoch, when hobkin saw it spawn and report. */
  startedAt?: number
  endedAt?: number
}

/** A reaction of the face. `until` is milliseconds since the epoch. Sleep is `lasting` and holds until the user wakes it. */
export interface MoodReaction {
  mood: string
  cause?: string
  lasting?: boolean
  yields?: boolean
  until: number
}

/** Null is unknown, not measured zero. Partial values cover only the observed responses. */
export type PerformanceScalar =
  | { value: number; state: 'complete' | 'partial' }
  | { value: null; state: 'unavailable' }

export interface ParentPerformance {
  schemaVersion: 1
  runId: string
  sessionId: string
  responses: number | null
  incomplete: boolean
  /** Observer-side delay to first output, not provider-wire TTFT. */
  firstObservedOutputMs: number | null
  dispatchElapsedMs: number | null
  input: PerformanceScalar
  output: PerformanceScalar
  cacheRead: PerformanceScalar
  cacheWrite: PerformanceScalar
  /** Estimate from observed usage, not an invoice. */
  estimatedUsd: PerformanceScalar
  responseDurationMs: PerformanceScalar
}

export interface HelperTelemetry {
  id: string
  parentId: string
  rootId: string
  depth: number
  sessionId: string | null
  status: 'queued' | 'running' | 'cancelling' | 'unknown' | 'completed' | 'failed' | 'cancelled'
  source: 'live' | 'event' | 'saved' | 'unavailable'
  performance: ParentPerformance | null
}

/** Runtime's bounded parent-own and optional owned-helper projection, not daily totals or subtree accounting. */
export interface RunTelemetry {
  schemaVersion: 1
  connection: 'connected' | 'offline'
  stale: boolean
  asOf: string | null
  scope: 'own-parent' | 'own-parent-and-helpers'
  helpers: 'unavailable' | 'owned'
  retention: {
    maxRuns: 100
    maxHelpersPerRun?: 32
    maxEventKeys?: 100
    eventMonthFiles: 2
    eventTailBytesPerFile: 262144
    eventReadState: 'available' | 'unavailable'
    eventTailTruncated: boolean
    history: 'bounded'
  }
  runs: {
    runId: string
    sessionId: string | null
    kind: 'main' | 'background' | 'unknown'
    status: 'running' | 'completed' | 'failed' | 'interrupted' | 'no_change' | 'incomplete' | 'unknown'
    startedAt: string | null
    finishedAt: string | null
    source: 'receipt' | 'saved' | 'event' | 'unavailable'
    performance: ParentPerformance | null
    helpers?: HelperTelemetry[]
  }[]
}

export interface StopControlTarget extends Omit<ExecutionTarget, 'home' | 'epoch'> {
  parentId: string | null
  rootId: string
  label: string
  canStop: boolean
  canForce: boolean
}

export interface WireSnapshot {
  /** Live captured custody, never restored from a saved snapshot. */
  stopControls?: { home: string; epoch: string; targets: StopControlTarget[] }
  /** Whether hobkin's main conversation is connected: `connected` when live, `offline` for a saved view. */
  connection?: 'connected' | 'offline' | 'connecting'
  savedAt?: string
  /** Missing on older hosts. Link loss retains these last-known facts; it does not make them live. */
  telemetry?: RunTelemetry
  busy?: boolean
  /** One word for what the main agent is doing: thinking, writing, working, researching, delegating, retrying, compacting. */
  doing?: string | null
  searching?: boolean
  tooling?: boolean
  error?: string | null
  mood?: MoodReaction | null
  main?: { harness: string; model: string; effort: string }
  runs?: RunSummary[]
  /** The durable hobkins the user started and has not ended, newest first (`034-durable-hobkins`). Missing on an older hobkin. */
  hobkins?: HobkinSummary[]
  /** Settled background reports by exact run. Explicit null means no report is available; omission is unknown. */
  completedJobReports?: Record<string, { id: string; title: string; body: string; outcome: string; scheduleId?: string; at?: string } | null>
  /** Bounded note receipts by exact run: Pi admitted the marked user message into a turn. No message bodies. */
  steeringReceipts?: Record<string, readonly { noteId: string; at: number }[]>
  /**
   * What the user sent that hobkin's model never read before hobkin closed or crashed, as they typed it, for the input (014-continuity
   * A11). The window puts each id back once. Missing when there is none, and on an older hobkin.
   */
  unread?: readonly { id: string; text: string }[]
  /** Each working run's pulse by its run id, and the main turn's under `#main` (054-working-line). Missing while nothing works, and on an older hobkin. */
  pulses?: Readonly<Record<string, RunPulse>>
  /**
   * The schedules agents keep for themselves (`056-agent-schedules`), live ones and the ones that ended lately, every
   * owner's together. Not the routines, which are `schedules`. A host from before sends none.
   */
  agentSchedules?: readonly AgentSchedule[]
  /**
   * Changes whenever a memory or the "right now" list does (`057-shared-memory`), so an open Memory page reads the list
   * again. A host from before sends none, and the page then reads only when it opens.
   */
  memoriesStamp?: string
  /** Each run's spawned agents, by run id, only for runs that spawned any. It travels whole, and the host keeps ended runs. */
  jobChildren?: Record<string, readonly RunChild[]>
  /** Main chat's bounded descendants. Owned lifecycle states are independent of legacy teams reports. */
  mainChildren?: readonly RunChild[]
  /** The agents each run's own Pi started with pi-extended-teams, by run id. Display only, never helpers (`046-teams-layer`). */
  teamsAgents?: TeamsAgents
  /** The main chat's latest words and tool calls, as a job's are kept (`mainActivity` in hobkin's runtime). A reset starts it over. */
  mainActivity?: readonly ActivityEntry[]
  context?: { compacting?: boolean; percent?: number | null }
  decisions?: unknown[]
  waiting?: Record<string, unknown> | null
  userName?: string | null
  /** The rest of hobkin's snapshot: reports, schedules, work, usage and more. */
  [key: string]: unknown
}
