import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { keepPart } from '../../app/kept-place.ts'
import type { NumbersChart, NumbersPeriod } from '../numbers/board-model.ts'
import type { DecidedAsk } from './numbers-open.ts'

/** The Work screen's pages: the work itself, every AI review, and the numbers (053). */
export type WorkTab = 'work' | 'reviews' | 'numbers'

/** The list of changes a chart opened, and the change last opened from it, so the way back lands on its row. */
export interface Listing {
  ask: DecidedAsk
  item: string | null
}

export interface WorkTabState {
  tab: WorkTab
  /** The chart the Numbers tab brings into view as it opens, as a tile asks; null when the tab was chosen by itself. */
  at: NumbersChart | null
  /** The Numbers tab's period, kept while the app is open. */
  period: NumbersPeriod
  /** The changes behind a chart, open over the Numbers tab. */
  listing: Listing | null
  /** The list that was open as the user last left Work along the trail, given back with the tab on the way back. */
  keptListing: Listing | null
  choose: (tab: WorkTab) => void
  /** Opens the Numbers tab at one chart. */
  openNumbers: (at: NumbersChart) => void
  setPeriod: (period: NumbersPeriod) => void
  openList: (ask: DecidedAsk) => void
  /** Marks the change opened from the list. */
  listed: (item: string) => void
  closeList: () => void
}

/** What the page holds; the actions are given below. */
type Held = Pick<WorkTabState, 'tab' | 'at' | 'period' | 'listing' | 'keptListing'>
const HELD: Held = { tab: 'work', at: null, period: 30, listing: null, keptListing: null }

/**
 * The page Work shows. It stays while the window is open, so closing a review opened from AI Reviews comes back to it.
 * It lives on globalThis, as the numbers' store does, so a hot update of this file keeps the page and the period.
 */
const holder = globalThis as { __hobkinWorkTab?: UseBoundStore<StoreApi<WorkTabState>> }
export const useWorkTab = (holder.__hobkinWorkTab ??= create<WorkTabState>()(() => ({ ...HELD }) as WorkTabState))

const set = (part: Partial<Held>) => useWorkTab.setState(part)
// The actions are this copy of the file's, given to the kept store each time it loads, so a hot update brings its own.
// A part a store kept from an older copy did not hold starts as it would.
useWorkTab.setState({
  ...Object.fromEntries(Object.entries(HELD).filter(([name]) => !(name in useWorkTab.getState()))),
  choose: (tab) => set({ tab, at: null, listing: null }),
  openNumbers: (at) => set({ tab: 'numbers', at, listing: null }),
  setPeriod: (period) => set({ period }),
  openList: (ask) => set({ listing: { ask, item: null } }),
  listed: (item) => {
    const { listing } = useWorkTab.getState()
    if (listing) set({ listing: { ...listing, item } })
  },
  closeList: () => set({ listing: null }),
})

// Work's tab is part of its place on the trail (053): kept as the user leaves Work, and chosen again before Work draws
// when a way back returns to it. On Numbers, the list a chart opened is kept with it, so coming back from a project
// opened from the list lands on the list again, at that project's row.
keepPart('work', 'tab', {
  read: () => {
    const { tab, listing } = useWorkTab.getState()
    set({ keptListing: tab === 'numbers' ? listing : null })
    return { tab }
  },
  give: ({ tab }) => {
    if (!tab) return
    set({ tab: tab as WorkTab, at: null, listing: tab === 'numbers' ? useWorkTab.getState().keptListing : null })
  },
})
