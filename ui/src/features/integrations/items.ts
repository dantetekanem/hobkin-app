import type { CatalogEntry, ConfiguredServer, Split } from '#shared/integrations/types.ts'
import type { GitHubConnection } from '#shared/protocol/github.ts'

/** How gh stands. GitHub connects through gh, with the login gh already has (024-github). */
export interface GhLink {
  connection: GitHubConnection
  login: string | null
}

/**
 * What the screen draws: one item per tile, in the three parts. An item's key stays the same while it moves
 * between the catalog and the connected part, so its tile can travel from one to the other.
 */
export type Item =
  /** `gh`: GitHub's item only, which follows gh. */
  | { kind: 'service'; key: string; entry: CatalogEntry; server: ConfiguredServer | null; gh?: GhLink }
  | { kind: 'own'; key: string; server: ConfiguredServer }

export interface Items {
  connected: Item[]
  available: Item[]
  own: Item[]
}

/** Keys of the person's own servers carry a mark of their own, so a server called `linear` is never taken for the catalog's Linear. */
export const OWN = 'own~'

export function itemsOf(split: Split): Items {
  const seen = new Set<string>()
  return {
    connected: split.connected.map(({ entry, server }) => {
      // The first server of a service has the service's own key, the one its catalog tile had. Another one for the same service gets its name added.
      const key = seen.has(entry.id) ? `${entry.id}~${server.name}` : entry.id
      seen.add(entry.id)
      return { kind: 'service', key, entry, server }
    }),
    available: split.available.map((entry) => ({ kind: 'service', key: entry.id, entry, server: null })),
    own: split.own.map((server) => ({ kind: 'own', key: `${OWN}${server.name}`, server })),
  }
}

export function allItems(items: Items): Item[] {
  return [...items.connected, ...items.available, ...items.own]
}
