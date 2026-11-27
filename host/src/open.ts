import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/**
 * Opening things in the Mac's own apps. The Mac window's web view opens no window for a link and the shell has
 * no opener, so the host does it: `open <address>` with execFile, never through a shell.
 */

/**
 * The kinds of address a link may open. Anything else, such as `file:` or `javascript:`, is refused. A `slack:` address
 * opens the Slack app. A Slack page on `https:` opens in the browser, which offers the app itself and still works on a
 * Mac without it.
 */
const OPENABLE = new Set(['http:', 'https:', 'mailto:', 'slack:'])

/** The address as a URL, or an error in plain words when it is not one a link may open. */
export function openableUrl(address: string): URL {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw Error('That is not a web or mail address.')
  }
  if (!OPENABLE.has(url.protocol)) throw Error('Only http, https, mailto and slack addresses open from here.')
  if (url.protocol !== 'mailto:' && !url.hostname) throw Error('That address has no host.')
  return url
}

type Run = typeof execFile

/** Opens a web, mail or Slack address in the system's default app for it. The test hands in `run`; nothing else does. */
export function openInSystem(address: string, run: Run = execFile, platform: NodeJS.Platform = process.platform): void {
  run(platform === 'darwin' ? 'open' : 'xdg-open', [openableUrl(address).href], () => {})
}

/** The caller has checked the real path with openablePath. Only a PDF may target Chrome. */
export async function openFileInSystem(path: string, pdfInChrome = false, run: Run = execFile, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (pdfInChrome && (platform !== 'darwin' || !/\.pdf$/i.test(path))) throw Error('Only a local PDF on the Mac opens in Chrome.')
  const args = pdfInChrome ? ['-n', '-b', 'com.google.Chrome', '--args', '--new-window', pathToFileURL(path).href] : [path]
  return new Promise((resolve, reject) => {
    run(platform === 'darwin' ? 'open' : 'xdg-open', args, (error) => error ? reject(error) : resolve())
  })
}
