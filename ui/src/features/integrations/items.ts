import type { ConfiguredServer } from '#shared/integrations/types.ts'

/**
 * What the screen draws of the MCP servers: one item per tile, in the order of Pi's file. A full integration is not
 * one of them: its window part draws a card of its own.
 */
export interface Item {
  /** The server's name: it is the one thing that stays the same while the server changes state. */
  key: string
  server: ConfiguredServer
}

export function itemsOf(servers: readonly ConfiguredServer[]): Item[] {
  return servers.map((server) => ({ key: server.name, server }))
}
