import { execFile } from 'node:child_process'

/**
 * Opening things in the Mac's own apps. The Mac window's web view opens no window for a link and the shell has
 * no opener, so the host does it: `open <address>` with execFile, never through a shell.
 */

/** The kinds of address a link may open. Anything else, such as `file:` or `javascript:`, is refused. */
const OPENABLE = new Set(['http:', 'https:', 'mailto:'])

/** The address as a URL, or an error in plain words when it is not one a link may open. */
export function openableUrl(address: string): URL {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw Error('That is not a web or mail address.')
  }
  if (!OPENABLE.has(url.protocol)) throw Error('Only http, https and mailto addresses open from here.')
  if (url.protocol !== 'mailto:' && !url.hostname) throw Error('That address has no host.')
  return url
}

type Run = typeof execFile

/** Opens a web or mail address in the system's default app for it. The test hands in `run`; nothing else does. */
export function openInSystem(address: string, run: Run = execFile, platform: NodeJS.Platform = process.platform): void {
  run(platform === 'darwin' ? 'open' : 'xdg-open', [openableUrl(address).href], () => {})
}

/** Opens a file in the system's default app for it. The caller has already checked the path (`openablePath`). */
export function openFileInSystem(path: string, run: Run = execFile, platform: NodeJS.Platform = process.platform): void {
  run(platform === 'darwin' ? 'open' : 'xdg-open', [path], () => {})
}
