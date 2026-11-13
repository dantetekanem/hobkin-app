import { CATALOG } from './catalog.ts'
import { entryKind, isCommandEntry, openFills } from './entry.ts'
import type { CatalogEntry, ConfiguredServer, PiServerEntry, ServerKind, Split, ToolEffect } from './types.ts'

/**
 * The rules for configured servers: what Pi accepts as a name, which catalog service a server is,
 * and how the configured servers split into the parts of the screen. No React, no DOM, no file access.
 */

/** Pi's rule: a server name may contain only letters, digits, `_` and `-`. */
export function isServerName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name)
}

/** Pi counts names that differ only in `-` and `_` as the same server, and refuses the second one. */
export function sameServer(a: string, b: string): boolean {
  return a.replaceAll('-', '_') === b.replaceAll('-', '_')
}

/** A name for a new server that none of the configured ones already has: the wanted name, or that name with a number. */
export function freeName(wanted: string, taken: readonly string[]): string {
  const free = (name: string) => !taken.some((other) => sameServer(other, name))
  if (free(wanted)) return wanted
  for (let number = 2; ; number++) {
    const name = `${wanted}-${number}`
    if (free(name)) return name
  }
}

/** What to show for where a server lives: the address of a remote one, the command line of a local one. */
export function targetOf(entry: PiServerEntry): { kind: ServerKind; text: string } {
  if (isCommandEntry(entry)) return { kind: 'command', text: [entry.command, ...(entry.args ?? [])].join(' ') }
  return { kind: 'remote', text: entry.url }
}

/**
 * Whether a tool reads or changes, from the hints its server declares (MCP tool annotations).
 * A tool counts as changing unless its server says it only reads, because a wrong "reads" is the costly mistake.
 */
export function toolEffect(hints: { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined): ToolEffect {
  return hints?.readOnlyHint === true && hints.destructiveHint !== true ? 'reads' : 'changes'
}

interface Address {
  origin: string
  /** The path without a slash at the end. An address with no path has an empty one. */
  path: string
}

function addressOf(text: string): Address | null {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return { origin: url.origin.toLowerCase(), path: url.pathname.replace(/\/+$/, '') }
}

/** True when `path` is `under` itself or something below it: `/mcp/acme` is under `/mcp`, and `/mcpx` is not. */
function isUnder(path: string, under: string): boolean {
  return path === under || path.startsWith(`${under}/`)
}

/** A name with case, `-` and `_` taken out, for comparing what people call a server. */
function plain(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, '')
}

function matches(server: Pick<ConfiguredServer, 'name' | 'entry'>, entry: CatalogEntry): boolean {
  const known = entry.entry
  const given = server.entry
  if (entryKind(given) !== entryKind(known)) return false

  if (isCommandEntry(known)) {
    return isCommandEntry(given) && given.command === known.command && JSON.stringify(given.args ?? []) === JSON.stringify(known.args ?? [])
  }
  if (isCommandEntry(given)) return false

  const at = addressOf(given.url)
  if (!at) return false

  // The address is the person's own (a fill stands where the host would be), so it cannot identify the server.
  // The path the maker documents and the name people give it must both agree.
  if (openFills({ url: known.url }).length > 0) {
    const path = known.url.replace(/^<[^>]+>/, '').replace(/\/+$/, '')
    const names = [entry.id, ...(entry.knownAs ?? [])].map(plain)
    return isUnder(at.path, path) && names.includes(plain(server.name))
  }

  return [known.url, ...(entry.alsoAt ?? [])].some((text) => {
    const documented = addressOf(text)
    return documented !== null && documented.origin === at.origin && isUnder(at.path, documented.path)
  })
}

/**
 * The catalog service a configured server is, or null when it is the person's own.
 * A server is matched by where it connects, never by its name alone: a local command called `linear`
 * is not Linear's server, and what the catalog says about that one would be false for it.
 */
export function catalogMatch(server: Pick<ConfiguredServer, 'name' | 'entry'>, catalog: readonly CatalogEntry[] = CATALOG): CatalogEntry | null {
  return catalog.find((entry) => matches(server, entry)) ?? null
}

/** Sorts the configured servers into the parts of the screen: connected, can be added, and the person's own. */
export function splitServers(servers: readonly ConfiguredServer[], catalog: readonly CatalogEntry[] = CATALOG): Split {
  const matched = servers.map((server) => ({ server, entry: catalogMatch(server, catalog) }))
  return {
    connected: catalog.flatMap((entry) => matched.filter((match) => match.entry === entry).map(({ server }) => ({ entry, server }))),
    available: catalog.filter((entry) => !matched.some((match) => match.entry === entry)),
    own: matched.filter((match) => match.entry === null).map(({ server }) => server),
  }
}
