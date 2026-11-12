import { create } from 'zustand'

/** The Work screen's pages: the work itself, and every AI review. */
export type WorkTab = 'work' | 'reviews'

/** The page Work shows. It stays while the window is open, so closing a review opened from AI Reviews comes back to it. */
export const useWorkTab = create<{ tab: WorkTab; choose: (tab: WorkTab) => void }>()((set) => ({
  tab: 'work',
  choose: (tab) => set({ tab }),
}))
