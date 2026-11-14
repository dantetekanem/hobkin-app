import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { HostAddress } from './host/connection.ts'

/**
 * The Mac shell's own commands for the window (src-tauri/src/notices.rs and browser.rs): notifications, and the
 * canvas's browser. In a browser tab there are none, and neither are there in a Mac window whose shell was built
 * before them: `shell()` then answers null for each, and the window goes on exactly as it does without them. What
 * uses them takes these shapes, so tests hand it fakes.
 */

/** What the Mac allows hobkin: asked and allowed, refused, not asked yet, or unknown. */
export type ShellPermission = 'granted' | 'denied' | 'prompt' | 'unknown'

export interface NoticeShell {
  /** With `ask`, the Mac's own prompt shows when hobkin has not asked before. */
  permission(ask: boolean): Promise<ShellPermission>
  /** `key` comes back with a click, and nothing else of the notification does. */
  send(notice: { key: string; title: string; body: string }): Promise<void>
  /** A click on one of hobkin's notifications, once the shell has brought the window to the front. */
  onOpen(open: (key: string) => void): Promise<() => void>
}

/** Where the page area is, in the window's own points from its top left. */
export interface BrowserArea {
  x: number
  y: number
  width: number
  height: number
}

/** What the browser shows now. */
export interface BrowserShown {
  url: string
  title: string
  loading: boolean
  back: boolean
  forward: boolean
}

export interface BrowserShell {
  /** Opens the page over the area, or takes the open browser there. */
  open(url: string, area: BrowserArea): Promise<void>
  /** Moves it over the area, or hides it with null. */
  place(area: BrowserArea | null): Promise<void>
  navigate(url: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  close(): Promise<void>
  shown(): Promise<BrowserShown | null>
  onShown(listener: (shown: BrowserShown) => void): Promise<() => void>
}

export interface Shell {
  notices: NoticeShell | null
  browser: BrowserShell | null
}

const NONE: Shell = { notices: null, browser: null }
const MAIN = 'main'

export const inMacWindow = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const notices: NoticeShell = {
  permission: (ask) => invoke<ShellPermission>('notice_permission', { ask }),
  send: ({ key, title, body }) => invoke<void>('notice_send', { key, title, body }),
  onOpen: (open) => listen<string>('notice:open', ({ payload }) => {
    if (typeof payload === 'string') open(payload)
  }),
}

/** The browser's commands go one after another, so a close always lands before the next open. */
let queue: Promise<unknown> = Promise.resolve()
function inTurn<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const turn = queue.then(() => invoke<T>(command, args))
  queue = turn.catch(() => {})
  return turn
}

const browser: BrowserShell = {
  open: (url, area) => inTurn('browser_open', { url, area }),
  place: (area) => inTurn('browser_place', { area }),
  navigate: (url) => inTurn('browser_navigate', { url }),
  back: () => inTurn('browser_back'),
  forward: () => inTurn('browser_forward'),
  reload: () => inTurn('browser_reload'),
  close: () => inTurn('browser_close'),
  shown: () => inTurn('browser_shown'),
  onShown: (listener) => listen<BrowserShown>('canvas-browser:state', ({ payload }) => listener(payload)),
}

let asked: Promise<Shell> | null = null

/** What this window's shell offers, asked once. A shell without the commands refuses the question, and offers nothing. */
export function shell(): Promise<Shell> {
  asked ??= inMacWindow()
    ? invoke<{ notices?: boolean; browser?: boolean }>('shell_features').then(
        (has) => ({ notices: has.notices === true ? notices : null, browser: has.browser === true ? browser : null }),
        () => NONE,
      )
    : Promise.resolve(NONE)
  return asked
}

/** Whether the window is in front: shown, not minimized, and the key window of the active app. */
export async function windowInFront(): Promise<boolean> {
  const page = () => document.visibilityState === 'visible' && document.hasFocus()
  if (!inMacWindow()) return page()
  try {
    // The window's own answer: a page in the canvas's browser can hold the keyboard while the window is in front.
    const [focused, visible, minimized] = await Promise.all(
      ['is_focused', 'is_visible', 'is_minimized'].map((command) => invoke<boolean>(`plugin:window|${command}`, { label: MAIN })),
    )
    return focused === true && visible === true && minimized !== true
  } catch {
    return page()
  }
}

/**
 * Where the shell's own host is, for a packaged window. The shell may hold this call for several seconds while the
 * host starts, and answers null when there is none yet. Any failure is also null, so the caller just asks again.
 */
export function shellHostAddress(): Promise<HostAddress | null> {
  return invoke<HostAddress | null>('host_address').then((address) => address ?? null, () => null)
}

/** The updater's commands (src-tauri). A development build never registers them, so each call may reject. */
export const updater = {
  /** The version downloaded and ready to start, or null. */
  status: () => invoke<string | null>('update_status'),
  restart: () => invoke<void>('update_restart'),
  onReady: (listener: (payload: unknown) => void) => listen<unknown>('update-ready', ({ payload }) => listener(payload)),
}
