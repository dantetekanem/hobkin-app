/**
 * The Reports screen's own keys, as a function with no knowledge of the page: a key and where the keyboard is
 * go in, and what the screen should do comes out. `ReportsScreen.tsx` reads the page and carries the answer out.
 *
 * Tab and the Command keys are the frame's (`app/key-map.ts`). Up and Down between controls are the walk
 * every screen shares (`app/stops.ts`). The rest follows hobkin's terminal app: Enter reads, `/` filters by
 * title, `r` replies, Escape steps back.
 */

export interface KeyPress {
  key: string
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

/** Where the keyboard is: on the kind filter, in the title field, on a report in the list, or in the open report. */
export type Where = 'kind' | 'title' | 'row' | 'reader' | 'other'

export interface KeyContext {
  where: Where
  /** True when the title filter holds no text. Escape clears it before it leaves the screen. */
  titleEmpty: boolean
  /** A deleted report can still be brought back. */
  canUndo: boolean
}

export type KeyAction =
  | { do: 'open' }
  /** From the title field: read the first report that matches. */
  | { do: 'open-first' }
  | { do: 'close' }
  /** To the next report (1) or the previous one (-1) without leaving the reader. */
  | { do: 'step'; delta: 1 | -1 }
  | { do: 'scroll'; by: 'page' | 'all'; delta: 1 | -1 }
  | { do: 'kind'; delta: 1 | -1 }
  /** Puts the keyboard in the title field. */
  | { do: 'find' }
  | { do: 'clear-title' }
  | { do: 'reply' }
  | { do: 'delete' }
  | { do: 'undo' }

/** The keys that act on the report that has the keyboard, in the list or open. */
function onReport(key: string, { canUndo }: KeyContext): KeyAction | null {
  if (key === 'r' || key === 'm') return { do: 'reply' }
  if (key === 'Backspace' || key === 'Delete') return { do: 'delete' }
  if (key === 'u' && canUndo) return { do: 'undo' }
  return null
}

function readerKey({ key, shift }: KeyPress, context: KeyContext): KeyAction | null {
  // Space reads on, and Shift+Space back, as in any reader.
  if (key === ' ') return { do: 'scroll', by: 'page', delta: shift ? -1 : 1 }
  if (shift) return null

  if (key === 'Escape') return { do: 'close' }
  // Right and Down go to the next report, as the list runs, Left and Up to the one before. The page keys scroll it.
  if (key === 'ArrowRight' || key === 'ArrowDown') return { do: 'step', delta: 1 }
  if (key === 'ArrowLeft' || key === 'ArrowUp') return { do: 'step', delta: -1 }
  if (key === 'PageDown') return { do: 'scroll', by: 'page', delta: 1 }
  if (key === 'PageUp') return { do: 'scroll', by: 'page', delta: -1 }
  if (key === 'End') return { do: 'scroll', by: 'all', delta: 1 }
  if (key === 'Home') return { do: 'scroll', by: 'all', delta: -1 }
  return onReport(key, context)
}

/** What the screen does for a key, or null when the key is not the screen's. */
export function reportsKey(press: KeyPress, context: KeyContext): KeyAction | null {
  if (press.meta || press.ctrl || press.alt) return null
  if (context.where === 'reader') return readerKey(press, context)

  const { key } = press
  // Escape walks one step back. With no filter to clear it is left for the frame, which takes the keyboard home.
  if (key === 'Escape') return context.titleEmpty ? null : { do: 'clear-title' }
  // Everything else typed in the title field is text.
  if (context.where === 'title') return key === 'Enter' ? { do: 'open-first' } : null
  if (press.shift) return null

  if (key === '/') return { do: 'find' }
  if (context.where === 'kind') {
    if (key === 'ArrowRight') return { do: 'kind', delta: 1 }
    if (key === 'ArrowLeft') return { do: 'kind', delta: -1 }
  }
  if (context.where === 'row') {
    // The list is on the right, so a report opens toward the reader on its left.
    if (key === 'Enter' || key === 'ArrowLeft') return { do: 'open' }
    return onReport(key, context)
  }
  return key === 'u' && context.canUndo ? { do: 'undo' } : null
}
