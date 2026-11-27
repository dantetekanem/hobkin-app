import { create } from 'zustand'
import type { PiSetup } from '#shared/protocol/setup.ts'
import { markSetupEnded, setupWantedNow, unfinishedNow } from './first-run.ts'
import { startTale, tellOn, type Answers, type Facts, type Tale, type TaleEvent } from './story.ts'

interface SetupState {
  open: boolean
  /** `again`: opened from Settings over the app, so the window's cover fades in and the opening is shorter. */
  origin: 'first-run' | 'again'
  /** Where the story is. */
  tale: Tale
  /** What the user answered so far. */
  answers: Answers
  /** Pi on this Mac, as the host last said. Null until it has, and where there is no host. */
  pi: PiSetup | null
  /** Claude Code is installed and signed in, as the host last said. */
  claude: boolean
  /** Goes up each time the setup is opened again, so it starts over from its first bubble. */
  run: number

  openSetup: () => void
  /** One move of the story, for what is known about this Mac now. */
  tell: (event: TaleEvent, facts: Facts) => void
  /** Keeps an answer, and the story goes on from the question it answered. */
  answer: (change: Partial<Answers>, facts: Facts) => void
  /** Keeps an answer while the question is still being answered, such as a card kept or dropped. The story stays. */
  note: (change: Partial<Answers>) => void
  setPi: (pi: PiSetup) => void
  setClaude: (claude: boolean) => void
  /**
   * Keeps how the setup ended and takes it away. The setup calls this once it has handed over to the app. An
   * unfinished one keeps whose computer it is, and opens again at the account step.
   */
  close: (as?: 'finished' | 'unfinished') => void
}

const NOTHING_ANSWERED: Answers = { replies: {} }

/** A setup that ended with no account starts again where the account is looked for, knowing whose computer it is. */
const earlierEnd = unfinishedNow()
const startingAnswers: Answers = earlierEnd?.computer ? { replies: {}, computer: earlierEnd.computer } : NOTHING_ANSWERED
const startingTale = (): Tale => (earlierEnd ? { ...startTale(), at: 'subscription' } : startTale())

/** The first-run setup: whether it is open, where its story is and what was answered. See _specs/025-onboarding and 044. */
export const useSetup = create<SetupState>()((set, get) => ({
  open: setupWantedNow(),
  origin: 'first-run',
  tale: startingTale(),
  answers: startingAnswers,
  pi: null,
  claude: false,
  run: 0,

  openSetup: () =>
    set({
      open: true,
      origin: 'again',
      tale: startTale(),
      answers: NOTHING_ANSWERED,
      run: get().run + 1,
    }),
  tell: (event, facts) => set({ tale: tellOn(get().tale, event, get().answers, facts) }),
  answer: (change, facts) => {
    const answers = { ...get().answers, ...change }
    set({ answers, tale: tellOn(get().tale, 'answered', answers, facts) })
  },
  note: (change) => set({ answers: { ...get().answers, ...change } }),
  setPi: (pi) => set({ pi }),
  setClaude: (claude) => {
    if (claude !== get().claude) set({ claude })
  },
  close: (as = 'finished') => {
    markSetupEnded(as, get().answers.computer)
    set({ open: false })
  },
}))
