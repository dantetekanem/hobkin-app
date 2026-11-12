import type { HomeInput, HomeModel } from './types.ts'

/** Placeholder until the real rules land: an empty Home, so the screen can be wired against the contract. */
export function homeModel(input: HomeInput): HomeModel {
  const day = new Date(input.now)
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  return {
    header: { title: 'Nothing needs you', line: null, chips: [], mood: 'idle' },
    stack: [],
    needs: { rows: [], more: 0 },
    running: { rows: [], held: null, slots: null },
    upcoming: { rows: [], day: { start, end: start + 86_400_000, now: input.now, marks: [] }, summary: '' },
    problems: { rows: [], more: 0 },
    projects: { rows: [] },
    github: { known: false, reviews: 0, failing: 0, rows: [] },
    week: { days: [], completed: 0, unfinished: 0, wins: null },
  }
}
