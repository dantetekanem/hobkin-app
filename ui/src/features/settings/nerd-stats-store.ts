import { create } from 'zustand'

/** Whether the Nerd stats panel is open. It is a store of its own so the key, the spotlight and Settings can all reach it. */
export const useNerdStats = create<{ open: boolean; setOpen: (open: boolean) => void; toggle: () => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}))
