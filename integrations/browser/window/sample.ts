import type { BrowserState } from '../protocol.ts'

/** The browser's state before the host has looked, and on a host that does not run its part. */
export const BROWSER_UNKNOWN: BrowserState = {
  engine: { state: 'unknown', version: null, chrome: null, note: null },
  sessions: [],
}

const SECOND = 1000
const MINUTE = 60 * SECOND

/** Made-up state for a window with no host: the engine ready and two agents with a browser open. Times count back from `now`. */
export function sampleBrowser(now: number): BrowserState {
  return {
    engine: { state: 'ready', version: '0.45.0', chrome: '143.0.7499.40', note: null },
    sessions: [
      {
        agent: '#main',
        label: 'Main chat',
        url: 'http://localhost:5173/settings',
        title: 'Settings',
        since: now - 12 * MINUTE,
        lastAt: now - 40 * SECOND,
      },
      {
        agent: 'sample-1dd62269',
        label: 'hobkin 1dd62269',
        url: 'https://shop.invalid/checkout',
        title: 'Checkout',
        since: now - 31 * MINUTE,
        lastAt: now - 6 * MINUTE,
      },
    ],
  }
}
