/**
 * Integrations: the services hobkin can reach. An integration is an MCP server in Pi's configuration
 * (`mcpServers` in `~/.pi/agent/mcp.json`), and nothing else. These types describe the catalog of
 * services that can be added and the servers that are configured. They hold no React and no DOM,
 * so the host and the UI share them. See _specs/023-integrations.
 *
 * No type here has room for a secret. A key is only ever the name of an environment variable.
 */

/** How Pi talks to a server. Pi speaks stdio and streamable HTTP. It does not speak the older SSE transport. */
export type Transport = 'http' | 'stdio' | 'sse'

/** Sign-in settings of a remote server, as Pi reads them under `oauth`. */
export interface OAuthSettings {
  /** The id of a client registered with the service. Not a secret, and written as it is. */
  clientId?: string
  /** Always a reference such as `${NAME}`, never the secret itself. */
  clientSecret?: string
  /** Pi listens on http://127.0.0.1:<port>/callback. */
  callbackPort?: number
  /** Another callback address, sent exactly as written. HTTP on localhost, 127.0.0.1 or [::1]. */
  callbackUrl?: string
  clientName?: string
  scope?: string
  clientRegistration?: 'auto' | 'dcr' | 'cimd'
  authServerMetadataUrl?: string
}

/** What every entry under `mcpServers` may carry, whichever kind it is. */
interface EntryCommon {
  /** False keeps the entry without connecting to it. */
  enabled?: boolean
  /** What the server offers, in a sentence. Pi shows it to the model and ranks tools by it. */
  description?: string
  timeout?: number
}

/** A remote server, reached over streamable HTTP. */
export interface RemoteServerEntry extends EntryCommon {
  url: string
  command?: never
  headers?: Record<string, string>
  oauth?: OAuthSettings
}

/** A local server, started as a command and spoken to over stdio. */
export interface CommandServerEntry extends EntryCommon {
  command: string
  url?: never
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

/** One entry under `mcpServers`, exactly as it is written to the file. It has a `url` or a `command`, never both. */
export type PiServerEntry = RemoteServerEntry | CommandServerEntry

export type ServerKind = 'remote' | 'command'

/** Whether using a tool only looks, or can alter something. */
export type ToolEffect = 'reads' | 'changes'

/** How a catalog entry connects. */
export type ConnectKind =
  /** A remote address that signs in through the browser. */
  | 'oauth'
  /** A remote address that sends a header read from the environment. */
  | 'header'
  /** A local command, with the environment variables it needs. */
  | 'command'

/** An environment variable an entry refers to. Only its name is ever stored or shown. */
export interface EnvVar {
  name: string
  /** What the variable holds, in plain words. */
  holds: string
  /** Where a person gets the value. */
  where: string
}

/**
 * A value a person supplies that is not a secret and is written into the entry as it is:
 * the address of their own server, or the id of an app they registered. It stands in the
 * entry as `<key>` until it is filled.
 */
export interface Fill {
  key: string
  label: string
  /** A made-up value that shows the shape. Never a real one. */
  example: string
}

export interface Connect {
  kind: ConnectKind
  /** How the connection is made, in one line for the screen. */
  says: string
  /** The environment variables the entry reads. Empty when signing in is all it takes. */
  env: EnvVar[]
  /** The values a person fills in before the entry can be written. */
  fills: Fill[]
  /** What must be done at the service first, in order. Empty when there is nothing to prepare. */
  before: string[]
}

/** A tool the maker's own page names. The connected server reports the full list. */
export interface CatalogTool {
  name: string
  does: string
  effect: ToolEffect
}

/** One service in the catalog. Everything in it was read from the maker's documentation on the day in `checked`. */
export interface CatalogEntry {
  /** Stable id. It is also the name the server gets under `mcpServers`, so it follows Pi's rule for names. */
  id: string
  name: string
  /** What the service is for, in one line. */
  line: string
  /** What hobkin can read through it, in plain words. */
  reads: string[]
  /** What it can change. A server that changes nothing says so here. */
  changes: string[]
  /** Some of the tools the maker's page names, each marked as reading or changing. Not the full list. */
  tools: CatalogTool[]
  /** Who makes the server, and what they call it. */
  maker: string
  server: string
  /** False when the service's own company has no server and this one comes from someone else. */
  fromVendor: boolean
  transport: Transport
  connect: Connect
  /** The entry written under `mcpServers[id]`. A value in angle brackets, such as `<address>`, is one of `connect.fills`. */
  entry: PiServerEntry
  /** False when Pi cannot connect to it today. `blocked` then says what stands in the way. */
  usable: boolean
  blocked?: string
  /** What a person should know before connecting: a preview program, a limit, a way to keep it to reading. */
  notes: string[]
  /** Other addresses the maker documents for the same server, so an entry that uses one is still recognized. */
  alsoAt?: string[]
  /** Names people give this server when its address is their own and cannot identify it. */
  knownAs?: string[]
  /** The page of the maker's documentation the entry came from. */
  source: string
  /** Other pages of the maker that were read for this entry. */
  also: string[]
  /** The day the entry was read against its source, as YYYY-MM-DD. */
  checked: string
}

/**
 * What Pi says about a configured server.
 * A service that is in the catalog and not configured has no state: it is simply not connected.
 */
export type ServerState =
  /** Pi is connecting to it. */
  | 'connecting'
  /** The server refused the connection until someone signs in. */
  | 'sign-in'
  | 'connected'
  /** Kept in the file with `enabled: false`, and not used. */
  | 'off'
  /** It could not connect. `error` carries Pi's own message. */
  | 'failed'

/** A tool a connected server reports. */
export interface ServerTool {
  name: string
  does: string
  effect: ToolEffect
}

/**
 * One server in Pi's configuration, with what Pi reports for it. The entry is shown as it is written
 * in the file: references such as `${NAME}` stay references and are never resolved.
 */
export interface ConfiguredServer {
  /** The key under `mcpServers`. */
  name: string
  entry: PiServerEntry
  state: ServerState
  /** Empty until it has connected once. */
  tools: ServerTool[]
  /** Pi's message from the last failure, or null. */
  error: string | null
}

/** The configured servers, sorted into the three parts of the screen. */
export interface Split {
  /** Catalog services that are configured, in the catalog's order, each with its server. */
  connected: { entry: CatalogEntry; server: ConfiguredServer }[]
  /** Catalog services that are not configured yet, in the catalog's order. */
  available: CatalogEntry[]
  /** Configured servers the catalog does not know, in the order of the file. */
  own: ConfiguredServer[]
}
