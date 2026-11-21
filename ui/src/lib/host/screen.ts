import type { StoreApi } from 'zustand/vanilla'
import { hostStore } from './client.ts'
import { mirrorStore, type Mirror, type Pace } from './mirror.ts'
import type { HostState } from './state.ts'

/**
 * What the screen reads of the host (spec 052, A3). `hostStore` takes every socket message at once, and every listener
 * outside React (notifications, completion, the first word, the chat store) hears each one there. React reads these
 * mirrors instead: the screen's takes the host's state once per animation frame, and the lists of agents take the
 * screen's at most five times a second. A hidden page takes nothing, and takes the latest the moment it shows.
 */

/** How often a list of agents takes new words and steps: five times a second. */
export const LIST_EVERY_MS = 200

interface Screen {
  frame: Mirror<HostState>
  list: Mirror<HostState>
}

function mirrors(): Screen | null {
  // Without frames (node, the tests) React reads the host store itself, one draw per message as before.
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return null
  const page: Pace = {
    frame: (then) => void window.requestAnimationFrame(() => then()),
    timer: (then, ms) => void setTimeout(then, ms),
    now: () => Date.now(),
    hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  }
  const frame = mirrorStore(hostStore, page, 'frame')
  const list = mirrorStore(frame.store, page, LIST_EVERY_MS)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      frame.show()
      list.show()
    })
  }
  return { frame, list }
}

// The mirrors live on globalThis, so a hot update that runs this file again keeps the running pair and its page
// listener instead of making a second pair. The window keeps the mirror code it made them with until it reloads.
const holder = globalThis as { __hobkinScreen?: Screen | null }
if (holder.__hobkinScreen === undefined) holder.__hobkinScreen = mirrors()
const kept = holder.__hobkinScreen

/** The host's state as the screen draws it: once per animation frame. */
export const screenStore: StoreApi<HostState> = kept?.frame.store ?? hostStore

/** The host's state as a list of agents draws it: at most once every `LIST_EVERY_MS`. */
export const listStore: StoreApi<HostState> = kept?.list.store ?? hostStore
