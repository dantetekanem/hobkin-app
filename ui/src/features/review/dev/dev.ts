import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * How nodes out of focus are pushed back. `blur` blurs and fades each of them, as the design asks.
 * `fade` only fades them, for a webview where blur on many nodes misses the frame budget (006 A8).
 */
export type FocusTreatment = 'blur' | 'fade'

interface DevState {
  /** Acts as if the system asked for reduced motion, which the browser tools cannot switch. */
  reducedMotion: boolean
  /** Shows frame times over the graph. */
  frameMeter: boolean
  treatment: FocusTreatment
  set(change: Partial<Pick<DevState, 'reducedMotion' | 'frameMeter' | 'treatment'>>): void
}

/** Switches for checking the review screen by hand. They are drawn in development builds only. */
export const useDev = create<DevState>()(
  persist(
    (set) => ({
      reducedMotion: false,
      frameMeter: false,
      treatment: 'blur',
      set: (change) => set(change),
    }),
    { name: 'hobkin-client-review-dev', version: 1 },
  ),
)

export interface Timing {
  label: string
  ms: number
}

interface TimingState {
  timings: Timing[]
  record(label: string, ms: number): void
}

/** The last measured times of things with a budget: the panel opening, a long file's first lines. */
export const useTimings = create<TimingState>()((set) => ({
  timings: [],
  record: (label, ms) => set((state) => ({ timings: [{ label, ms: Math.round(ms) }, ...state.timings.filter((timing) => timing.label !== label)].slice(0, 6) })),
}))
