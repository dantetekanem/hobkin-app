import { create } from 'zustand'
import { keepPart } from '../../app/kept-place.ts'

/** The Work screen's pages: the work itself, and every AI review. */
export type WorkTab = 'work' | 'reviews'

/** The page Work shows. It stays while the window is open, so closing a review opened from AI Reviews comes back to it. */
export const useWorkTab = create<{ tab: WorkTab; choose: (tab: WorkTab) => void }>()((set) => ({
  tab: 'work',
  choose: (tab) => set({ tab }),
}))

// Work's tab is part of its place on the trail (053): kept as the user leaves Work, and chosen again before Work draws
// when a way back returns to it.
keepPart('work', 'tab', {
  read: () => ({ tab: useWorkTab.getState().tab }),
  give: ({ tab }) => {
    if (tab) useWorkTab.getState().choose(tab as WorkTab)
  },
})
