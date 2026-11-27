// Demo shots only, never in the app's own build: scripts/demo/build.sh copies this folder into a build of the UI and
// imports this file first. It does what the Mac shell does for its window, and two things more for the shots:
//
// - It hands the page the demo host's address (`__HOBKIN_HOST__`), which the demo server reads from the demo home.
//   The page talks to that host only: any other socket throws.
// - It adds made-up agents at work on top of what the host sends (`agents.ts`), because a scripted host runs no
//   agent. Everything else on screen comes from the scripted host and the demo home as they are.
// - The address picks the shot: `theme=light|dark`, `spot=<JSON of a place>` (the window's own saved place), and
//   `agents=0` to leave the made-up agents out.
import { overlay } from './agents.ts'

const params = new URLSearchParams(location.search)

try {
  // The first-run setup opens over everything in a fresh browser. This home was set up by the seed.
  localStorage.setItem('hobkin-client-setup', 'seen')
  const theme = params.get('theme')
  if (theme === 'light' || theme === 'dark') {
    localStorage.setItem('hobkin-theme', theme)
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(theme)
  }
  const spot = params.get('spot')
  if (spot) sessionStorage.setItem('hobkin-client-location-1', spot)
  for (const [key, value] of new URLSearchParams(params.get('local') ?? '')) localStorage.setItem(key, value)
} catch {
  // Storage can be blocked. The page still draws, from its defaults.
}

interface Address {
  url: string
  token: string
}

let address: Address | null = null
const demoHost = async (): Promise<Address | null> => {
  try {
    const answer = await fetch('/demo/host.json', { cache: 'no-store' })
    address = answer.ok ? ((await answer.json()) as Address) : null
  } catch {
    address = null
  }
  return address
}
;(globalThis as { __HOBKIN_HOST__?: unknown }).__HOBKIN_HOST__ = demoHost

const Real = globalThis.WebSocket
const useOverlay = params.get('agents') !== '0'

/** The page's socket: the real one to the demo host, with the made-up agents' parts added and answered here. */
class DemoSocket {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly OPEN = 1
  private real: WebSocket

  constructor(url: string) {
    this.real = new Real(url)
    this.real.onopen = () => this.onopen?.()
    this.real.onclose = () => this.onclose?.()
    this.real.onerror = () => this.onerror?.()
    this.real.onmessage = ({ data }) => {
      const text = String(data)
      let out = [text]
      try {
        if (useOverlay) out = overlay.fromHost(text)
      } catch (error) {
        report('overlay', String((error as Error)?.stack ?? error))
      }
      for (const each of out) this.onmessage?.({ data: each })
    }
    if (useOverlay) overlay.attach((text) => this.onmessage?.({ data: text }))
  }

  get readyState(): number {
    return this.real.readyState
  }

  send(text: string): void {
    let forward: string | null = text
    try {
      if (useOverlay) forward = overlay.fromPage(text)
    } catch (error) {
      report('overlay', String((error as Error)?.stack ?? error))
    }
    if (forward !== null) this.real.send(forward)
  }

  close(): void {
    this.real.close()
  }
}

globalThis.WebSocket = function DemoWebSocket(url: string | URL) {
  const wanted = new URL(String(url))
  const allowed = address ? new URL(address.url) : null
  if (!allowed || wanted.host !== allowed.host || wanted.protocol !== 'ws:') throw new Error(`The demo page opens no socket but its host's (${wanted.host}).`)
  return new DemoSocket(String(url))
} as unknown as typeof WebSocket

// The page has no inspector open while it is captured: its errors go to the demo server's log.
function report(kind: string, text: string): void {
  void fetch('/demo/log', { method: 'POST', body: JSON.stringify({ kind, text: text.slice(0, 2000) }), keepalive: true }).catch(() => {})
}
addEventListener('error', (event) => report('error', `${event.message} ${event.filename}:${event.lineno}`))
addEventListener('unhandledrejection', (event) => report('rejection', String((event.reason as Error)?.stack ?? event.reason)))

// `click=<words>`: once the window is drawn, press the button that says them, as the user would, for a place the
// window's saved place cannot name.
const press = params.get('click')
if (press) {
  const tryPress = (left: number) => {
    const button = [...document.querySelectorAll('button, a, [role="tab"]')].find((element) => element.textContent?.trim() === press)
    if (button instanceof HTMLElement) button.click()
    else if (left > 0) setTimeout(() => tryPress(left - 1), 250)
  }
  setTimeout(() => tryPress(40), 1500)
}

// `scroll=<px>`: once the window is drawn, scroll the screen's own scroller that far down, as the user would.
const down = Number(params.get('scroll') ?? 0)
if (down > 0) {
  setTimeout(() => {
    const scrollers = [...document.querySelectorAll('*')].filter((element) => element.scrollHeight > element.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(element).overflowY))
    const biggest = scrollers.sort((left, right) => right.clientWidth * right.clientHeight - left.clientWidth * left.clientHeight)[0]
    if (biggest) biggest.scrollTop = down
  }, 2500)
}

// The capture script reads the page's size from what the page says it is.
const tellSize = () => void fetch('/demo/size', { method: 'POST', body: JSON.stringify({ width: innerWidth, height: innerHeight, scale: devicePixelRatio }) }).catch(() => {})
addEventListener('resize', tellSize)
tellSize()
setInterval(tellSize, 1000)
