import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { IntegrationManifest } from '#shared/integration/manifest.ts'
import type { PullRequest } from '#shared/protocol/pulls.ts'
import type { SpotlightTarget } from '../app/spotlight-entries.ts'
import type { HomeContribution } from '../features/home/types.ts'

/**
 * What an integration's window part gives the window (_specs/064-integration-drops). The folder's `window.tsx`
 * default-exports a `WindowPart`. The window finds it when it starts and never imports anything else of the folder.
 * Everything an integration shows goes through this shape.
 */

/** One of the manifest's screens, drawn. */
export interface ScreenPart {
  /** The manifest screen's id. */
  id: string
  icon: LucideIcon
  component: ComponentType
}

export interface WindowPart<State = unknown> {
  manifest: IntegrationManifest
  /** Its slice before the host has said anything about it. */
  unknown: State
  /** Made-up state for a window with no host. Times count back from `now`. */
  sample(now: number): State
  /** One for each screen of its manifest. */
  screens?: readonly ScreenPart[]
  /** Its card on the Integrations screen, above the MCP servers. */
  card?: ComponentType<{ still: boolean }>
  /** Its mark in the app's palette: up to two letters and a hue. */
  mark?: { symbol: string; hue: number }
  /** The pull requests this state holds, for Work's rows and the trail's titles. */
  pulls?(state: State): readonly PullRequest[]
  /** What it adds to Home, read from its state: needs, cards, its tile among the connections. `now` is the clock Home draws by. */
  home?(state: State, now: number): HomeContribution
  /** What the spotlight finds of it: its pull requests and issues, each saying where Enter goes. */
  spotlight?(state: State): readonly SpotlightTarget[]
}
