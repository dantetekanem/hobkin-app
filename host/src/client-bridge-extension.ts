import { BRIDGE, callBridge, type BridgeContext } from 'hobkin/src/cli/bridge.mjs'
import { createClientTool } from './client-tool.ts'

type Client = ReturnType<typeof createClientTool>
interface ClientBridgeAPI {
  registerTool(tool: Omit<Client, 'execute'> & { execute(id: string, params: Parameters<Client['execute']>[1], signal: AbortSignal | undefined, update: unknown, ctx: BridgeContext): ReturnType<Client['execute']> }): void
  on(event: 'session_start', handler: (event: unknown, ctx: BridgeContext) => void): void
  getActiveTools(): string[]
  setActiveTools(names: string[]): void
}

/** Only trusted main-session construction loads this fixed proxy. Command authority stays in the host. */
export default function clientBridge(pi: ClientBridgeAPI) {
  const tool = createClientTool({ run: async () => { throw Error('Client commands run in the host.') } })
  pi.registerTool({ ...tool, execute: (id, params, signal, _update, ctx) => callBridge(ctx, { op: 'tool', name: tool.name, id, params }, signal) })
  pi.on('session_start', (_event, ctx) => {
    if (!pi.getActiveTools().includes(tool.name)) pi.setActiveTools([...pi.getActiveTools(), tool.name])
    ctx.ui.setStatus(`${BRIDGE}/client`, JSON.stringify({ version: 1, tools: pi.getActiveTools().filter(name => name === tool.name) }))
  })
}
