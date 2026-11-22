import type { ProofTab } from './kept.ts'

/**
 * The keys of a proof run (053-work-control-room, "Proofs"), on its page and in a panel beside another page. They act
 * only while the proof has the keyboard, and never while typing in a field or with Command, Control or Option, which
 * stay the frame's. In a panel, Escape and T close it, Shift+T opens the full page, and Up and Down walk its stops; on
 * the page those stay the frame's and the screen's (`app/stops.ts`). Left and Right stay the graph's and the tabs'.
 */

export interface ProofKeyPress {
  key: string
  shift: boolean
  meta: boolean
  ctrl: boolean
  alt: boolean
  /** The keyboard is in a text field, a select or something editable. */
  typing: boolean
  composing?: boolean
}

export type ProofKeyAction =
  | { do: 'sibling'; delta: 1 | -1 }
  | { do: 'failure'; delta: 1 | -1 }
  | { do: 'part'; part: ProofTab }
  | { do: 'search' }
  | { do: 'again' }
  | { do: 'close' }
  | { do: 'expand' }
  | { do: 'walk'; delta: 1 | -1 }

const PARTS: Readonly<Record<string, ProofTab>> = { '1': 'run', '2': 'graph', '3': 'math' }

export function proofKey(press: ProofKeyPress, { panel }: { panel: boolean }): ProofKeyAction | null {
  if (press.typing || press.composing || press.meta || press.ctrl || press.alt) return null
  const key = press.key.length === 1 ? press.key.toLowerCase() : press.key

  // Shift changes only F's way and T's meaning.
  if (key === 'f') return { do: 'failure', delta: press.shift ? -1 : 1 }
  if (panel && key === 't') return press.shift ? { do: 'expand' } : { do: 'close' }
  if (press.shift) return null

  if (key === 'j') return { do: 'sibling', delta: 1 }
  if (key === 'k') return { do: 'sibling', delta: -1 }
  const part = PARTS[key]
  if (part) return { do: 'part', part }
  if (key === '/') return { do: 'search' }
  if (key === 'r') return { do: 'again' }
  if (!panel) return null
  if (key === 'Escape') return { do: 'close' }
  if (key === 'ArrowDown') return { do: 'walk', delta: 1 }
  if (key === 'ArrowUp') return { do: 'walk', delta: -1 }
  return null
}

/** The keys as the proof's heading shows them, in a quiet row, and as the app's list of keys names them. */
export const PROOF_KEY_HINTS: readonly { keys: string; does: string; panel?: true }[] = [
  { keys: 'J K', does: 'models' },
  { keys: 'F', does: 'what failed' },
  { keys: '1 2 3', does: 'run, graph, math' },
  { keys: '/', does: 'search' },
  { keys: 'R', does: 'run again' },
  { keys: 'T', does: 'close', panel: true },
]
