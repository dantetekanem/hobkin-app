import { create } from 'zustand'
import { advance, answer, defer, emptyQueue, freshWait, raise, type Answer, type Question, type QuestionQueue } from './queue.ts'

interface QuestionsState {
  queue: QuestionQueue
  raise: (question: Question) => void
  answer: (id: string, given: Answer) => void
  defer: (id: string) => void
  /** Lets time pass for the question on screen. It does not run while the user is choosing or typing. */
  tick: (ms: number, engaged: boolean) => void
  /** The question on screen gets its whole wait again. */
  freshWait: () => void
  raiseSample: () => void
}

let sampleCount = 0

/** A question such as a work agent might send through hobkin, for trying the sheet before the host is connected. */
function sampleQuestion(): Question {
  sampleCount += 1
  return {
    id: `sample-${sampleCount}`,
    from: 'Fix the login redirect loop',
    question: 'The redirect fix changes how expired sessions are handled. Which way should it go?',
    tldr: 'Today an expired session sends the user to the home page. The fix can keep that, or send them back to where they were after signing in.',
    choices: [
      { value: 'return', label: 'Send them back to the page they were on' },
      { value: 'home', label: 'Keep sending them to the home page' },
      { value: 'ask', label: 'Leave it as it is and open an item to decide later' },
    ],
    recommended: 'return',
    why: 'It is what the test for the redirect loop expects, and no other page depends on the old behavior.',
  }
}

/** The questions waiting on the user. Sample questions until the host supplies hobkin's (022-questions, S4). */
export const useQuestions = create<QuestionsState>()((set, get) => ({
  queue: emptyQueue,
  raise: (question) => set({ queue: raise(get().queue, question) }),
  answer: (id, given) => set({ queue: answer(get().queue, id, given) }),
  defer: (id) => set({ queue: defer(get().queue, id) }),
  tick: (ms, engaged) => {
    const next = advance(get().queue, ms, engaged)
    if (next !== get().queue) set({ queue: next })
  },
  freshWait: () => {
    const next = freshWait(get().queue)
    if (next !== get().queue) set({ queue: next })
  },
  raiseSample: () => set({ queue: raise(get().queue, sampleQuestion()) }),
}))
