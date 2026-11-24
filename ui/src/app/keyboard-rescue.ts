/** What the frame knows when the keyboard has fallen to the page itself. */
export interface KeyboardFall {
  /** The keyboard is on the page now, so nothing holds it. */
  onBody: boolean
  windowFocused: boolean
  /** What lost it was a text field. */
  fromField: boolean
  /** What lost it was in a screen of the canvas. */
  fromCanvas: boolean
  /** The mark of the row it was on (`rowKeyOf`), if it was on one. */
  rowKey?: string
  /** That row is drawn on the open screen now. */
  rowDrawn: boolean
  /** A dialog, menu or list is open. */
  overlayOpen: boolean
  /** How long before the fall the user last pressed with the pointer, or null when they have not. */
  sincePointerMs: number | null
}

/** A pointer press this close to the fall caused it: the user chose where the keyboard is. */
export const POINTER_CAUSE_MS = 300

/** Where the keyboard goes back to: the row it was on, else the open screen as Escape does, else nowhere. */
export function rescueKeyboard(fall: KeyboardFall): { to: 'row'; key: string } | { to: 'screen' } | null {
  if (!fall.onBody || !fall.windowFocused || fall.fromField || fall.overlayOpen) return null
  if (fall.sincePointerMs !== null && fall.sincePointerMs <= POINTER_CAUSE_MS) return null
  if (fall.rowKey && fall.rowDrawn) return { to: 'row', key: fall.rowKey }
  return fall.fromCanvas ? { to: 'screen' } : null
}
