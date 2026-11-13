/**
 * The questions hobkin is waiting on, and the rules for answering them or putting them off.
 * Pure, so the rules can be tested without a window. See _specs/022-questions.
 */

/** How long a question stays on screen with the user idle before it moves to Action Items. hobkin's own wait. */
export const WAIT_MS = 30_000

export interface Choice {
  value: string
  label: string
}

export interface Question {
  id: string
  /** Who asks: hobkin, or the routine or agent it asks for. */
  from: string
  question: string
  /** One line of summary, when hobkin gave one. */
  tldr?: string
  choices: Choice[]
  /** The value of the choice hobkin recommends, and why. */
  recommended?: string
  why?: string
}

export type Answer = { value: string } | { typed: string }

export interface QuestionQueue {
  /** Shown one at a time, oldest first. */
  waiting: Question[]
  /** Put off or timed out. These wait under Action Items. */
  deferred: Question[]
  answered: { id: string; answer: Answer }[]
  /** How long the question on screen has waited with the user idle. */
  idleMs: number
}

export const emptyQueue: QuestionQueue = { waiting: [], deferred: [], answered: [], idleMs: 0 }

export function current(queue: QuestionQueue): Question | null {
  return queue.waiting[0] ?? null
}

export function raise(queue: QuestionQueue, question: Question): QuestionQueue {
  if (queue.waiting.some((item) => item.id === question.id)) return queue
  return { ...queue, waiting: [...queue.waiting, question] }
}

function leave(queue: QuestionQueue, id: string): QuestionQueue {
  const first = current(queue)?.id === id
  // A new question on screen gets its own full wait.
  return { ...queue, waiting: queue.waiting.filter((item) => item.id !== id), idleMs: first ? 0 : queue.idleMs }
}

/** Answers a waiting question. An unknown choice or an empty typed answer changes nothing. */
export function answer(queue: QuestionQueue, id: string, given: Answer): QuestionQueue {
  const question = queue.waiting.find((item) => item.id === id)
  if (!question) return queue

  if ('typed' in given) {
    const typed = given.typed.trim()
    if (!typed) return queue
    return { ...leave(queue, id), answered: [...queue.answered, { id, answer: { typed } }] }
  }
  if (!question.choices.some((choice) => choice.value === given.value)) return queue
  return { ...leave(queue, id), answered: [...queue.answered, { id, answer: given }] }
}

/** Puts a waiting question off. It then waits under Action Items with the same choices. */
export function defer(queue: QuestionQueue, id: string): QuestionQueue {
  const question = queue.waiting.find((item) => item.id === id)
  if (!question) return queue
  return { ...leave(queue, id), deferred: [...queue.deferred, question] }
}

export function timeLeft(queue: QuestionQueue): number {
  return Math.max(0, WAIT_MS - queue.idleMs)
}

/**
 * The question the sheet shows. While something covers the window (`covered`), such as the first-run setup or its
 * tour, the sheet under it could not be reached, so it shows nothing and its wait does not run. What waits stays.
 */
export function onSheet(queue: QuestionQueue, covered: boolean): Question | null {
  return covered ? null : current(queue)
}

/** The question on screen gets its whole wait again, as when the sheet comes back from behind the setup or the tour. */
export function freshWait(queue: QuestionQueue): QuestionQueue {
  return queue.idleMs === 0 ? queue : { ...queue, idleMs: 0 }
}

/** Lets time pass. While the user is choosing or typing (`engaged`) the wait does not run. */
export function advance(queue: QuestionQueue, ms: number, engaged: boolean): QuestionQueue {
  const question = current(queue)
  if (!question || engaged) return queue
  const idleMs = queue.idleMs + ms
  return idleMs >= WAIT_MS ? defer(queue, question.id) : { ...queue, idleMs }
}
