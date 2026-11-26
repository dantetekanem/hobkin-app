/**
 * When the conversation follows its newest message. Only the user reading up stops it: a wheel or trackpad moving up,
 * a key that reads up, or a drag upward on the conversation or its scroll bar. A row the user opens or closes in place
 * holds the view where they read it, and once it settles the view follows again only if the end is in view. Layout
 * moves the scroll too, as when content shrinks, a glide settles or the input under the conversation changes height,
 * and it never stops the following. Scrolling back down to the end, or asking for the newest message, follows again.
 *
 * Without React or a window, so its rules are tested with plain numbers. `use-pinned-scroll.ts` gives it to the chat.
 */

/** How close to the end still counts as being at the end, in pixels. */
export const SLACK = 48

/** Keys that read up the conversation. Shift+Space does too. */
const READS_UP = ['ArrowUp', 'PageUp', 'Home']

export interface Follow {
  /** The view follows the newest message. */
  following: boolean
  /** How far down the last scroll found the view. */
  top: number
  /** A pointer or finger is down on the conversation, so a scroll up is the user dragging it. */
  pressed: boolean
}

export type FollowEvent =
  | { type: 'wheel'; deltaY: number; top: number }
  | { type: 'key'; key: string; shiftKey?: boolean }
  | { type: 'press' }
  | { type: 'release' }
  /** The view scrolled, whatever moved it. */
  | { type: 'scroll'; top: number; scrollHeight: number; clientHeight: number }
  /** The user asked for the newest message. */
  | { type: 'jump' }
  /** The user opens or closes a row in place, such as a digest: the view holds while it changes height. */
  | { type: 'unfold' }
  /** A moment after a row opened or closed, where the view is now. */
  | { type: 'settle'; top: number; scrollHeight: number; clientHeight: number }

export const START: Follow = { following: true, top: 0, pressed: false }

export function followAfter(state: Follow, event: FollowEvent): Follow {
  switch (event.type) {
    case 'wheel':
      return event.deltaY < 0 && event.top > 0 ? { ...state, following: false } : state
    case 'key': {
      const readsUp = READS_UP.includes(event.key) || (event.key === ' ' && event.shiftKey === true)
      return readsUp ? { ...state, following: false } : state
    }
    case 'press':
      return { ...state, pressed: true }
    case 'release':
      return { ...state, pressed: false }
    case 'jump':
      return { ...state, following: true, pressed: false }
    case 'unfold':
      return { ...state, following: false }
    case 'settle':
      return { ...state, top: event.top, following: event.scrollHeight - event.top - event.clientHeight <= SLACK }
    case 'scroll': {
      const atEnd = event.scrollHeight - event.top - event.clientHeight <= SLACK
      const moved = { ...state, top: event.top }

      if (event.top > state.top && atEnd) return { ...moved, following: true }
      if (event.top < state.top && state.pressed) return { ...moved, following: false }
      return moved
    }
  }
}
