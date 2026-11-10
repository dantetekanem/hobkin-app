import { CATALOG } from '#shared/integrations/catalog.ts'
import type { GhLink, Item, Items } from './items.ts'

/** GitHub's id in the catalog. */
export const GITHUB = 'github'

const isGitHub = (item: Item) => item.kind === 'service' && item.entry.id === GITHUB
const placeOf = (item: Item) => (item.kind === 'service' ? CATALOG.findIndex((entry) => entry.id === item.entry.id) : CATALOG.length)

/**
 * GitHub connects through gh (024-github), so its tile follows gh. It carries how gh stands, and it sits with the
 * connected services while gh is signed in, whether GitHub's MCP server is configured too or not. Its key stays
 * the same, so its tile travels between the parts.
 */
export function withGh(items: Items, gh: GhLink): Items {
  const tag = (item: Item): Item => (item.kind === 'service' && isGitHub(item) ? { ...item, gh } : item)
  const connected = items.connected.map(tag)
  const available = items.available.map(tag)
  const waiting = available.find(isGitHub)
  if (gh.connection !== 'connected' || !waiting) return { ...items, connected, available }
  return {
    ...items,
    // The connected part keeps the catalog's order.
    connected: [...connected, waiting].sort((a, b) => placeOf(a) - placeOf(b)),
    available: available.filter((item) => item !== waiting),
  }
}

/** How gh stands, in a few words, for GitHub's tile and detail. */
export function ghLine({ connection, login }: GhLink): string {
  switch (connection) {
    case 'connected':
      return `Connected through gh as @${login ?? 'unknown'}`
    case 'signed-out':
      return 'gh is not signed in'
    case 'missing':
      return 'gh is not installed'
    case 'unknown':
      return 'Looking at gh'
  }
}
