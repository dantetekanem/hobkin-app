/**
 * Integrations: the services hobkin can reach, of two kinds. A full integration connects its own way and has a
 * page of its own in the app (064-integration-drops). Every other one is an MCP server in Pi's
 * configuration (`mcpServers` in `~/.pi/agent/mcp.json`). These types describe the MCP kind: the servers that are
 * configured. They hold no React and no DOM, so the host and the UI share them. See _specs/023-integrations.
 *
 * No type here has room for a secret. A key is only ever the name of an environment variable.
 */

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

/**
 * What Pi says about a configured server.
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
