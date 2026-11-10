/**
 * A question hobkin is asking right now. It comes from hobkin's `askQuestion`: the main agent's `ask_question`
 * tool, or a question a routine, work mode or another session filed. One is up at a time.
 */
export interface PendingQuestion {
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
