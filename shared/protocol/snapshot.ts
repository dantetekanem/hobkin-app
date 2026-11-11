import type { ActivityEntry } from './activity.ts'

/**
 * hobkin's snapshot as it travels to the UI. hobkin builds it in `src/cli/application.mjs` (`project`).
 * Only the parts the client reads are typed. Everything else passes through as it is.
 */

export type NoticeTone = 'critical' | 'blocked' | 'useful' | 'quiet'

export type MessageRole = 'user' | 'assistant' | 'notice' | 'system' | 'custom'

export interface ChatMessage {
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

export interface WireSnapshot {
  /** Whether hobkin's main conversation is connected: `connected` when live, `offline` for a saved view. */
  connection?: 'connected' | 'offline' | 'connecting'
  savedAt?: string
  busy?: boolean
  /** One word for what the main agent is doing: thinking, writing, working, researching, delegating, retrying, compacting. */
  doing?: string | null
  searching?: boolean
  tooling?: boolean
  error?: string | null
  mood?: MoodReaction | null
  main?: { harness: string; model: string; effort: string }
  runs?: RunSummary[]
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
