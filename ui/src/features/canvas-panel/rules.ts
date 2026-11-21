import { isLocalPage, MAIN_CANVAS, type CanvasKind, type CanvasState } from '#shared/protocol/canvas.ts'
import { hobkinOfAgent } from '#shared/protocol/hobkins.ts'

/**
 * The canvas's rules (`030-canvas-panel`, `035-canvas-drawings`, `040-canvas-board`): what a framed page may do, what
 * the canvas is called, where it shows, how the view follows it, and which keys a drawing passes on. Pure, so they are
 * tested without a window.
 */

/**
 * What the framed page may do. A page on this Mac (localhost or 127.0.0.1 over http) runs scripts with its own
 * origin, as it does in a tab, so a dev server works. Any other page runs scripts but without its origin, so it
 * cannot read cookies or storage, and nothing else is granted: no top-level navigation, no downloads.
 */
export function sandboxFor(url: string, kind: CanvasKind = 'page'): string {
  // A drawing is served from this Mac but written by a model: it runs without an origin, whatever its address.
  if (kind === 'drawing') return 'allow-scripts allow-forms allow-popups allow-modals'
  if (isLocalPage(url)) return 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals'
  return 'allow-scripts allow-forms allow-popups'
}

/** The canvas's name: what hobkin called it, else "Drawing" for a drawing, else the page's host. */
export function labelFor(url: string, title: string | null, kind: CanvasKind = 'page'): string {
  if (title?.trim()) return title.trim()
  if (kind === 'drawing') return 'Drawing'
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Only a drawing can be saved as a file. */
export const canSave = (kind: CanvasKind | undefined): boolean => kind === 'drawing'

/** How long a page may take to load before the canvas says it may refuse to be framed. */
export const LOAD_PATIENCE_MS = 8000

/**
 * Where a canvas's page or drawing starts, in pixels from the top of the right side: just below the floating menu with
 * its two rows (`ScreenMenu.tsx`: 14 from the top, then 5 + 32 + 8 + 32 + 5 for the rows on their surface), and 8 more.
 */
export const CANVAS_TOP = 104

/** Open, with something to show. */
export const isOpen = (canvas: CanvasState | null | undefined): canvas is CanvasState & { url: string } => canvas?.open === true && Boolean(canvas.url)

/** One canvas as the host said it, as text: the same words give the same key, and anything new another one. */
export function canvasKey(canvas: CanvasState | null | undefined): string {
  if (!canvas) return 'none'
  return JSON.stringify([canvas.open, canvas.url, canvas.title, canvas.kind ?? 'page', canvas.revision ?? null])
}

/** What the window adds to the host's word on one canvas. */
export interface CanvasHere {
  /** The user closed it here, while the host said this (`canvasKey`). It reads closed until the host says anything new. */
  closed?: string | null
  /** Development only: a canvas shown by hand over what the host said then, until the host says anything new. */
  dev?: { canvas: CanvasState; over: string } | null
}

/**
 * The canvas the window shows: the host's, closed at once when the user closes it here (the host's answer follows),
 * or one shown by hand for a check. Null while the host has not said anything about it.
 */
export function windowCanvas(host: CanvasState | null | undefined, { closed, dev }: CanvasHere): CanvasState | null {
  if (dev && dev.over === canvasKey(host)) return dev.canvas
  if (host && closed === canvasKey(host)) return { ...host, open: false }
  return host ?? null
}

/**
 * How the view follows the main canvas (`040-canvas-board` A1, A4). Closed to open takes the right side to the canvas,
 * unless the right side covers the chat right then: a review the user is in, or a durable hobkin's split. A redraw
 * never moves it, and neither does a canvas found open when the host first speaks. On the canvas, one that is closed,
 * or that closed while the window reloaded, goes back to the place under it. Before the host has said, nothing moves.
 */
export function placeMove({ before, now, onPlace, covered }: { before: boolean | null; now: boolean | null; onPlace: boolean; covered: boolean }): 'open' | 'back' | null {
  if (now === null) return null
  if (!now) return onPlace ? 'back' : null
  return before === false && !onPlace && !covered ? 'open' : null
}

/** A canvas redrawn since the user last saw it in front. One never seen counts from nothing. */
export const canvasDot = (revision: number | undefined, seen: number | undefined): boolean => (revision ?? 0) > (seen ?? 0)

/**
 * The main canvas's pill at the end of the menu's second row: while it is open and another screen shows, except during
 * a durable hobkin's split, whose own canvas has the row. Dotted after a redraw not seen.
 */
export function mainPill({ screen, split, main, seen }: { screen: string; split: boolean; main: CanvasState | null; seen: number | undefined }): { dot: boolean } | null {
  if (screen === 'canvas' || split || !isOpen(main)) return null
  return { dot: canvasDot(main.revision, seen) }
}

type View = { screen: string; openAgent: string | null }
type CanvasOf = (owner: string) => CanvasState | null | undefined

/** The durable hobkin whose split shows: its page is on screen and its canvas is open. */
export function splitOwner({ screen, openAgent }: View, canvasOf: CanvasOf): string | null {
  const id = screen === 'agent' ? hobkinOfAgent(openAgent) : null
  return id && isOpen(canvasOf(id)) ? id : null
}

/**
 * The canvas on screen, and where its agent takes the keyboard: the main canvas on its place, with the message input,
 * or a durable hobkin's in its split, with the page's talk box.
 */
export function showingCanvas(view: View, canvasOf: CanvasOf): { owner: string; agent: 'input' | 'talk' } | null {
  if (view.screen === 'canvas') return isOpen(canvasOf(MAIN_CANVAS)) ? { owner: MAIN_CANVAS, agent: 'input' } : null
  const owner = splitOwner(view, canvasOf)
  return owner ? { owner, agent: 'talk' } : null
}

/** A drawing's frame opens on the theme and the Still showing now, so its first paint already matches the window. */
export function frameSrc(url: string, theme: 'light' | 'dark', still: boolean): string {
  try {
    const address = new URL(url)
    address.searchParams.set('theme', theme)
    address.searchParams.set('still', still ? '1' : '0')
    return address.href
  } catch {
    return url
  }
}

/** Which drawing an address is, whatever its revision: its origin and path, without the query that names the revision. */
export function drawingOf(url: string): string {
  try {
    const { origin, pathname } = new URL(url)
    return `${origin}${pathname}`
  } catch {
    return url
  }
}

/** A key a drawing did not use, as it tells the window. */
export interface FrameKey {
  key: string
  code: string
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
}

/** The keys a drawing passes on: Escape, Command with S, 1 to 9, K, L, Return, comma, J or Y, and Control+Tab with or without Shift. */
const PASSED: readonly { key: string; code: string; meta?: true; ctrl?: true; shift?: true }[] = [
  { key: 'Escape', code: 'Escape' },
  { key: 's', code: 'KeyS', meta: true },
  ...'123456789'.split('').map((digit) => ({ key: digit, code: `Digit${digit}`, meta: true as const })),
  { key: 'k', code: 'KeyK', meta: true },
  { key: 'l', code: 'KeyL', meta: true },
  { key: 'Enter', code: 'Enter', meta: true },
  { key: ',', code: 'Comma', meta: true },
  { key: 'j', code: 'KeyJ', meta: true },
  { key: 'y', code: 'KeyY', meta: true },
  { key: 'Tab', code: 'Tab', ctrl: true },
  { key: 'Tab', code: 'Tab', ctrl: true, shift: true },
]

/**
 * The key to press on the frame for a key a drawing passed on, or null (`040-canvas-board` A8). Only from the set, with
 * exactly its modifiers, and only while the drawing's frame has the keyboard. Nothing that ends, stops, sends or
 * reloads is in it. The key pressed is the set's own, never a code the drawing made up, so a Tab cannot pass for
 * Control+X with the frame's keys that go by where a key sits.
 */
export function passedKey(press: FrameKey, frameHasKeyboard: boolean): KeyboardEventInit | null {
  if (!frameHasKeyboard || press.alt) return null
  const key = press.key.length === 1 ? press.key.toLowerCase() : press.key
  const entry = PASSED.find(
    (passed) => passed.key === key && Boolean(passed.meta) === press.meta && Boolean(passed.ctrl) === press.ctrl && Boolean(passed.shift) === press.shift,
  )
  if (!entry) return null
  return {
    key: entry.key,
    code: entry.code,
    metaKey: Boolean(entry.meta),
    ctrlKey: Boolean(entry.ctrl),
    altKey: false,
    shiftKey: Boolean(entry.shift),
    bubbles: true,
    cancelable: true,
  }
}
