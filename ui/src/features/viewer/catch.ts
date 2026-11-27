/**
 * One place that catches link clicks for the whole app (_specs/027-links-and-files). The Mac window's web view
 * opens no window for a link, so there the host opens the address in the system browser, or a `slack:` one in the
 * Slack app. No JSX here.
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
  /** ⌘ was held: a file opens in its own app. */
  meta?: boolean
}

/**
 * `file`: open the viewer. `app`: the host opens the file in its default app. `system`: the host opens the address in
 * the system's app. `default`: the link works as a link does.
 */
export type LinkDecision = 'file' | 'app' | 'chrome' | 'system' | 'default'

export function decideLink({ href, file, meta = false }: LinkTarget, { inMacWindow, hasHost }: LinkEnvironment): LinkDecision {
  // With no host to open it, the viewer says why it cannot.
  if (file) {
    if (hasHost && meta) return 'app'
    if (hasHost && inMacWindow && /\.pdf$/i.test(file)) return 'chrome'
    return 'file'
  }
  if (inMacWindow && hasHost && href && /^(https?:\/\/|mailto:|slack:\/\/)/i.test(href)) return 'system'
  return 'default'
}

export interface LinkActions {
  environment(): LinkEnvironment
  openFile(path: string): void
  openInApp(path: string, pdfInChrome?: boolean): void
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
    const decision = decideLink({ href, file, meta: event.metaKey }, actions.environment())
    if (decision === 'default') return
    event.preventDefault()
    if (decision === 'file') actions.openFile(file!)
    else if (decision === 'app' || decision === 'chrome') actions.openInApp(file!, decision === 'chrome')
    else actions.openAddress(href!)
  }
  page.addEventListener('click', onClick)
  return () => page.removeEventListener('click', onClick)
}
