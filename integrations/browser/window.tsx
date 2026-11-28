import type { BrowserState } from './protocol.ts'
import type { WindowPart } from '@/integration/contract.ts'
import manifest from './integration.ts'
import { CanvasNavigation } from './window/CanvasNavigation.tsx'
import { BrowserCard } from './window/BrowserCard.tsx'
import { browserHome } from './window/home.ts'
import { BROWSER_UNKNOWN, sampleBrowser } from './window/sample.ts'

/** The browser's part of the window: its card on Integrations, where the user installs it, its mark, and what it adds to Home. It has no page of its own. */
const part: WindowPart<BrowserState> = {
  manifest,
  unknown: BROWSER_UNKNOWN,
  sample: (now) => sampleBrowser(now),
  card: BrowserCard,
  canvasNavigation: CanvasNavigation,
  mark: { symbol: 'Br', hue: 248 },
  home: browserHome,
}

export default part
