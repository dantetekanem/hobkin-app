import { randomUUID } from 'node:crypto'
import type { QuestionAnswer, QuestionRequest } from 'hobkin/src/cli/application.mjs'
import type { Decision } from 'hobkin/src/cli/decisions.mjs'
import { cardFacts, type CardFacts, type PendingQuestion } from '#shared/protocol/question.ts'
import { Unavailable } from './commands.ts'

/** What hobkin knows about a filed question beyond its words. */
export type FiledDetails = Partial<Pick<PendingQuestion, 'from' | 'tldr' | 'recommended' | 'why'>> & CardFacts

/**
 * A filed question as the sheet shows it: who filed it, its summary, its pick and why, and what the card says of itself
 * (075 S7). hobkin asks it with its words and choices only, so the rest comes from its record. What it does not say is left out.
 */
export function filedDetails({ from, tldr, recommended, why, ...card }: Decision): FiledDetails {
  return {
    ...(from ? { from } : {}),
    ...(tldr ? { tldr } : {}),
    ...(recommended ? { recommended } : {}),
    ...(why ? { why } : {}),
    ...cardFacts({ ...card, recommended }),
  }
}

/** A question to ask. One that another agent asks names who asks and gives its summary line, as a filed question does. */
export type AskRequest = QuestionRequest & { from?: string; tldr?: string }

/** Asks on the sheet: a choice's value, the user's own words, null when put off or expired, undefined when it could not be asked. */
export type Ask = (request: AskRequest, signal?: AbortSignal) => Promise<QuestionAnswer>

export interface QuestionsOptions {
  /** The question on screen changed: a new one, or null when it left. */
  onChange: (question: PendingQuestion | null) => void
  /** Whether a UI is connected to show a question at all. */
  canShow: () => boolean
  /** Whether the user is writing a message. A question nobody waits on stays out of their way. */
  typing: () => boolean
  /** What hobkin knows about a filed question beyond its words: who asked, why, what they recommend, and what the card says of itself. */
  describe?: (request: QuestionRequest) => FiledDetails
  /** A cap on how long a question nobody waits on stays up. hobkin's own time applies without it. */
  maxWaitMs?: number
}

interface Open {
  question: PendingQuestion
  whenQuiet: boolean
  finish: (answer: QuestionAnswer) => void
}

const GONE = 'That question is no longer open.'

/**
 * hobkin's `askQuestion`, answered through the UI. The rules are the terminal dashboard's (`askQuestion` in
 * hobkin's `src/cli/ui.mjs`): one question at a time, a question someone waits on takes the place of one nobody
 * waits on, and a question that times out or is put off resolves to null, which hobkin files under Action items,
 * the main agent's own questions included. Undefined means it could not be asked at all, and hobkin tries again later.
 */
export class Questions {
  private open: Open | null = null
  private readonly options: QuestionsOptions

  constructor(options: QuestionsOptions) {
    this.options = options
  }

  /** The question on screen now. */
  current(): PendingQuestion | null {
    return this.open?.question ?? null
  }

  ask: Ask = (request, signal) => {
    // Someone is waiting on this one, and what it replaces can wait under Action items.
    if (this.open?.whenQuiet && !request.whenQuiet) this.open.finish(null)
    if (this.open || !this.options.canShow()) return Promise.resolve(undefined)
    if (signal?.aborted) return Promise.resolve(null)
    if (request.whenQuiet && this.options.typing()) return Promise.resolve(undefined)

    return new Promise((resolve) => {
      const askedAt = Date.now()
      const waitMs = request.waitMs ? Math.min(request.waitMs, this.options.maxWaitMs ?? Infinity) : null
      const open: Open = {
        question: {
          id: request.requestId ?? randomUUID(),
          from: request.from ?? 'hobkin',
          question: request.question,
          ...(request.tldr ? { tldr: request.tldr } : {}),
          choices: request.choices.map(({ value, label }) => ({ value, label })),
          other: request.other === true,
          askedAt,
          expiresAt: waitMs === null ? null : askedAt + waitMs,
          // One that names its sender is an agent's own question, so a decision filed with the same words does not speak for it.
          ...(request.from ? {} : this.options.describe?.(request)),
        },
        whenQuiet: request.whenQuiet === true,
        finish: (answer) => {
          if (this.open !== open) return
          clearTimeout(timer)
          signal?.removeEventListener('abort', leave)
          this.open = null
          resolve(answer)
          this.options.onChange(null)
        },
      }
      const leave = () => open.finish(null)
      const timer = waitMs === null ? undefined : setTimeout(leave, waitMs)
      signal?.addEventListener('abort', leave, { once: true })
      this.open = open
      this.options.onChange(open.question)
    })
  }

  private opened(id: string): Open {
    if (this.open?.question.id !== id) throw new Unavailable(GONE)
    return this.open
  }

  /** The user's answer: one of the choices, or their own words where the question takes them. */
  answer(id: string, reply: Partial<{ value: string; typed: string }>): void {
    const open = this.opened(id)
    const typed = reply.typed?.trim()
    if (Boolean(reply.value) === Boolean(typed)) throw Error('Answer with one of the choices or with your own words, not both.')
    if (typed) {
      if (!open.question.other) throw Error('This question takes one of its choices.')
      open.finish({ typed })
    } else {
      if (!open.question.choices.some(({ value }) => value === reply.value)) throw Error('That is not one of the choices.')
      open.finish(reply.value as string)
    }
  }

  /** "Later": it leaves the screen, and hobkin keeps it under Action items. */
  defer(id: string): void {
    this.opened(id).finish(null)
  }

  /**
   * The host is closing. A quit must not reach the asker as an answer, nor as the user putting it off, which would leave it in
   * Action items while the next start asks it again. It could not be asked, so hobkin asks again later.
   */
  close(): void {
    this.open?.finish(undefined)
  }
}
