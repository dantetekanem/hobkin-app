/**
 * The places an agent's browser must never be on: hobkin's own window, and the engine's dashboard. A page there is
 * handed what lets it act as the user's window, so a browser that an agent steers, and that a hostile page may be
 * steering in turn, is kept off it. A place is a host and a port, such as `127.0.0.1:5187`.
 */

/**
 * - 5187 is where hobkin's window is served in development (`devUrl` in `src-tauri/tauri.conf.json`), and that page is
 *   given the host's token.
 * - 4848 is agent-browser's dashboard, which takes commands from this computer without a token.
 */
export const HOBKIN_WINDOW_PLACES: readonly string[] = [
  '127.0.0.1:5187',
  'localhost:5187',
  '[::1]:5187',
  '127.0.0.1:4848',
  'localhost:4848',
  '[::1]:4848',
]

export const OWN_WINDOW_REFUSAL = "That address is hobkin's own window; an agent's browser does not open it."

/** Every spelling of this computer in an address is the same place. */
const THIS_COMPUTER = 'this-computer'
/** The spellings of this computer a request can be blocked by, since a block is made of the address as written. */
const SPELLINGS_OF_THIS_COMPUTER = ['127.0.0.1', 'localhost', '[::1]', '0.0.0.0']

const DEFAULT_PORTS: Readonly<Record<string, string>> = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443' }

/**
 * The names this computer goes by in an address, as a pattern. It is kept as text because the same rule is also
 * checked inside the page (`placeGuard`), where only text can be sent.
 */
const THIS_COMPUTER_NAMES = String.raw`^(localhost|.*\.localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|\[::\]|\[::ffff:7f00:1\])$`

const isThisComputer = (hostname: string): boolean => new RegExp(THIS_COMPUTER_NAMES).test(hostname)

const hostOf = (hostname: string): string => {
  const name = hostname.toLowerCase().replace(/\.$/, '')
  return isThisComputer(name) ? THIS_COMPUTER : name
}

/** A place as written in a list, with its host named one way. */
function placeNamed(place: string): string {
  const at = place.lastIndexOf(':')
  return `${hostOf(place.slice(0, at))}:${place.slice(at + 1)}`
}

/** The place an address is on, or null when it is not a web address. */
function placeOf(address: string): string | null {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return null
  }

  const port = url.port || DEFAULT_PORTS[url.protocol]
  if (!port) return null
  return `${hostOf(url.hostname)}:${port}`
}

/** Whether an address is on one of the places, however this computer is spelled in it. */
export function isRefusedPlace(address: string | null, places: readonly string[]): boolean {
  if (!address || !places.length) return false

  const place = placeOf(address)
  return place !== null && places.some((refused) => placeNamed(refused) === place)
}

/** How a page command's guard fails when the browser is on one of the places. */
export const REFUSED_PLACE_MARK = 'hobkin-refused-place'

/**
 * JavaScript that throws when the page it runs in is on one of the places, or null when there are none. The engine
 * runs it in the same batch as a page command, right before it, so the command is not run on a place the browser
 * was taken to since anyone last looked.
 */
export function placeGuard(places: readonly string[]): string | null {
  if (!places.length) return null

  const refused = [...new Set(places.map(placeNamed))]
  return `(() => {
  const name = location.hostname.toLowerCase().replace(/\\.$/, '');
  const host = new RegExp(${JSON.stringify(THIS_COMPUTER_NAMES)}).test(name) ? ${JSON.stringify(THIS_COMPUTER)} : name;
  const port = location.port || ${JSON.stringify(DEFAULT_PORTS)}[location.protocol] || '';
  if (${JSON.stringify(refused)}.includes(host + ':' + port)) throw new Error(${JSON.stringify(REFUSED_PLACE_MARK)});
  return true;
})()`
}

/** The request patterns that block the places in a browser, for the engine's `network route`. */
export function blockPatterns(places: readonly string[]): string[] {
  const patterns = new Set<string>()
  for (const place of places) {
    const at = place.lastIndexOf(':')
    const host = place.slice(0, at)
    const port = place.slice(at + 1)

    const spellings = hostOf(host) === THIS_COMPUTER ? SPELLINGS_OF_THIS_COMPUTER : [host]
    for (const spelling of spellings) patterns.add(`**://${spelling}:${port}/**`)
  }
  return [...patterns]
}
