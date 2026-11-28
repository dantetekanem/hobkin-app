import { canvasUrl } from '#shared/protocol/canvas.ts'
import type { BrowserArea, BrowserShell, BrowserShown } from '../../lib/native.ts'
import { labelFor } from './rules.ts'

/**
 * The canvas's browser (_specs/036-canvas-browser): a page canvas shows in a native webview laid over the canvas's page
 * area, with an address field, Back, Forward and Reload. Pure rules, so they can be tested without a window: what a
 * typed address becomes, what the bar shows, when the native view shows, the rectangle it is sent, and what goes to it.
 */

const WORDS = { refused: 'Only an address goes here. Words are not searched.' }
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
/** `localhost:5173` or `127.0.0.1:8080/app`: a host and a port, which a URL would read as a scheme. */
const HOST_PORT = /^([^\s/?#:@]+):\d{1,5}(?=$|[/?#])/
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/
/** A name with a top-level domain: `example.com`, never a lone word. */
const NAMED = /\.(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})\.?$/i

const isLocal = (host: string) => host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || IPV4.test(host)

/**
 * What a typed address becomes: a page, or why not. An address without a scheme gets https, or http on this Mac and on
 * a bare IP address. Words are never searched: only an address goes. The page keeps the canvas's rule (`canvasUrl`).
 */
export function addressFrom(typed: string): { url: string } | { refused: string } {
  const text = typed.trim()
  if (!text) return { refused: 'Type an address.' }
  if (/\s/.test(text)) return WORDS
  let address = text
  const hostPort = HOST_PORT.exec(text)
  if (hostPort || !SCHEME.test(text)) {
    const host = (hostPort?.[1] ?? text.split(/[/?#]/)[0] ?? '').toLowerCase()
    const local = isLocal(host)
    if (!local && !NAMED.test(host)) return WORDS
    address = `${local ? 'http' : 'https'}://${text}`
  }
  try {
    return { url: canvasUrl(address).href }
  } catch (error) {
    return { refused: error instanceof Error ? error.message : 'That is not a web address.' }
  }
}

const isWeb = (address: string) => /^https?:\/\//i.test(address)

const hostOf = (address: string) => {
  try {
    return new URL(address).host || address
  } catch {
    return address
  }
}

export interface Bar {
  /** What the address field holds. */
  field: string
  /** The page's name beside it. */
  label: string
  loading: boolean
  back: boolean
  forward: boolean
  /** What Open in the browser opens: the page on screen, when it is a web page. */
  opens: string
}

/**
 * What the bar shows. `url` and `title` are hobkin's (`canvas.show`); `shown` is what the browser last said, null
 * before it said anything; `editing` is what the user is typing, null while they are not.
 */
export function barOf({ url, title, shown, editing }: { url: string; title: string | null; shown: BrowserShown | null; editing: string | null }): Bar {
  const onHobkinsPage = !shown || shown.url === url
  return {
    field: editing ?? (shown?.url || url),
    label: shown?.title.trim() || (onHobkinsPage ? labelFor(url, title) : hostOf(shown.url)),
    loading: shown ? shown.loading : true,
    back: shown?.back ?? false,
    forward: shown?.forward ?? false,
    opens: shown && isWeb(shown.url) ? shown.url : url,
  }
}

/** A native view draws over everything in the window, so it shows only over an open canvas that nothing covers. */
export function nativeShown({ open, covered, area }: { open: boolean; covered: boolean; area: BrowserArea | null }): boolean {
  return open && !covered && area !== null
}

/** Less than this much of the page area is not worth showing. */
const SMALLEST = 24

/** The page area as the native view takes it: whole points, the part inside the window, or null when too little shows. */
export function areaOf(box: { left: number; top: number; width: number; height: number }, window: { width: number; height: number }): BrowserArea | null {
  const x = Math.max(0, Math.round(box.left))
  const y = Math.max(0, Math.round(box.top))
  const width = Math.min(window.width, Math.round(box.left + box.width)) - x
  const height = Math.min(window.height, Math.round(box.top + box.height)) - y
  return width >= SMALLEST && height >= SMALLEST ? { x, y, width, height } : null
}

/** Where the window looks for anything over the page area: a grid of nine points inside it. */
export function samplePoints(area: BrowserArea): { x: number; y: number }[] {
  const at = [0.1, 0.5, 0.9]
  return at.flatMap((down) => at.map((across) => ({ x: area.x + area.width * across, y: area.y + area.height * down })))
}

/** Whether anything is over the page area: a dialog, a sheet, another screen's overlay. `ours` says a point shows the page area itself. */
export function covered(area: BrowserArea, ours: (point: { x: number; y: number }) => boolean): boolean {
  return samplePoints(area).some((point) => !ours(point))
}

/** What the canvas wants of the native view now: hobkin's page and how many times hobkin showed it, and where it shows. */
export interface Wanted {
  url: string
  visit: number
  /** Null to hide it. */
  area: BrowserArea | null
}

const keyOf = (area: BrowserArea | null) => (area ? `${area.x},${area.y},${area.width},${area.height}` : 'hidden')

export type NativeView = ReturnType<typeof createNativeView>

/**
 * The window's side of one native view: it is opened when it first shows, told only what changed, and closed once.
 * Calls go to the shell in the order they were made, and one that fails does not stop the next.
 */
export function createNativeView(shell: BrowserShell, scope?: string) {
  let chain: Promise<void> = Promise.resolve()
  let opened = false
  let closed = false
  let visited: string | null = null
  let placed: string | null = null
  let typed: string | null = null
  const run = (step: () => Promise<void>): Promise<void> => {
    chain = chain.then(step).catch(() => {})
    return chain
  }
  const whenOpen = (step: () => Promise<void>) => (opened && !closed ? run(step) : chain)

  return {
    sync({ url, visit, area }: Wanted): Promise<void> {
      if (closed) return chain
      const wanted = `${visit}#${url}`
      if (!opened) {
        if (!area) return chain
        const start = typed ?? url
        opened = true
        visited = wanted
        placed = keyOf(area)
        typed = null
        return run(() => shell.open(start, area, scope))
      }
      if (wanted !== visited) {
        visited = wanted
        run(() => shell.navigate(url))
      }
      if (keyOf(area) !== placed) {
        placed = keyOf(area)
        run(() => shell.place(area))
      }
      return chain
    },
    /** An address the user typed, already through `addressFrom`. */
    go(url: string): Promise<void> {
      if (!opened && !closed) typed = url
      return whenOpen(() => shell.navigate(url))
    },
    back: () => whenOpen(() => shell.back()),
    forward: () => whenOpen(() => shell.forward()),
    reload: () => whenOpen(() => shell.reload()),
    close(): Promise<void> {
      if (closed) return chain
      closed = true
      return opened ? run(() => shell.close()) : chain
    },
  }
}
