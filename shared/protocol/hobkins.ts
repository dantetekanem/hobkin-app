import type { ClaudeModel } from './claude-code.ts'
import type { Effort, TierId } from '../tiers/tiers.ts'

/**
 * Durable hobkins: the hobkins the user starts with Command+N and drives themselves. Each keeps one conversation,
 * stays listed while it waits, and is there again after a restart. hobkin's runtime owns them and sends these shapes
 * as they are. See _specs/034-durable-hobkins.
 */

/** What a durable hobkin runs on, chosen once when it starts. */
export type HobkinEngine =
  /** One of hobkin's tiers: the model and thinking that tier has when each turn starts. */
  | { kind: 'tier'; tier: TierId }
  /**
   * The installed Claude Code, with nothing asked. `model` is one of its aliases, and `default` or none is the account's
   * own. `effort` is one of its levels, and `default` or none passes no level, so Claude Code uses its own.
   */
  | { kind: 'claude'; model?: ClaudeModel; effort?: HobkinClaudeEffort }
  /** Any model Pi can reach, as `provider/id`, with one of its thinking levels. */
  | { kind: 'pi'; model: string; effort: Effort }

export const HOBKIN_ENGINE_KINDS = ['tier', 'claude', 'pi'] as const

/** The thinking a durable hobkin on Claude Code runs at: Claude Code's own, or one of its `--effort` levels. */
export const HOBKIN_CLAUDE_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type HobkinClaudeEffort = (typeof HOBKIN_CLAUDE_EFFORTS)[number]

/** How a finished turn ended: hobkin's own words for a run's end. */
export type HobkinTurnEnd = 'completed' | 'failed' | 'interrupted'

export interface HobkinSummary {
  /** Eight hex characters. */
  id: string
  title: string
  /** The folder it works in. */
  cwd: string
  engine: HobkinEngine
  /** `working` while a turn runs, `waiting` between turns. An ended hobkin is not listed. */
  state: 'working' | 'waiting'
  /** How many turns it has had, the one in flight included. None yet for one started without a first message. */
  turns: number
  /** The run of the turn in flight, or null while it waits. Its activity is `jobActivity[run]`. */
  run: string | null
  /** How the last finished turn ended and the start of what it said. Null before the first turn ends. */
  last: { status: HobkinTurnEnd; said: string; at: string } | null
  /** Since when it waits, and whether the user has looked. Null while it works. */
  waiting: { since: string; seen: boolean } | null
  createdAt: string
}

/**
 * Who asked for a turn: the user, the main hobkin, or another durable hobkin by its id, with its name when it sent
 * (`hobkin tell`). Words from either hobkin are an agent's, acting for the user, and the page must not show them as the user's.
 */
export type HobkinSender = { kind: 'user' } | { kind: 'main' } | { kind: 'hobkin'; id: string; title: string }

/** One turn: what was asked, by whom, and what the hobkin answered. */
export interface HobkinTurn {
  /** 1 for the first turn. */
  n: number
  run: string
  asked: string
  /** Who asked. The runtime always says; one from before messages between hobkins leaves it out, which means the user. */
  from?: HobkinSender
  askedAt: string
  status: 'running' | HobkinTurnEnd
  /** Its answer, or null while it runs or when it ended without one. */
  reply: string | null
  /** Why it failed or was cut off, when it was. */
  error: string | null
  endedAt: string | null
}

export interface HobkinConversation {
  hobkin: HobkinSummary
  /** Oldest first. */
  turns: HobkinTurn[]
}

export const HOBKIN_ID = /^[0-9a-f]{8}$/
/** The most durable hobkins kept at once, as hobkin's `MOST_HOBKINS` in `src/cli/hobkins.mjs` has it. */
export const MOST_HOBKINS = 48
/** The longest message a durable hobkin takes, in characters. */
export const HOBKIN_MESSAGE_MAX = 32768
export const HOBKIN_TITLE_MAX = 120
/** The longest message one hobkin sends another (`hobkin.tell`), in characters: a note, not a document. */
export const HOBKIN_TELL_MAX = 4096

/** A durable hobkin the main hobkin can message (`hobkin.list`). */
export interface HobkinReach {
  id: string
  title: string
  state: 'working' | 'waiting'
}

/** A turn's run has this before the hobkin's id in its schedule id, so the window never lists it as an agent of its own. */
export const HOBKIN_SCHEDULE = 'hobkin.'
/** In the window a durable hobkin is an agent with this before its id, so the agent screen and the list address it. */
export const HOBKIN_AGENT = 'hobkin:'

export const hobkinAgentId = (id: string): string => `${HOBKIN_AGENT}${id}`

/** The durable hobkin an agent id names, or null for any other agent. */
export function hobkinOfAgent(agentId: string | null | undefined): string | null {
  if (!agentId?.startsWith(HOBKIN_AGENT)) return null
  const id = agentId.slice(HOBKIN_AGENT.length)
  return HOBKIN_ID.test(id) ? id : null
}

const TURN_SCHEDULE = /^hobkin\.[0-9a-f]{8}$/

/** True for the run of a durable hobkin's turn, and for nothing else: a routine the user named `hobkin.nightly` is still a routine. */
export const isHobkinTurn = (run: { scheduleId?: string }): boolean => TURN_SCHEDULE.test(run.scheduleId ?? '')
