/**
 * The tour as a line of stops. Pure rules only: where it is, which way it last moved, and whether it has ended.
 */
import { TOUR_STEPS } from './steps.ts'

export interface Tour {
  /** The index of the stop in `TOUR_STEPS`. */
  at: number
  /** 1 when the last move went on, -1 when it went back. The card travels that way. */
  direction: 1 | -1
  /** How the tour ended, once it has: gone through to the end, or left on the way. */
  ended: 'done' | 'left' | null
}

export type TourEvent = 'next' | 'back' | 'end'

export function startTour(): Tour {
  return { at: 0, direction: 1, ended: null }
}

/** One move. Going on from the last stop ends the tour as done. There is nothing behind the first stop, and nothing moves once it ended. */
export function stepTour(tour: Tour, event: TourEvent): Tour {
  if (tour.ended) return tour
  switch (event) {
    case 'next': {
      const onLastStop = tour.at === TOUR_STEPS.length - 1
      if (onLastStop) return { ...tour, ended: 'done' }
      return { at: tour.at + 1, direction: 1, ended: null }
    }
    case 'back':
      return tour.at === 0 ? tour : { at: tour.at - 1, direction: -1, ended: null }
    case 'end':
      return { ...tour, ended: 'left' }
  }
}
