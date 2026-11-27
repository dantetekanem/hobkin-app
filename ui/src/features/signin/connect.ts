import type { ModelsState, ProviderAccess } from '#shared/protocol/models.ts'

/** The three ways in, in the order "Connect a model" shows them. */
export type ConnectRoute = 'signIn' | 'apiKey' | 'cloud'

export interface ConnectSection {
  key: ConnectRoute
  title: string
  providers: ProviderAccess[]
}

const TITLES: Record<ConnectRoute, string> = {
  signIn: 'Sign in with a subscription',
  apiKey: 'Use an API key',
  cloud: 'Use cloud credentials',
}

const byName = (left: ProviderAccess, right: ProviderAccess) => left.name.localeCompare(right.name)
const connectedFirst = (left: ProviderAccess, right: ProviderAccess) => Number(right.connected) - Number(left.connected) || byName(left, right)
const subscriptionsFirst = (left: ProviderAccess, right: ProviderAccess) =>
  Number(right.signIn?.subscription === true) - Number(left.signIn?.subscription === true) || byName(left, right)

/** What a page holding the provider list has seen of Pi's reach: the providers connected, and whether a model answers. */
export interface Reach {
  connected: ReadonlySet<string>
  ready: boolean
}

/**
 * What changed since the last look: the providers that turned connected, and whether a model became usable. The first
 * look is where things stand, so nothing in it is news.
 */
export function reachSince(seen: Reach | null, models: ModelsState, ready: boolean): { connected: ProviderAccess[]; ready: boolean; seen: Reach } {
  const now = models.providers.filter((provider) => provider.connected)
  return {
    connected: seen ? now.filter(({ id }) => !seen.connected.has(id)) : [],
    ready: seen !== null && !seen.ready && ready,
    seen: { connected: new Set(now.map(({ id }) => id)), ready },
  }
}

/**
 * The providers grouped by how they connect: sign-ins first, the subscriptions among them leading, then API keys
 * with the ones already connected on top, then cloud credentials. A provider with two routes is in both lists.
 */
export function connectSections({ providers }: ModelsState): ConnectSection[] {
  const sections: ConnectSection[] = [
    { key: 'signIn', title: TITLES.signIn, providers: providers.filter((provider) => provider.signIn).toSorted(subscriptionsFirst) },
    { key: 'apiKey', title: TITLES.apiKey, providers: providers.filter((provider) => provider.apiKey).toSorted(connectedFirst) },
    { key: 'cloud', title: TITLES.cloud, providers: providers.filter((provider) => provider.cloud).toSorted(byName) },
  ]
  return sections.filter((section) => section.providers.length > 0)
}

/** The models slice as the host last sent it, or null before it sent one. */
type Seen = { models: ModelsState | null }

/**
 * The provider that just gave hobkin its first model Pi can use, so Connect a model was up for want of one: the first
 * newly connected provider, in Pi's order, that Pi lists a model for. Null for any other change, and for the first
 * slice the host sends, which is where things stand.
 */
export function connectedLater(before: Seen, now: Seen): string | null {
  if (!before.models || !now.models) return null
  if (before.models.models.length > 0 || now.models.models.length === 0) return null

  const wasConnected = new Set(before.models.providers.filter((provider) => provider.connected).map(({ id }) => id))
  const listed = new Set(now.models.models.map((model) => model.provider))
  const news = now.models.providers.find((provider) => provider.connected && !wasConnected.has(provider.id) && listed.has(provider.id))
  return news?.id ?? null
}
