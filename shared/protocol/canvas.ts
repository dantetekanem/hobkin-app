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
}

export const CANVAS_CLOSED: CanvasState = { open: false, url: null, title: null }

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
