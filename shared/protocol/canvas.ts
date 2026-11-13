/**
 * The canvas panel as the host tells the window: whether it is open and the page it shows. hobkin opens it
 * (`canvas.show`) when it has something to show, and closes it (`canvas.close`). See _specs/030-canvas-panel.
 */
export interface CanvasState {
  open: boolean
  /** The page, or null while closed. Always an http or https address. */
  url: string | null
  /** What hobkin calls the page, or null. The panel falls back to the page's host. */
  title: string | null
  /** A web page, or a drawing a hobkin wrote, which the host serves at `url`. A host from before drawings sends none: a page. */
  kind?: CanvasKind
  /** Goes up each time the drawing is replaced, so the frame loads it again. */
  revision?: number
}

/** What a canvas shows. See _specs/035-canvas-drawings. */
export type CanvasKind = 'page' | 'drawing'

export const CANVAS_CLOSED: CanvasState = { open: false, url: null, title: null }

/** Whose canvas it is: the main hobkin's, or a durable hobkin's by its id. */
export const MAIN_CANVAS = 'main'
/** The largest drawing, as UTF-8 bytes. */
export const DRAWING_MAX_BYTES = 2 * 1024 * 1024

/** What `canvas.read` gives: the canvas, and the file that holds its drawing, when it has one. */
export interface CanvasContent {
  state: CanvasState
  file: string | null
}

/** Where `canvas.save` wrote the drawing. */
export interface CanvasSaved {
  path: string
}

/** The page address as a URL, or an error in plain words. Only http and https, with a host and no sign-in in it. */
export function canvasUrl(address: string): URL {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw Error('That is not a web address.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw Error('The canvas shows only http and https pages.')
  if (!url.hostname) throw Error('That address has no host.')
  if (url.username || url.password) throw Error('The canvas does not take an address with a sign-in in it.')
  return url
}

/** A page on this Mac: only these may run scripts with their own origin inside the panel. */
export function isLocalPage(address: string): boolean {
  try {
    const { protocol, hostname } = new URL(address)
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')
  } catch {
    return false
  }
}
