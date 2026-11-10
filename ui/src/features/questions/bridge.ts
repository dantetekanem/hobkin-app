import type { PendingQuestion, QuestionReply } from '../../../../shared/protocol/question.ts'
import { headingOf } from '../actions/items.ts'
import type { Answer, Question, QuestionQueue } from './queue.ts'

/**
 * hobkin's own questions on the sheet (022-questions S4, 012 A6): the rules, with the host and the sheet handed in,
 * so they can be tested without a window. `host-bridge.ts` connects them to the real ones.
 *
 * A question hobkin asks reaches the host, which hands it to this window. It rises on the same sheet as any other,
 * with who asks, hobkin's pick and its reason. What the user does there goes back to hobkin: an answer by a choice
 * or in their own words, or "later", which hobkin keeps under Action Items. Left alone, the sheet's wait runs out and
 * puts it off the same way. A question hobkin takes back by itself leaves the sheet, and nothing goes back for it.
 */

interface Watched<State> {
  getState(): State
  subscribe(listener: (state: State, previous: State) => void): () => void
}

/** What the bridge needs of the sheet's store. */
interface Sheet {
  queue: QuestionQueue
  raise(question: Question): void
  defer(id: string): void
}

export interface QuestionLinks {
  host: Watched<{ question: PendingQuestion | null }>
  sheet: Watched<Sheet>
  answer(id: string, reply: QuestionReply): Promise<void>
  defer(id: string): Promise<void>
}

/** A question as the sheet asks it, headed the way Action Items heads it (`headingOf`). */
export function fromHost({ id, from, question, tldr, choices, recommended, why }: PendingQuestion): Question {
  const { question: heading, summary } = headingOf(question, tldr)
  return {
    id,
    from,
    question: heading,
    choices,
    ...(summary ? { tldr: summary } : {}),
    ...(recommended ? { recommended } : {}),
    ...(why ? { why } : {}),
  }
}

/** Connects them. Returns how to disconnect. */
export function connectQuestions({ host, sheet, answer, defer }: QuestionLinks): () => void {
  // The questions raised for hobkin, and those already given back an answer or a "later".
  const raised = new Set<string>()
  const settled = new Set<string>()

  const follow = (question: PendingQuestion | null, before: PendingQuestion | null) => {
    if (question && !raised.has(question.id)) {
      raised.add(question.id)
      sheet.getState().raise(fromHost(question))
    }
    if (before && before.id !== question?.id && raised.has(before.id) && !settled.has(before.id)) {
      settled.add(before.id)
      sheet.getState().defer(before.id)
    }
  }

  const giveBack = (id: string, given: Answer) => {
    settled.add(id)
    // A refusal, such as own words for a question that takes only its choices, puts it off instead.
    void answer(id, given).catch(() => defer(id).catch(() => {}))
  }

  const stopHost = host.subscribe((state, previous) => {
    if (state.question !== previous.question) follow(state.question, previous.question)
  })
  const stopSheet = sheet.subscribe(({ queue }) => {
    for (const { id, answer: given } of queue.answered) if (raised.has(id) && !settled.has(id)) giveBack(id, given)
    for (const { id } of queue.deferred) {
      if (!raised.has(id) || settled.has(id)) continue
      settled.add(id)
      void defer(id).catch(() => {})
    }
  })
  // A question already up when this window connected.
  follow(host.getState().question, null)

  return () => {
    stopHost()
    stopSheet()
  }
}
