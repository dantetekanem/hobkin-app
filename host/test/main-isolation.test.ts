import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { registerHooks, syncBuiltinESMExports } from 'node:module'
import childProcess from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { test } from 'node:test'
import type { MainSession, MainSessionOptions, MainStartup, OpenOptions, HobkinApplication } from 'hobkin/src/cli/application.mjs'
import type { Binding } from 'hobkin/src/cli/settings.mjs'

const refuse = () => { throw Error('Unexpected real SDK/resource/session/provider/process/network operation') }
Object.assign(childProcess, Object.fromEntries(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].map(key => [key, refuse])))
net.connect = net.createConnection = net.Socket.prototype.connect = net.Server.prototype.listen = refuse
http.request = http.get = https.request = https.get = refuse
process.kill = globalThis.fetch = refuse
syncBuiltinESMExports()
const fixture = { open: async (_root: string, _options: OpenOptions): Promise<HobkinApplication> => refuse(),
  pi: refuse as () => unknown, ai: refuse as () => unknown,
  openPiSession: refuse as (...args: unknown[]) => unknown, openConversation: refuse as (...args: unknown[]) => unknown,
  runChild: refuse as (...args: unknown[]) => unknown,
  settings: async (_options: {
    modelRuntime?: unknown
    applyCurrent?: (choice: { model?: unknown; effort?: string }) => Promise<Binding>
  }): Promise<unknown> => refuse(),
}
Object.assign(globalThis, { isolationFixture: fixture })
const fake = (source: string) => ({ format: 'module' as const, shortCircuit: true, source })
registerHooks({ load(url, context, next) {
  if (url.endsWith('/host/src/pi.ts')) return fake('export const loadPiCodingAgent = () => globalThis.isolationFixture.pi(); export const loadPiAi = () => globalThis.isolationFixture.ai(); export const loadPiModelPick = () => { throw Error("Model picker") };')
  if (url.endsWith('/hobkin/src/cli/pi-session.mjs')) return fake('export const openPiSession = (...args) => globalThis.isolationFixture.openPiSession(...args); export const openConversation = (...args) => globalThis.isolationFixture.openConversation(...args);')
  if (url.endsWith('/hobkin/src/cli/main-session-child.mjs')) return fake('export const runMainSessionChild = (...args) => globalThis.isolationFixture.runChild(...args);')
  if (url.endsWith('/hobkin/src/cli/application.mjs')) return fake('export class HobkinApplication { static open(...args) { return globalThis.isolationFixture.open(...args) } }')
  if (url.endsWith('/hobkin/src/cli/paste-image.mjs')) return fake('export const IMAGE_ONLY_TEXT = "image", MAX_IMAGES = 4, MAX_PASTE_BYTES = 100;')
  if (url.endsWith('/hobkin/src/cli/decisions.mjs')) return fake('export const openDecisions = () => [];')
  if (url.endsWith('/hobkin/src/cli/settings.mjs')) return fake('export const updateSettings = (_root, _request, options) => globalThis.isolationFixture.settings(options);')
  if (/pi-coding-agent|resource-loader|model-runtime|pi-session|rpc-process/.test(url)) throw Error(`Forbidden real import: ${url}`)
  return next(url, context)
} })
const { HomeOwner } = await import('../src/owner.ts')
const { runCommand } = await import('../src/commands.ts')
const { createClientTool } = await import('../src/client-tool.ts')
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function owner(live = true) {
  const changes: ReturnType<InstanceType<typeof HomeOwner>['wireState']>[] = []
  const value = new HomeOwner({ root: process.env.HOBKIN_HOME!, live, real: false, tools: [createClientTool({ run: async () => refuse() })], onChange() { changes.push(value.wireState()) }, onSessionEvent() {} })
  const seam = value as unknown as { open(): Promise<void>; prepareHome(): Promise<void>; model(): Promise<OpenOptions>; tapped(create: NonNullable<OpenOptions['createMain']>): NonNullable<OpenOptions['createMain']> }
  seam.prepareHome = async () => {}
  if (live) seam.model = async () => ({})
  changes.push(value.wireState())
  return { value, changes, seam, open: () => seam.open() }
}
function startup() {
  const controller = new AbortController(), settled = deferred(), closed = deferred<unknown>()
  let signals = 0, exited = false
  const child = { closed: closed.promise, force() { if (!exited) signals++ } }
  const state: MainStartup = { token: randomUUID(), fresh: false, child: null, closed: false, done: false, installed: false, error: null,
    signal: controller.signal, cancel() { if (!state.done && !state.installed) controller.abort(Error('cancelled')) },
    settled: settled.promise, persistence: { status: 'unchanged' } }
  closed.promise.then(() => { state.closed = true })
  return { state, child, closed, signals: () => signals, exit: () => { exited = true }, finish() { state.done = true; settled.resolve() } }
}
const app = () => ({ snapshot: { connection: 'connected' }, runtime: { main: { sessionId: 'old', subscribe() {} } }, close: async () => {} }) as unknown as HobkinApplication
const request = (value: InstanceType<typeof HomeOwner>, attemptId: string = randomUUID()) => ({ target: value.wireState().startup!.target!, attemptId })

test('scripted main selects captured transport before any SDK work and keeps jobs nonexecuting', { timeout: 10000 }, async (t) => {
  const { createScriptedModel } = await import('../src/scripted.ts')
  await assert.rejects(createScriptedModel(process.env.HOBKIN_HOME!), /captured client/)
  await assert.rejects(createScriptedModel(process.env.HOBKIN_HOME!, { tools: [{ name: 'bash' }] }), /captured client/)
  let sdkLoads = 0
  fixture.pi = () => { sdkLoads++; return { ModelRuntime: { create: async () => ({}) } } }
  fixture.ai = () => ({})
  t.after(() => { fixture.pi = fixture.ai = fixture.openPiSession = refuse })
  const client = createClientTool({ run: async () => refuse() }), model = await createScriptedModel(process.env.HOBKIN_HOME!, { tools: [client] })
  assert.equal(sdkLoads, 0, 'constructing shipped scripted mode must not load the SDK before capturing a child')
  fixture.openPiSession = (input, dependencies) => {
    const options = input as MainSessionOptions, deps = dependencies as Record<string, unknown>
    assert.equal(deps.isolatedMain, true); assert.equal(deps.scriptedMain, true); assert.equal(deps.createSession, undefined)
    assert.equal(options.config.launcher, undefined); assert.equal(options.config.main.model, null)
    assert.equal((deps.clientBridge as { tool: unknown }).tool, client)
    const original = childProcess.spawn
    childProcess.spawn = ((command: string, args: readonly string[], settings: unknown) => {
      assert.equal(command, process.execPath); assert.deepEqual(args, [new URL('../src/scripted-main-child.ts', import.meta.url).pathname])
      assert.deepEqual(settings, { shell: false }); return {} as never
    }) as unknown as typeof childProcess.spawn
    syncBuiltinESMExports()
    try { (deps.spawnProcess as typeof childProcess.spawn)('untrusted', ['--provider'], { shell: false }) }
    finally { childProcess.spawn = original; syncBuiltinESMExports() }
    return app().runtime.main
  }
  await model.createMain({ root: process.env.HOBKIN_HOME!, config: { main: { cwd: '/fake', model: 'real/provider', effort: 'high' }, launcher: { command: 'real' } }, saved: { sessionId: 'real-history' }, fresh: false })
  assert.equal(sdkLoads, 0)
  assert.match(JSON.stringify(await model.runHarness({ id: 'job', launcher: 'real' })), /ran nothing/)
  assert.match(JSON.stringify(await model.runHarness({ id: 'job', signal: AbortSignal.abort() })), /interrupted/)
})

test('fixed scripted child binds native services to the actual client-only zero-cost factory', { timeout: 10000 }, async (t) => {
  const { runScriptedMainChild } = await import('../src/scripted-main-child.ts')
  const settings = { compaction: { enabled: false }, retry: { enabled: false } }
  const loader = {}, manager = {}, channel = {}
  const session = { agent: { streamFunction: undefined as unknown } }, events: Record<string, unknown>[] = [], ended = deferred()
  const agentDir = `${process.env.HOBKIN_HOME}/client/scripted-agent`, dataRoot = `${process.env.HOBKIN_HOME}/migration/data`
  let calls = 0
  fixture.pi = () => ({ ModelRuntime: { create: async (options: Record<string, unknown>) => {
    assert.equal(options.allowModelNetwork, false); assert.equal(options.refreshOnCreate, false); assert.equal(options.modelsPath, null)
    assert.equal(options.authPath, `${agentDir}/auth.json`); return {}
  } }, SettingsManager: { inMemory: refuse }, createAgentSession: async (options: Record<string, unknown>) => {
    calls++; assert.equal(options.agentDir, agentDir); assert.equal(options.settingsManager, settings); assert.equal(options.resourceLoader, loader); assert.equal(options.sessionManager, manager)
    assert.deepEqual(options.tools, ['client']); assert.deepEqual(options.customTools, [])
    const model = options.model as { provider: string; id: string; cost: object }
    assert.equal(`${model.provider}/${model.id}`, 'hobkin-client/scripted'); assert.deepEqual(Object.values(model.cost), [0, 0, 0, 0])
    return { session }
  } })
  fixture.ai = () => ({ createAssistantMessageEventStream: () => ({ push: (event: Record<string, unknown>) => events.push(event), end: () => ended.resolve() }) })
  fixture.openConversation = async (input, dependencies) => {
    assert.equal((input as MainSessionOptions).root, dataRoot)
    const deps = dependencies as { scriptedMain: boolean; deferExtensionBinding: boolean; createSession: (options: object) => Promise<unknown> }
    assert.equal(deps.scriptedMain, true); assert.equal(deps.deferExtensionBinding, true)
    assert.deepEqual((deps as unknown as Record<string, unknown>).rpcBridge, { clientExtensionPath: '/fixed/client.ts' })
    return { ...await deps.createSession({ agentDir, model: { provider: 'real', id: 'history' }, modelRuntime: { refresh: refuse }, tools: ['client'], customTools: [], settingsManager: settings, resourceLoader: loader, sessionManager: manager }) as object, services: { settingsManager: settings } }
  }
  fixture.runChild = async (actual, dependencies) => {
    assert.equal(actual, channel)
    return (dependencies as { openSession: (...args: unknown[]) => unknown }).openSession({ root: dataRoot }, { agentDir, deferExtensionBinding: true, rpcBridge: { clientExtensionPath: '/fixed/client.ts' } })
  }
  t.after(() => { fixture.pi = fixture.ai = fixture.openConversation = fixture.runChild = refuse })
  const result = await runScriptedMainChild(channel as never) as unknown as { services: { settingsManager: unknown } }
  assert.equal(result.services.settingsManager, settings); assert.equal(calls, 1)
  ;(session.agent.streamFunction as (...args: unknown[]) => unknown)({ api: 'fake', provider: 'hobkin-client', id: 'scripted' }, { messages: [{ role: 'user', content: 'which providers are connected' }] })
  await ended.promise
  const message = events.find(event => event.type === 'done')!.message as { content: { name: string }[]; usage: { cost: { total: number } } }
  assert.equal(message.content[0]!.name, 'client'); assert.equal(message.usage.cost.total, 0)
})

test('only an explicitly injected reply can keep a test main local', { timeout: 10000 }, async (t) => {
  const { createScriptedModel } = await import('../src/scripted.ts')
  const settings = { compaction: { enabled: false }, retry: { enabled: false } }
  const session = { agent: {} }
  fixture.pi = () => ({ ModelRuntime: { create: async () => ({}) }, SettingsManager: { inMemory: (value: unknown) => { assert.deepEqual(value, settings); return settings } },
    createAgentSession: async (options: Record<string, unknown>) => { assert.deepEqual(options.tools, ['fixture']); assert.equal(options.settingsManager, settings); return { session } } })
  fixture.ai = () => ({})
  fixture.openPiSession = async (_options, dependencies) => {
    const deps = dependencies as { isolatedMain?: boolean; createSession: (options: object) => Promise<unknown> }
    assert.equal(deps.isolatedMain, undefined)
    await deps.createSession({ tools: ['bash'] })
    return session
  }
  t.after(() => { fixture.pi = fixture.ai = fixture.openPiSession = refuse })
  const model = await createScriptedModel(process.env.HOBKIN_HOME!, { reply: async () => ({ text: 'injected' }), tools: [{ name: 'fixture' }] })
  assert.equal(await model.createMain({ config: { main: {} } } as MainSessionOptions), session)
})

test('startup Force is registered as a validated host command', { timeout: 10000 }, async () => {
  const args = { target: { home: '/fake', epoch: 'epoch', token: 'token', sessionId: null }, attemptId: randomUUID() }
  const result = await runCommand({ 'startup.force': async () => ({ fenced: true }) } as never, 'startup.force', args)
  assert.equal(result.ok, true, 'the explicit user startup command must be dispatchable before an application exists')
})

test('startup Force is strict user-only authority before app/model readiness', { timeout: 10000 }, async () => {
  const { value, open } = owner(), args = request(value)
  const handlers = { 'startup.force': (input: typeof args) => value.forceStartup(input) }
  assert.equal((await runCommand(handlers, 'startup.force', { ...args, runId: 'invented' })).ok, false)
  assert.equal((await runCommand(handlers, 'startup.force', { ...args, attemptId: 'not-an-id' })).ok, false)
  const client = createClientTool({ run: (name, input) => runCommand(handlers, name, input) })
  await assert.rejects(client.execute('x', { action: 'run', name: 'startup.force', args }), /cannot run/)
  for (const key of ['home', 'epoch', 'token', 'sessionId'] as const) await assert.rejects(value.forceStartup({ ...args, target: { ...args.target, [key]: 'stale' } }), /startup/i)
  await assert.rejects(owner().value.forceStartup(args), /startup/i)
  const entered = deferred(), release = deferred()
  ;(value as unknown as { model(): Promise<OpenOptions> }).model = async () => { entered.resolve(); await release.promise; return {} }
  const opening = open(); await entered.promise
  const result = await value.forceStartup(args)
  assert.equal(result.fence.status, 'confirmed')
  assert.equal(result.closure.status, 'not-created')
  release.resolve(); await opening
  assert.equal(value.app, null)
  assert.equal(value.wireState().startup?.receipt?.attemptId, args.attemptId)
})

for (const live of [true, false]) test(`Force settles before held Application.open cleanup and retains exact retry authority (live=${live})`, { timeout: 10000 }, async (t) => {
  const { value, open, changes, seam } = owner(live), runtime = startup()
  const captured = deferred(), cleanup = deferred()
  const candidate = app().runtime.main as MainSession
  candidate.sessionId = 'candidate'
  if (live) seam.model = async () => ({ createMain: seam.tapped(async () => candidate) })
  fixture.openPiSession = (_options, dependencies) => { assert.equal((dependencies as { scriptedMain: boolean }).scriptedMain, true); return candidate }
  t.after(() => {
    fixture.openPiSession = refuse
    cleanup.resolve()
  })
  fixture.open = async (_root, options) => {
    options.onMainStartup!(runtime.state)
    runtime.state.child = runtime.child
    options.onMainStartup!(runtime.state)
    await options.createMain!({ config: { main: { cwd: '/fake', model: 'real/provider', effort: 'high' } } } as MainSessionOptions)
    runtime.state.persistence = { status: 'unknown', sessionId: 'candidate', sessionFile: '/fake/main.jsonl' }
    captured.resolve()
    await cleanup.promise
    runtime.finish()
    throw Error('open failed after durable drain')
  }
  let outerDone = false
  const opening = open().then(() => { outerDone = true })
  await captured.promise
  const args = { target: changes.at(-1)!.startup!.target!, attemptId: randomUUID() }
  assert.equal(args.target.sessionId, 'candidate', 'the tapped identity must be published before durable commit waits')
  await assert.rejects(value.forceStartup({ ...args, target: { ...args.target, sessionId: 'wrong' } }), /startup/i)
  const first = value.forceStartup(args), duplicate = value.forceStartup(args)
  assert.equal(runtime.signals(), 1, 'Force reaches the captured child synchronously')
  const receipt = await first
  assert.deepEqual(await duplicate, receipt)
  assert.equal(outerDone, false)
  assert.equal(receipt.closure.status, 'unknown')
  assert.equal(receipt.cleanup.status, 'unknown')
  assert.equal(receipt.persistence.status, 'unknown')
  assert.equal(receipt.detachedCleanup, 'unknown')
  assert.equal(receipt.queueRecovery, 'not-applicable')
  const retry = value.forceStartup({ target: changes.at(-1)!.startup!.target!, attemptId: randomUUID() })
  assert.equal(runtime.signals(), 2)
  runtime.closed.resolve({}); await retry
  assert.equal(changes.at(-1)!.startup?.target, null)
  assert.equal(changes.at(-1)!.startup?.receipt?.closure.status, 'confirmed')
  await value.forceStartup(args)
  assert.equal(runtime.signals(), 2, 'a duplicate cannot signal after target removal either')
  await assert.rejects(value.resetMain(async () => {}), /cleanup/i)
  cleanup.resolve(); await opening
  assert.equal(value.app, null)
  assert.equal(changes.at(-1)!.startup?.receipt?.attemptId, (await retry).attemptId)
})

for (const live of [true, false]) test(`failed opening retains child authority; exit is not close and reconnect refuses old requests (live=${live})`, { timeout: 10000 }, async () => {
  const { value, open, changes } = owner(live), runtime = startup()
  const published = (attemptId = randomUUID()) => ({ target: changes.at(-1)!.startup!.target!, attemptId })
  fixture.open = async (_root, options) => {
    options.onMainStartup!(runtime.state); runtime.state.child = runtime.child; options.onMainStartup!(runtime.state)
    runtime.state.error = Error('readiness failed'); runtime.finish(); throw runtime.state.error
  }
  await open()
  const old = published()
  runtime.exit()
  const receipt = await value.forceStartup(old)
  assert.equal(receipt.closure.status, 'unknown')
  assert.equal(runtime.signals(), 0)
  value.reconnectStartup()
  await assert.rejects(value.forceStartup(old), /startup/i)
  await assert.rejects(value.forceStartup(published(old.attemptId)), /attempt/i)
  const pending = value.forceStartup(published())
  value.reconnectStartup()
  const stale = assert.rejects(pending, /receipt/i), fresh = published()
  runtime.closed.resolve({}); await stale
  assert.equal(changes.at(-1)!.startup?.receipt, null)
  const next = await value.forceStartup(fresh)
  assert.equal(next.closure.status, 'confirmed')
})

for (const live of [true, false]) test(`runtime installation alone cannot revoke Force while outer application opening is held (live=${live})`, { timeout: 10000 }, async () => {
  const { value, open, changes } = owner(live), runtime = startup(), entered = deferred(), release = deferred(), closing = deferred(), cleanup = deferred(), late = app()
  late.close = async () => { closing.resolve(); await cleanup.promise }
  fixture.open = async (_root, options) => {
    options.onMainStartup!(runtime.state); runtime.state.child = runtime.child; options.onMainStartup!(runtime.state)
    runtime.state.installed = true; runtime.finish(); entered.resolve(); await release.promise; return late
  }
  const opening = open(); await entered.promise
  assert.ok(changes.at(-1)!.startup?.target, 'Force remains available until the application can own execution controls')
  const forced = value.forceStartup({ target: changes.at(-1)!.startup!.target!, attemptId: randomUUID() }); runtime.closed.resolve({}); await forced
  release.resolve(); await closing.promise
  assert.equal(changes.at(-1)!.startup?.receipt?.cleanup.status, 'unknown')
  cleanup.resolve(); await opening
  assert.equal(changes.at(-1)!.startup?.receipt?.cleanup.status, 'settled', 'late app cleanup must publish its final receipt')
  assert.equal(value.app, null, 'a fenced late application must not install')
})

for (const live of [true, false]) test(`idle main retains fallback Force; failed reset fences late readiness without replacing the old main (live=${live})`, { timeout: 10000 }, async () => {
  const { value, open, changes } = owner(live), initial = startup(), application = app(), oldMain = application.runtime.main
  const published = () => ({ target: changes.at(-1)!.startup!.target!, attemptId: randomUUID() })
  let callback: NonNullable<OpenOptions['onMainStartup']>
  fixture.open = async (_root, options) => {
    callback = options.onMainStartup!; callback(initial.state); initial.state.child = initial.child; callback(initial.state)
    initial.state.persistence = { status: 'committed', sessionId: 'old', sessionFile: '/fake/main.jsonl' }
    initial.state.installed = true; initial.finish(); return application
  }
  const old = published(); await open()
  assert.equal(changes.at(-1)!.startup?.target?.sessionId, 'old', 'idle has no execution Force authority to replace startup custody')
  await assert.rejects(value.forceStartup(old), /startup/i)
  application.snapshot.stopControls = { targets: [{ kind: 'main', runId: 'run', parentId: null, rootId: 'run', label: 'main', canStop: true, canForce: true }] }
  ;(value as unknown as { publish(snapshot: unknown): void }).publish(application.snapshot)
  assert.equal(changes.at(-1)!.startup?.target, null, 'an adopted main with usable execution Force can hand off')
  application.snapshot.stopControls = undefined
  ;(value as unknown as { publish(snapshot: unknown): void }).publish(application.snapshot)
  const idleForce = value.forceStartup(published()); assert.equal(initial.signals(), 1)
  initial.closed.resolve({}); await idleForce
  const reset = startup(), entered = deferred(), release = deferred()
  const resetting = value.resetMain(async () => {
    callback(reset.state); reset.state.child = reset.child; callback(reset.state); entered.resolve()
    await release.promise
    reset.state.signal.throwIfAborted()
  })
  await entered.promise
  const forced = value.forceStartup(published()); reset.closed.resolve({}); await forced
  release.resolve(); await assert.rejects(resetting, /cancelled/)
  reset.finish()
  assert.equal(value.app, application)
  assert.equal(application.runtime.main, oldMain)
  assert.throws(() => callback(initial.state), /startup/i)
})

for (const live of [true, false]) test(`reset retains published Force through previous.close and never adopts a fenced candidate (live=${live})`, { timeout: 10000 }, async (t) => {
  const { value, open, changes } = owner(live), initial = startup(), reset = startup(), application = app(), entered = deferred(), cleanup = deferred()
  const previous = application.runtime.main as MainSession, candidate = { ...previous, sessionId: 'candidate' }
  previous.close = () => cleanup.promise
  let callback: NonNullable<OpenOptions['onMainStartup']>, createMain: OpenOptions['createMain']
  fixture.openPiSession = (_options, dependencies) => { assert.equal((dependencies as { scriptedMain: boolean }).scriptedMain, true); return candidate }
  fixture.open = async (_root, options) => {
    createMain = options.createMain
    callback = options.onMainStartup!; callback(initial.state); initial.state.child = initial.child; callback(initial.state)
    initial.state.persistence = { status: 'committed', sessionId: 'old' }; initial.state.installed = true; initial.finish(); return application
  }
  await open(); t.after(() => { fixture.openPiSession = refuse; cleanup.resolve() })
  const resetting = value.resetMain(async () => {
    callback(reset.state); reset.state.child = reset.child; callback(reset.state)
    if (!live) assert.equal(await createMain!({ config: { main: { cwd: '/fake', model: 'real/provider', effort: 'high' } } } as MainSessionOptions), candidate)
    reset.state.persistence = { status: 'committed', sessionId: 'candidate' }; application.runtime.main = candidate
    reset.state.installed = true; reset.finish(); entered.resolve(); await (previous.close as () => Promise<void>)()
  })
  await entered.promise
  const target = changes.at(-1)!.startup!.target
  assert.ok(target, 'installed candidate still needs Force while previous.close holds reset')
  await assert.rejects(value.selectModel('fake/main', 'high'), /settling/)
  const forced = value.forceStartup({ target, attemptId: randomUUID() })
  assert.equal(reset.signals(), 1); assert.equal(initial.signals(), 0)
  reset.closed.resolve({}); assert.equal((await forced).cleanup.status, 'unknown')
  cleanup.resolve(); await resetting
  assert.equal(changes.at(-1)!.startup?.receipt?.cleanup.status, 'settled')
  assert.equal(changes.at(-1)!.startup?.receipt?.persistence.status, 'committed')
  assert.equal((value as unknown as { main: MainSession }).main, previous, 'late reset cannot adopt the fenced candidate')
})

test('model selection awaits native apply and preserves its effective failure', { timeout: 10000 }, async () => {
  const { value, open } = owner(), application = app(), catalog = {}, applying = deferred(), release = deferred()
  const saved = { model: 'fake/main', effort: 'high' }, failure = Object.assign(Error('effort refused'), { effective: { ...saved, effort: 'low' } })
  let fail = false, settled = false
  Object.assign(application.runtime.main as MainSession, { modelCatalog: async () => catalog, apply: async (choice: unknown) => {
    assert.deepEqual(choice, { model: { provider: 'fake', id: 'main' }, effort: 'high' })
    applying.resolve(); await release.promise; if (fail) throw failure; return saved
  } })
  application.config = { main: { cwd: '/fake', ...saved } }; application.refresh = async () => application.snapshot
  fixture.open = async () => application; await open()
  fixture.settings = async options => {
    assert.equal(options.modelRuntime, catalog)
    let activeRuntime
    try { activeRuntime = { status: 'verified', effective: await options.applyCurrent!({ model: { provider: 'fake', id: 'main' }, effort: 'high' }) } }
    catch (error) { assert.equal(error, failure); activeRuntime = { status: 'unverified', effective: failure.effective, error: failure.message } }
    return { persisted: { status: 'complete', settings: { main: saved } }, activeRuntime }
  }
  const selection = value.selectModel(saved.model, saved.effort).then(result => { settled = true; return result })
  await Promise.race([applying.promise, selection]); assert.equal(settled, false)
  release.resolve(); assert.equal((await selection).applied, true)
  fail = true; assert.equal((await value.selectModel(saved.model, saved.effort)).applied, false)
})
