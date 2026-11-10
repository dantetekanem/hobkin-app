import { buildEntry, fillProblems, withEnabled } from '#shared/integrations/entry.ts'
import { freeName } from '#shared/integrations/servers.ts'
import type { CatalogEntry, ConfiguredServer, ServerTool } from '#shared/integrations/types.ts'

export { fillProblems }

/**
 * What each action on the Integrations screen does to the list of configured servers, on sample data, for a window
 * with no host. With a host, the host does the same to Pi's configuration (023-integrations, S3 and S4) and the
 * screen shows what it reports. Each function returns a new list and leaves the one passed in alone.
 */

/** Where a connection lands once Pi has reached the server. */
export type Outcome = 'connected' | 'sign-in'

type Values = Readonly<Record<string, string>>

/**
 * Adds a catalog service, connecting, under a name no other server has, with what the person filled in
 * written into its entry. Null when Pi cannot use the service or a fill is missing or wrong.
 */
export function begin(servers: readonly ConfiguredServer[], entry: CatalogEntry, values: Values): { servers: ConfiguredServer[]; name: string } | null {
  const built = entry.usable ? buildEntry(entry, values) : null
  if (!built) return null
  const name = freeName(
    entry.id,
    servers.map((server) => server.name),
  )
  return { name, servers: [...servers, { name, entry: built, state: 'connecting', tools: [], error: null }] }
}

/** A service that signs in through the browser asks for it once Pi reaches it. One that reads a key from the environment is connected. */
export function outcomeOf(entry: CatalogEntry): Outcome {
  return entry.connect.kind === 'oauth' ? 'sign-in' : 'connected'
}

/** The tools the maker's page names, as a connected server reports them. */
export function toolsOf(entry: CatalogEntry | null): ServerTool[] {
  return (entry?.tools ?? []).map(({ name, does, effect }) => ({ name, does, effect }))
}

function change(servers: readonly ConfiguredServer[], name: string, when: (server: ConfiguredServer) => boolean, next: (server: ConfiguredServer) => ConfiguredServer): ConfiguredServer[] {
  const at = servers.findIndex((server) => server.name === name)
  if (at === -1 || !when(servers[at]!)) return [...servers]
  return servers.map((server, index) => (index === at ? next(server) : server))
}

/** A connection finishes. Only a server that is still connecting changes: one turned off or removed meanwhile stays as it is. */
export function settle(servers: readonly ConfiguredServer[], name: string, outcome: Outcome, tools: readonly ServerTool[]): ConfiguredServer[] {
  return change(
    servers,
    name,
    (server) => server.state === 'connecting',
    (server) => ({ ...server, state: outcome, tools: outcome === 'connected' ? [...tools] : [], error: null }),
  )
}

/** Sign-in starts, from a server waiting for it. */
export function signIn(servers: readonly ConfiguredServer[], name: string): ConfiguredServer[] {
  return change(servers, name, (server) => server.state === 'sign-in', (server) => ({ ...server, state: 'connecting' }))
}

/** A failed server is tried again. Its old message goes. */
export function retry(servers: readonly ConfiguredServer[], name: string): ConfiguredServer[] {
  return change(servers, name, (server) => server.state === 'failed', (server) => ({ ...server, state: 'connecting', error: null }))
}

/** Kept in the configuration with `enabled: false`, and not used. */
export function turnOff(servers: readonly ConfiguredServer[], name: string): ConfiguredServer[] {
  return change(servers, name, (server) => server.state !== 'off', (server) => ({ ...server, entry: withEnabled(server.entry, false), state: 'off', error: null }))
}

/** Back on: the entry reads as it did, and Pi connects to it again. */
export function turnOn(servers: readonly ConfiguredServer[], name: string): ConfiguredServer[] {
  return change(servers, name, (server) => server.state === 'off', (server) => ({ ...server, entry: withEnabled(server.entry, true), state: 'connecting' }))
}

/** The entry is deleted. A catalog service goes back to the catalog. */
export function remove(servers: readonly ConfiguredServer[], name: string): ConfiguredServer[] {
  return servers.filter((server) => server.name !== name)
}
