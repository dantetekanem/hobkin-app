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
  context?: { compacting?: boolean; percent?: number | null }
  decisions?: unknown[]
  waiting?: Record<string, unknown> | null
  userName?: string | null
  /** The rest of hobkin's snapshot: reports, schedules, work, usage and more. */
  [key: string]: unknown
}
