import type { ActivityEntry } from './activity.ts'
import type { ExecutionTarget } from '../commands/registry.ts'

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
}

export interface RunSummary {
  id?: string
  title: string
  state: string
  kind?: 'main' | 'background' | 'repair'
  scheduleId?: string
  model?: string
  effort?: string
  cwd?: string
  startedAt?: string
  work?: { slug?: string; item?: string; lane?: string }
  stalled?: boolean
}

/**
 * An agent a run spawned through pi-extended-teams, as hobkin reads it from the teams tools' own results and report
 * messages (`children` in its `src/cli/job-activity.mjs`): never a child's transcript, prompt or session file. Its
 * parent is the run it is listed under. An agent's own read agents run inside it and never reach the run, so they
 * are not listed.
 */
export interface RunChild {
  name: string
  role?: string
  modelSlot?: string
  /**
   * `reported`: its report reached the run, which says nothing of whether the work is right. `failed`: it could not
   * start or reported a failure. `stopped`: the run ended before it reported, so how it ended is unknown.
   */
  state: 'queued' | 'running' | 'reported' | 'failed' | 'stopped'
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

/** Runtime's bounded parent-only projection, not daily totals or helper accounting. */
export interface RunTelemetry {
  schemaVersion: 1
  connection: 'connected' | 'offline'
  stale: boolean
  asOf: string | null
  scope: 'own-parent'
  helpers: 'unavailable'
  retention: {
    maxRuns: 100
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
  /** Settled background reports by exact run. Explicit null means no report is available; omission is unknown. */
  completedJobReports?: Record<string, { id: string; title: string; body: string; outcome: string; scheduleId?: string; at?: string } | null>
  /** Bounded note receipts by exact run: Pi admitted the marked user message into a turn. No message bodies. */
  steeringReceipts?: Record<string, readonly { noteId: string; at: number }[]>
  /** Each run's spawned agents, by run id, only for runs that spawned any. It travels whole, and the host keeps ended runs. */
  jobChildren?: Record<string, readonly RunChild[]>
  /** The agents hobkin's main chat spawned in this session. A reset starts the list over, and ends what was out as `stopped`. */
  mainChildren?: readonly RunChild[]
  /** The main chat's latest words and tool calls, as a job's are kept (`mainActivity` in hobkin's runtime). A reset starts it over. */
  mainActivity?: readonly ActivityEntry[]
  context?: { compacting?: boolean; percent?: number | null }
  decisions?: unknown[]
  waiting?: Record<string, unknown> | null
  userName?: string | null
  /** The rest of hobkin's snapshot: reports, schedules, work, usage and more. */
  [key: string]: unknown
}
