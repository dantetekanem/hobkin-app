import { createContext, useContext, useState } from 'react'
import { create } from 'zustand'
import { OPEN_BY_DEFAULT, type BlockKind } from '../settings/rules.ts'
import { useSettings } from '../settings/store.ts'
import { tellUnfold } from './unfold.ts'

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

/** What a block of a windowed list's row was at when it was last drawn: the press of Control+O it arrived at, and the user's own choice. */
export interface Remembered {
  since: number
  choice: Choice | null
}

/** Each list's blocks, by list and then by block; for the lists drawn most recently. On globalThis, so a hot update keeps them. */
const REMEMBERED_LISTS = 24
const remembered: Map<string, Map<string, Remembered>> = ((globalThis as { __hobkinBlocks?: Map<string, Map<string, Remembered>> }).__hobkinBlocks ??= new Map())

/** What the blocks of the list `name` (an agent's page, windowed-list.tsx) remember. */
export function blockMemoryOf(name: string): Map<string, Remembered> {
  const blocks = remembered.get(name) ?? new Map<string, Remembered>()
  remembered.delete(name)
  remembered.set(name, blocks)
  for (const oldest of remembered.keys()) {
    if (remembered.size <= REMEMBERED_LISTS) break
    remembered.delete(oldest)
  }
  return blocks
}

/**
 * The row of a windowed list a block is drawn in, and what that list's blocks remember. A windowed list draws a row
 * again each time it scrolls back into view, and an agent's page again each time it is opened: drawn again, a block shows
 * what it showed, as if it had stayed. None outside a windowed list, where a block drawn again starts afresh.
 */
export const BlockPlace = createContext<{ blocks: Map<string, Remembered>; row: string } | null>(null)

/** What the block `name` remembers, made as it arrives now, at the press of Control+O `turn`, when it remembers nothing yet. */
function rememberedOf(blocks: Map<string, Remembered>, name: string, turn: number): Remembered {
  const held = blocks.get(name)
  if (held) return held
  const arrived = { since: turn, choice: null }
  blocks.set(name, arrived)
  return arrived
}

/**
 * One block's open state, and the click on its header that opens or closes just it. The click tells the transcript
 * first, from the header it was on, so the block opens below the header where the user reads it and the view does not
 * follow the end. `id` tells the block from the others of its kind in its row, for a windowed list to remember it by.
 */
export function useBlock(kind: BlockKind, id = ''): { open: boolean; toggle: (press?: { currentTarget: Element }) => void } {
  const all = useBlocks((state) => state.open)
  const turn = useBlocks((state) => state.turn)
  // Read defensively: a window that hot-reloaded an older store has no such setting yet.
  const byDefault = useSettings((state) => state.openByDefault?.[kind] ?? OPEN_BY_DEFAULT[kind] ?? false)
  const place = useContext(BlockPlace)
  const name = `${place?.row}\u0000${kind}\u0000${id}`
  const [since] = useState(() => (place ? rememberedOf(place.blocks, name, turn).since : turn))
  const [choice, setChoice] = useState<Choice | null>(() => place?.blocks.get(name)?.choice ?? null)
  const open = blockOpen(choice, { open: all, turn }, { byDefault, since })
  const toggle = (press?: { currentTarget: Element }) => {
    tellUnfold(press?.currentTarget ?? null, open)
    const chosen = { open: !open, turn }
    setChoice(chosen)
    place?.blocks.set(name, { since, choice: chosen })
  }
  return { open, toggle }
}
