import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHooks, syncBuiltinESMExports } from 'node:module'
import childProcess from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { after, test } from 'node:test'

const folder = mkdtempSync(join(tmpdir(), 'client-bridge-'))
for (const key of ['HOME', 'HOBKIN_HOME', 'PI_CODING_AGENT_DIR', 'TMPDIR']) process.env[key] = folder
process.env.PI_OFFLINE = '1'
after(() => rmSync(folder, { recursive: true, force: true }))
const refuse = () => { throw Error('Unexpected real process/network/SDK/resource operation') }
Object.assign(childProcess, Object.fromEntries(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].map(key => [key, refuse])))
net.connect = net.createConnection = refuse
net.Server.prototype.listen = refuse
http.request = http.get = https.request = https.get = refuse
process.kill = refuse
globalThis.fetch = refuse
syncBuiltinESMExports()
const captures: Record<string, unknown>[] = []
const sdkOptions: Record<string, unknown>[] = []
Object.assign(globalThis, { bridgeCaptures: captures, bridgeSdk: sdkOptions })
const fake = (source: string) => ({ format: 'module' as const, shortCircuit: true, source })
registerHooks({ load(url, context, next) {
  if (url.endsWith('/host/src/pi.ts')) return fake(`
    export const loadPiCodingAgent = () => { globalThis.bridgeSdk.push({ operation: 'SDK loader' }); throw Error('parent SDK startup'); };
    export const loadPiAi = () => { throw Error('real model') };
    export const loadPiModelPick = loadPiCodingAgent;`)
  if (url.endsWith('/hobkin/src/cli/pi-session.mjs')) return fake(`export async function openPiSession(options, deps) {
    globalThis.bridgeCaptures.push(deps);
    return { subscribe() {} }; }`)
  if (/pi-coding-agent|resource-loader|model-runtime/.test(url)) throw Error(`Real SDK import: ${url}`)
  return next(url, context)
} })
const { createClientTool } = await import('../src/client-tool.ts')
const { HomeOwner } = await import('../src/owner.ts')

test('main owner captures the actual client for configured and isolated Pi without parent SDK startup', { timeout: 2000 }, async () => {
  const tool = createClientTool({ run: async () => ({ ok: true, value: 'host' }) })
  const owner = new HomeOwner({ root: folder, live: true, real: false, tools: [tool], modelRuntime: async () => refuse(), onChange() {}, onSessionEvent() {} })
  const options = await (owner as unknown as { model(): Promise<{ createMain(options: unknown): Promise<unknown> }> }).model()
  await options.createMain({ config: { launcher: { command: 'never-executed' } } })
  const bridge = captures[0]?.clientBridge as { tool: unknown; extensionPath: string } | undefined
  assert.equal(bridge?.tool, tool, 'configured main must receive the captured host callback')
  assert.equal(bridge?.extensionPath, new URL('../src/client-bridge-extension.ts', import.meta.url).pathname)
  await options.createMain({ config: {} })
  assert.deepEqual(captures.map(deps => [deps.isolatedMain, deps.recoverScriptedHistory, deps.clientBridge]), [[true, true, bridge], [true, true, bridge]])
  assert.deepEqual(sdkOptions, [])
})

test('fixed client proxy forwards IDs, results, errors and cancellation through the existing bridge', { timeout: 2000 }, async () => {
  const { default: extension } = await import('../src/client-bridge-extension.ts')
  const { serveBridge } = await import('hobkin/src/cli/bridge.mjs')
  const { runCommand } = await import('../src/commands.ts')
  let registered: Parameters<Parameters<typeof extension>[0]['registerTool']>[0] | undefined
  let started: Parameters<Parameters<typeof extension>[0]['on']>[1] | undefined
  let active = ['read']
  const statuses: unknown[] = []
  extension({ registerTool: tool => { registered = tool }, on: (_name, handler) => { started = handler }, getActiveTools: () => active, setActiveTools: names => { active = names } })
  assert.ok(registered)
  const closed = { open: false, url: null, title: null }
  const local = createClientTool({ run: (name, args) => runCommand({ 'canvas.close': () => closed }, name, args) })
  assert.deepEqual(registered.parameters, local.parameters)
  const signal = new AbortController().signal
  const calls: unknown[] = []
  const hostTool = { ...local, execute: async (id: string, params: Parameters<typeof local.execute>[1], received?: AbortSignal) => {
    calls.push({ id, params, signal: received }); return local.execute(id, params)
  } }
  const ctx = { mode: 'rpc', ui: {
    setStatus: (key: string, value: string) => statuses.push([key, JSON.parse(value)]),
    input: async (_title: string, request: string, options: { signal?: AbortSignal }) => JSON.stringify(await serveBridge(request, { tools: { client: hostTool } }, options.signal)),
  } }
  started?.({}, ctx)
  assert.deepEqual(active, ['read', 'client'])
  assert.deepEqual(statuses, [['hobkin/bridge/client', { version: 1, tools: ['client'] }]])
  const execute = (params: Parameters<typeof local.execute>[1]) => registered!.execute('call-1', params, signal, undefined, ctx)
  const listed = await execute({ action: 'list' })
  assert.ok((listed.details as { name: string }[]).some(row => row.name === 'canvas.close'))
  assert.deepEqual((await execute({ action: 'describe', name: 'canvas.close' })).details, (await local.execute('x', { action: 'describe', name: 'canvas.close' })).details)
  assert.deepEqual((await execute({ action: 'run', name: 'canvas.close' })).details, closed)
  await assert.rejects(execute({ action: 'run', name: 'execution.stop' }), /cannot run/)
  await assert.rejects(execute({ action: 'describe', name: 'execution.stop' }), /cannot run/)
  await assert.rejects(execute({ action: 'run', name: 'canvas.close', args: { extra: true } }), /argument|unexpected|unknown|additional/i)
  await assert.rejects(execute({ action: 'run', name: 'canvas.close', extra: true } as never), /Invalid client tool arguments/)
  assert.deepEqual(calls[0], { id: 'call-1', params: { action: 'list' }, signal })
  await assert.rejects(registered.execute('x', { action: 'list' }, signal, undefined, { ...ctx, mode: 'tui' }), /only under/)
  const controller = new AbortController()
  const waiting = registered.execute('cancel', { action: 'list' }, controller.signal, undefined, { ...ctx, ui: { ...ctx.ui, input: async (_title, _request, options) => new Promise(resolve => options.signal?.addEventListener('abort', () => resolve(undefined), { once: true })) } })
  controller.abort()
  await assert.rejects(waiting, /Cancelled/)
  active = ['read']
  extension({ registerTool() {}, on: (_name, handler) => { started = handler }, getActiveTools: () => active, setActiveTools() {} })
  started?.({}, ctx)
  assert.deepEqual(statuses.at(-1), ['hobkin/bridge/client', { version: 1, tools: [] }])
})
