/**
 * One place that catches link clicks for the whole app (_specs/027-links-and-files). The Mac window's web view
 * opens no window for a link, so there the host opens the address in the system browser. No JSX here.
 */

export interface LinkEnvironment {
  /** The Mac window: its web view cannot open `target=_blank`. */
  inMacWindow: boolean
  /** A host is connected and can open the address. */
  hasHost: boolean
}

export interface LinkTarget {
  /** The anchor's href, as written. */
  href: string | null
  /** The file the anchor stands for (`data-file`), when it is a local path. */
  file: string | null
}

/** `file`: open the viewer. `system`: the host opens it in the system's app. `default`: the link works as a link does. */
export type LinkDecision = 'file' | 'system' | 'default'

export function decideLink({ href, file }: LinkTarget, { inMacWindow, hasHost }: LinkEnvironment): LinkDecision {
  if (file) return 'file'
  if (inMacWindow && hasHost && href && /^(https?:\/\/|mailto:)/i.test(href)) return 'system'
  return 'default'
}

export interface LinkActions {
  environment(): LinkEnvironment
  openFile(path: string): void
  openAddress(href: string): void
}

/**
 * Listens for clicks on the whole document, after the page's own handlers, and leaves any click they handled.
 * Returns the function that stops listening.
 */
export function catchLinks(page: Document, actions: LinkActions): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    const anchor = (event.target as Element | null)?.closest?.('a')
    if (!anchor) return
    const href = anchor.getAttribute('href')
    const file = anchor.getAttribute('data-file')
    const decision = decideLink({ href, file }, actions.environment())
    if (decision === 'default') return
    event.preventDefault()
    if (decision === 'file') actions.openFile(file!)
    else actions.openAddress(href!)
  }
  page.addEventListener('click', onClick)
  return () => page.removeEventListener('click', onClick)
}
