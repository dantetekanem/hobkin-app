import { create } from 'zustand'
import { useView } from '@/app/view-store.ts'
import { startTour, stepTour, type Tour, type TourEvent } from './flow.ts'

/** Whether the tour has been seen, kept in the app's own storage like the first-run setup's mark. */
export const TOUR_KEY = 'hobkin-client-tour'

/** Marks the tour seen, finished or left. */
export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_KEY, 'seen')
  } catch {
    // Storage can be unavailable. Then nothing is kept, which only means the caller may offer the tour again.
  }
}

interface TourState {
  open: boolean
  flow: Tour
  /** Goes up each time the tour starts, so it begins again from its first stop. */
  run: number

  /** Opens Home and starts at the first stop, whatever was stored. The caller decides when to start. */
  start: () => void
  go: (event: TourEvent) => void
  /** Marks the tour seen and takes it away. */
  close: () => void
}

/** The tour of the Home screen: whether it is open and where it is. */
export const useTour = create<TourState>()((set, get) => ({
  open: false,
  flow: startTour(),
  run: 0,

  start: () => {
    useView.getState().openScreen('home')
    set({ open: true, flow: startTour(), run: get().run + 1 })
  },
  go: (event) => {
    const flow = stepTour(get().flow, event)
    if (flow.ended) {
      markTourSeen()
      set({ flow, open: false })
    } else {
      set({ flow })
    }
  },
  close: () => {
    markTourSeen()
    set({ open: false })
  },
}))
