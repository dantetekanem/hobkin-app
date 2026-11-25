import { create } from 'zustand'

/** A list that hangs under an agent's header: its tasks, its teams agents, or its helpers. */
export type DropName = 'tasks' | 'agents' | 'helpers'

/**
 * Which list hangs open under the header. One at a time, so neither covers the other. Kept while the window is open,
 * the same for every agent, as Control+O keeps its blocks.
 */
export const useDrop = create<{ open: DropName | null; setOpen: (name: DropName, open: boolean) => void }>((set) => ({
  open: null,
  setOpen: (name, open) => set((state) => ({ open: open ? name : state.open === name ? null : state.open })),
}))
