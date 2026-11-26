/** How sure the asker is of its pick, in hobkin's words for it. */
export type Sure = 'high' | 'medium' | 'low'

/**
 * What a card from `hobkin decide` says of itself besides its question and choices (075 S7). Each is left out when the
 * card does not say it: a card filed before hobkin kept these, a question hobkin's main agent asks, and any other asker.
 */
export interface CardFacts {
  /** How sure the asker is of its pick. Said only of a card with a pick. */
  sure?: Sure
  /** Whether what the card decides can be undone. */
  reversible?: boolean
  /** When hobkin takes the pick by itself if nobody answers first, as an ISO time. */
  defaultsAt?: string
  /** A learn card: its last choice, valued `always`, takes the pick and keeps it as a standing rule. */
  learn?: true
}

/** The value of the choice hobkin adds last to a learn card, labelled "Always: <rule>". */
export const ALWAYS_CHOICE = 'always'

/** A card as hobkin files it (`src/cli/decisions.mjs`), with only what `cardFacts` reads. hobkin writes null for a field not given. */
export interface FiledCard {
  choices: readonly { value: string; label: string }[]
  recommended?: string | null
  answerTo?: { kind: string } | null
  sure?: unknown
  reversible?: unknown
  deadline?: unknown
  learn?: unknown
  /** hobkin's own word on when the card takes its pick, or null when it waits for the user, should hobkin send one. */
  defaultsAt?: unknown
}

const SURE: readonly string[] = ['high', 'medium', 'low'] satisfies Sure[]
// Only these askers' cards take their pick by themselves (`DEFAULT_ASKERS` in hobkin's decisions.mjs). Another session's card waits for the user.
const DEFAULT_ASKERS: readonly string[] = ['routine', 'work']

const isTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

/**
 * When the card takes its pick by itself, as hobkin's `isDueAt` decides: a card that can be undone, with a pick among its
 * choices and a deadline, from a routine or a work run. hobkin also keeps cards of the kinds it guards (`outward.mjs`) waiting,
 * which this cannot tell, so hobkin's own `defaultsAt`, when the card carries one, settles it.
 */
function defaultOf(card: FiledCard, picks: boolean): string | null {
  if (!picks) return null
  if (card.defaultsAt !== undefined) return isTime(card.defaultsAt) ? card.defaultsAt : null
  if (card.reversible !== true || !DEFAULT_ASKERS.includes(card.answerTo?.kind ?? '')) return null
  return isTime(card.deadline) ? card.deadline : null
}

/** What a filed card says of itself, read the way hobkin writes it. A value hobkin does not write is left out, never guessed at. */
export function cardFacts(card: FiledCard): CardFacts {
  const picks = card.choices.some(({ value }) => value === card.recommended)
  const defaultsAt = defaultOf(card, picks)
  return {
    ...(picks && typeof card.sure === 'string' && SURE.includes(card.sure) ? { sure: card.sure as Sure } : {}),
    ...(typeof card.reversible === 'boolean' ? { reversible: card.reversible } : {}),
    ...(defaultsAt ? { defaultsAt } : {}),
    ...(card.learn === true && card.choices.some(({ value }) => value === ALWAYS_CHOICE) ? { learn: true as const } : {}),
  }
}

/**
 * A question hobkin is asking right now. It comes from hobkin's `askQuestion`: the main agent's `ask_question`
 * tool, or a question a routine, work mode or another session filed. One is up at a time.
 */
export interface PendingQuestion extends CardFacts {
  /** Names this asking. The answer carries it back. */
  id: string
  /** Who asks: `hobkin`, or the routine, project or session that filed it. */
  from: string
  question: string
  /** A short form of the question, when the asker gave one. */
  tldr?: string
  choices: { value: string; label: string }[]
  /** The user may answer in their own words instead of picking a choice. */
  other: boolean
  /** The value of the choice the asker recommends. */
  recommended?: string
  /** Why the user is the one to decide. */
  why?: string
  /** Milliseconds since the epoch. */
  askedAt: number
  /** When it leaves the screen by itself and waits under Action items, or null when someone is waiting on it. */
  expiresAt: number | null
}

/** A choice's value, or the user's own words. */
export type QuestionReply = { value: string } | { typed: string }
