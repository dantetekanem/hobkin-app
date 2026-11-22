import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { keepPart } from '../../app/kept-place.ts'
import type { NumbersChart, NumbersPeriod } from '../numbers/board-model.ts'

/** The Work screen's pages: the work itself, every AI review, and the numbers (053). */
export type WorkTab = 'work' | 'reviews' | 'numbers'

export interface WorkTabState {
  tab: WorkTab
  /** The chart the Numbers tab brings into view as it opens, as a tile asks; null when the tab was chosen by itself. */
  at: NumbersChart | null
  /** The Numbers tab's period, kept while the app is open. */
  period: NumbersPeriod
  choose: (tab: WorkTab) => void
  /** Opens the Numbers tab at one chart. */
  openNumbers: (at: NumbersChart) => void
  setPeriod: (period: NumbersPeriod) => void
}

const makeTab = () =>
  create<WorkTabState>()((set) => ({
    tab: 'work',
    at: null,
    period: 30,
    choose: (tab) => set({ tab, at: null }),
    openNumbers: (at) => set({ tab: 'numbers', at }),
    setPeriod: (period) => set({ period }),
  }))

/**
 * The page Work shows. It stays while the window is open, so closing a review opened from AI Reviews comes back to it.
 * It lives on globalThis, as the numbers' store does, so a hot update of this file keeps the page and the period.
 */
const holder = globalThis as { __hobkinWorkTab?: UseBoundStore<StoreApi<WorkTabState>> }
export const useWorkTab = (holder.__hobkinWorkTab ??= makeTab())

// Work's tab is part of its place on the trail (053): kept as the user leaves Work, and chosen again before Work draws
// when a way back returns to it.
keepPart('work', 'tab', {
  read: () => ({ tab: useWorkTab.getState().tab }),
  give: ({ tab }) => {
    if (tab) useWorkTab.getState().choose(tab as WorkTab)
  },
})
