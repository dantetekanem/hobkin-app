import { join } from 'node:path'
import type { PiServerEntry } from '#shared/integrations/types.ts'
import { piAgentDirFor, type McpSource, type PiMcpCheck, type PiMcpTool } from './integrations.ts'
import { loadPiCodingAgent, piCodingAgentFile } from './pi.ts'

/**
 * Integrations over Pi's own MCP code: the configuration as `loadMcpConfig` reads it, and each server as
 * `McpServerConnection` connects to it, the way `pi mcp list` does (Pi's `extensions/mcp/cli.js`). Writes go
 * through `updateMcpServerConfig`, `addMcpServerConfig` and `removeMcpServerConfig`, which keep everything else in
 * the file as it was. Pi does not export these by name, so they are imported by their files next to Pi's entry.
 */

/** The configuration as Pi reads it. Only what the host uses. */
interface PiMcpConfigModule {
  loadMcpConfig(options: { agentDir: string; cwd: string; projectTrusted: boolean }): {
    servers: { name: string; config: PiServerEntry; scope?: 'global' | 'project' | 'extension' }[]
    errors: string[]
  }
  updateMcpServerConfig(path: string, name: string, patch: { enabled?: boolean }): void
  addMcpServerConfig(path: string, name: string, config: PiServerEntry): boolean
  removeMcpServerConfig(path: string, name: string): boolean
}

interface PiMcpConnection {
  state: PiMcpCheck['state']
  error?: string
  tools: PiMcpTool[]
  getClient(): Promise<unknown>
  close(): Promise<void>
}

interface PiMcpRuntimeModule {
  McpServerConnection: new (options: {
    entry: { name: string; config: PiServerEntry; source: string; scope: 'global' }
    cwd: string
    createTransport: unknown
    credentials: unknown
    onTools: () => void
    onChange: (connection: PiMcpConnection) => void
  }) => PiMcpConnection
  createDefaultTransport: unknown
  McpOAuthCredentialStore: new (backend: unknown, lockDir: string) => unknown
}

interface PiAuthStorageModule {
  FileAuthStorageBackend: new (path: string) => unknown
}

interface PiMcpServersModule {
  validateMcpServerConfig(name: string, raw: unknown): PiServerEntry | string
}

function snapshot(connection: PiMcpConnection): PiMcpCheck {
  return {
    state: connection.state,
    tools: connection.tools.map(({ name, description, annotations }) => ({ name, description, annotations })),
    error: connection.state === 'connected' ? null : (connection.error ?? null),
  }
}

/**
 * Pi's MCP configuration in `agentDir`, and its connections. Only the user-level file is read: servers of one project
 * are out of scope (023-integrations). `cwd` is where a local server starts, as for `pi mcp list`.
 */
export async function piMcpSource({ agentDir, cwd }: { agentDir: string; cwd: string }): Promise<McpSource> {
  const [config, runtime, storage, servers] = (await Promise.all([
    import(piCodingAgentFile('./extensions/mcp/config.js')),
    import(piCodingAgentFile('./extensions/mcp/runtime.js')),
    import(piCodingAgentFile('./core/auth-storage.js')),
    import(piCodingAgentFile('./core/mcp-servers.js')),
  ])) as [PiMcpConfigModule, PiMcpRuntimeModule, PiAuthStorageModule, PiMcpServersModule]

  const path = join(agentDir, 'mcp.json')
  // Pi keeps sign-ins in mcp-auth.json beside the configuration. Named here, so a folder other than Pi's own is used whole.
  const credentials = new runtime.McpOAuthCredentialStore(new storage.FileAuthStorageBackend(join(agentDir, 'mcp-auth.json')), agentDir)

  return {
    path,
    load: () => {
      const loaded = config.loadMcpConfig({ agentDir, cwd, projectTrusted: false })
      return {
        servers: loaded.servers.filter(({ scope }) => (scope ?? 'global') === 'global').map(({ name, config: entry }) => ({ name, config: entry })),
        problems: loaded.errors,
      }
    },
    check: async (server, progress, signal) => {
      let done = false
      const connection = new runtime.McpServerConnection({
        entry: { name: server.name, config: server.config, source: path, scope: 'global' },
        cwd,
        createTransport: runtime.createDefaultTransport,
        credentials,
        onTools: () => {},
        // Closing says "closed", which is not where the server got to, so nothing is passed on once the check is done.
        onChange: (changed) => {
          if (!done) progress(snapshot(changed))
        },
      })
      const stop = () => void connection.close()
      signal.addEventListener('abort', stop, { once: true })
      try {
        await connection.getClient()
      } catch {
        // The connection keeps its state and Pi's message.
      }
      const found = snapshot(connection)
      done = true
      signal.removeEventListener('abort', stop)
      await connection.close()
      return found
    },
    setEnabled: (name, on) => config.updateMcpServerConfig(path, name, { enabled: on }),
    add: (name, entry) => {
      const valid = servers.validateMcpServerConfig(name, entry)
      if (typeof valid === 'string') throw Error(valid)
      config.addMcpServerConfig(path, name, valid)
    },
    remove: (name) => config.removeMcpServerConfig(path, name),
  }
}

/**
 * The source a host uses unless it is handed one: Pi's own configuration for a live host, and for a scripted one the
 * folder in PI_CODING_AGENT_DIR or its own agent folder in the home (`piAgentDirFor`).
 */
export async function piMcpSourceFor({ live, root }: { live: boolean; root: string }): Promise<McpSource> {
  const pi = await loadPiCodingAgent()
  const agentDir = piAgentDirFor({ live, root, env: process.env, piAgentDir: () => pi.getAgentDir() })
  return piMcpSource({ agentDir, cwd: process.cwd() })
}
