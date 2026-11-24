import { useState } from 'react'
import { create } from 'zustand'
import { OPEN_BY_DEFAULT, type BlockKind } from '../settings/rules.ts'
import { useSettings } from '../settings/store.ts'

/**
 * Whether the tool blocks of an agent's steps are open: a file read's text, a command's output, a diff, a tool's output.
 * Each kind arrives open or closed to its one-line header as Settings says (every kind closed at first), until
 * the user opens or closes it by its header. Control+O opens every block, and closes them all again the next time.
 * Kept while the window is open, the same for every agent and the mind.
 */
interface Blocks {
  /** True while Control+O has every block open. */
  open: boolean
  /** How many times Control+O was pressed. A press overrides what was chosen for one block before it. */
  turn: number
  toggleAll: () => void
}

export const useBlocks = create<Blocks>((set) => ({
  open: false,
  turn: 0,
  toggleAll: () => set(({ open, turn }) => ({ open: !open, turn: turn + 1 })),
}))

/** What the user chose for one block by its header, and at which press of Control+O. */
export interface Choice {
  open: boolean
  turn: number
}

/** What a block is apart from any choice: open by default for its kind or not, and the press of Control+O it arrived at. */
export interface BlockDefault {
  byDefault: boolean
  since: number
}

/**
 * A block's own choice holds until Control+O is pressed again. Without one, it is open while Control+O has every block
 * open, closed if a press since it arrived closed them all, and otherwise as Settings says for its kind.
 */
export function blockOpen(choice: Choice | null, all: Pick<Blocks, 'open' | 'turn'>, block: BlockDefault): boolean {
  if (choice !== null && choice.turn === all.turn) return choice.open
  if (all.open) return true
  return all.turn > block.since ? false : block.byDefault
}

/** One block's open state, and the click on its header that opens or closes just it. */
export function useBlock(kind: BlockKind): { open: boolean; toggle: () => void } {
  const all = useBlocks((state) => state.open)
  const turn = useBlocks((state) => state.turn)
  // Read defensively: a window that hot-reloaded an older store has no such setting yet.
  const byDefault = useSettings((state) => state.openByDefault?.[kind] ?? OPEN_BY_DEFAULT[kind] ?? false)
  const [since] = useState(turn)
  const [choice, setChoice] = useState<Choice | null>(null)
  const open = blockOpen(choice, { open: all, turn }, { byDefault, since })
  return { open, toggle: () => setChoice({ open: !open, turn }) }
}
