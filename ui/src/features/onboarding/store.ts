import { create } from 'zustand'
import type { PiSetup } from '#shared/protocol/setup.ts'
import { markSetupSeen, setupWantedNow } from './first-run.ts'
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
  setPi: (pi: PiSetup) => void
  setClaude: (claude: boolean) => void
  /** Marks the setup seen and takes it away. The setup calls this once it has handed over to the app. */
  close: () => void
}

const NOTHING_ANSWERED: Answers = { replies: {} }

/** The first-run setup: whether it is open, where its story is and what was answered. See _specs/025-onboarding. */
export const useSetup = create<SetupState>()((set, get) => ({
  open: setupWantedNow(),
  origin: 'first-run',
  tale: startTale(),
  answers: NOTHING_ANSWERED,
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
  setPi: (pi) => set({ pi }),
  setClaude: (claude) => {
    if (claude !== get().claude) set({ claude })
  },
  close: () => {
    markSetupSeen()
    set({ open: false })
  },
}))
