/**
 * The page side of the frame's keys that is tested without a browser: the listeners, and whether an overlay has the
 * keyboard. `keys.ts` carries the map out on the page; `key-map.ts` is the map.
 */

export interface FrameKeyHandlers {
  /** Read first, in the capture phase, so the map is decided before a focused control sees the key. */
  capture: (event: KeyboardEvent) => void
  /** Read last, in the bubble phase, so whatever had the keyboard gets to use the key first. */
  bubble: (event: KeyboardEvent) => void
}

/** Kept on the page itself, so it outlives every copy of this module a hot update loads. */
const SLOT = '__hobkinFrameKeys'
type Slot = { target: EventTarget; handlers: FrameKeyHandlers }

/**
 * The frame's two keyboard listeners are added once per page and call whatever handlers were given last. A hot update
 * of the keys swaps the logic without dropping or doubling a listener, and an update that fails to load leaves the
 * last working handlers in place. A handler that throws is logged, and the next key works again.
 */
export function installFrameKeys(target: EventTarget, handlers: FrameKeyHandlers): void {
  const page = globalThis as { [SLOT]?: Slot }
  const held = page[SLOT]
  if (held?.target === target) {
    held.handlers = handlers
    return
  }
  const slot: Slot = { target, handlers }
  page[SLOT] = slot
  const call = (phase: keyof FrameKeyHandlers) => (event: Event) => {
    try {
      slot.handlers[phase](event as KeyboardEvent)
    } catch (error) {
      console.error('[keys]', error)
    }
  }
  target.addEventListener('keydown', call('capture'), true)
  target.addEventListener('keydown', call('bubble'))
}

/** Drawn now, and not on its way out. */
const shown = (element: Element) => !element.hasAttribute('data-ending-style') && element.getClientRects().length > 0

/** The frame's own lists: the agents list under the chat, there whenever an agent is listed, and the chat's veil. */
const FRAME_OWN = '[data-agents-dock], [data-chat-veil]'

/**
 * A dialog, menu or list is drawn over the window, so the keyboard the page lost is the user's to place. The frame's own
 * lists never count: the agents list is a list box whenever an agent is listed, and counting it kept the keyboard on
 * the page for good (`keyboard-watch.ts`).
 */
export function overlayOpen(page: Document): boolean {
  const open = page.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [role="menu"], [role="listbox"]')
  return [...open].some((element) => element.closest(FRAME_OWN) === null && shown(element))
}

/**
 * A dialog, menu or list that handles its own keys has the keyboard. The veil and the agents list are the frame's own,
 * so they do not count. An input that is showing completions (a combobox with its list open, such as the message input
 * after a slash) owns its keys too: there Tab completes. Only an overlay open and drawn now counts: one on its way out,
 * or a marker one left behind, never keeps the frame's keys.
 */
export function inOverlay(target: EventTarget | null, page: Document): boolean {
  if (target === page.body) {
    // With the keyboard resting on the window itself, a modal lightbox still has it, as ⌘↵ applies the models. It marks
    // the app inert while it is open, and the mark counts only while such a dialog is drawn outside the app.
    if (page.getElementById('root')?.hasAttribute('data-base-ui-inert') !== true) return false
    return [...page.querySelectorAll('[role="dialog"]')].some((dialog) => dialog.closest('#root') === null && shown(dialog))
  }
  const element = target as Element | null
  if (typeof element?.closest !== 'function') return false
  if (element.matches('[role="combobox"][aria-expanded="true"]')) return true
  const overlay = element.closest('[role="dialog"]:not([data-chat-veil]), [role="menu"], [role="listbox"]:not([data-agents-dock])')
  return overlay !== null && shown(overlay)
}
