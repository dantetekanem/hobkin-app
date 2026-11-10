import { create } from 'zustand'
import type { TiersConfig } from '#shared/tiers/tiers.ts'
import { markSetupSeen, setupWantedNow } from './first-run.ts'
import { startFlow, stepFlow, type Flow, type FlowEvent } from './flow.ts'

/** The tiers proposed for a provider, with the user's changes. */
export interface SetupDraft {
  /** Pi's id for the provider the proposal came from. */
  provider: string
  config: TiersConfig
}

/** What became of hobkin's own model when the first settings were accepted: saved through hobkin, or refused with the host's reason. */
export type MainOutcome =
  | { state: 'saving' }
  | { state: 'saved'; name: string }
  | { state: 'refused'; reason: string }

interface SetupState {
  open: boolean
  /** `again`: opened from Settings over the app, so the character leaves its place by the message input to lead it. */
  origin: 'first-run' | 'again'
  flow: Flow
  /** The connected provider the first settings come from. Null until the user picks one or one connects. */
  provider: string | null
  draft: SetupDraft | null
  main: MainOutcome | null
  /** Goes up each time the setup is opened again, so it starts over from its first step. */
  run: number

  openSetup: () => void
  go: (event: FlowEvent) => void
  chooseProvider: (provider: string) => void
  setDraft: (draft: SetupDraft) => void
  setMain: (main: MainOutcome) => void
  /** Marks the setup seen and takes it away. The setup calls this once it has handed over to the app. */
  close: () => void
}

/** The first-run setup: whether it is open and where it is. See _specs/025-onboarding. */
export const useSetup = create<SetupState>()((set, get) => ({
  open: setupWantedNow(),
  origin: 'first-run',
  flow: startFlow(),
  provider: null,
  draft: null,
  main: null,
  run: 0,

  openSetup: () =>
    set({
      open: true,
      origin: 'again',
      flow: startFlow(),
      provider: null,
      draft: null,
      main: null,
      run: get().run + 1,
    }),
  go: (event) => set({ flow: stepFlow(get().flow, event) }),
  chooseProvider: (provider) => {
    if (provider !== get().provider) set({ provider })
  },
  setDraft: (draft) => set({ draft }),
  setMain: (main) => set({ main }),
  close: () => {
    markSetupSeen()
    set({ open: false })
  },
}))
