import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, type TestContext } from 'node:test'
import { Type } from 'typebox'
import { allCommands, checkArguments, commandDefinition, isCommand, isScreen, registerIntegration } from '#shared/commands/registry.ts'
import { defineIntegration, type IntegrationManifest } from '#shared/integration/manifest.ts'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { runCommand, Unavailable } from '../src/commands.ts'
import { createClientTool } from '../src/client-tool.ts'
import type { CommandCall, HostContext, HostPart, ToolHooks } from '../src/integration-contract.ts'
import { IntegrationHost, type IntegrationHostOptions, type IntegrationModule } from '../src/integration-host.ts'
import { workflowHandlers } from '../src/workflows.ts'
import { ToolCallWatcher } from '../src/tool-calls.ts'
import echo from './fixtures/integrations/echo/integration.ts'
import echoHost from './fixtures/integrations/echo/host.ts'
import { afterTest, Client, hostFor } from './support.ts'

const FIXTURES = fileURLToPath(new URL('./fixtures/integrations', import.meta.url))

const nothing = Type.Object({}, { additionalProperties: false })
const manifest = (id: string, extra: Partial<IntegrationManifest> = {}): IntegrationManifest => ({
  id,
  name: id,
  line: 'A test integration',
  commands: { [`${id}.ping`]: { description: 'Ping', runs: 'host', args: Type.Object({ n: Type.Integer() }, { additionalProperties: false }), hobkin: true } },
  screens: [{ id: `${id}-page`, label: id, line: 'A page', keywords: [] }],
  ...extra,
})

test('an integration registers its commands and screens, and the registry checks them as its own', () => {
  registerIntegration(defineIntegration(manifest('reg-one')))
  assert.equal(isCommand('reg-one.ping'), true)
  assert.equal(commandDefinition('reg-one.ping')?.hobkin, true)
  assert.ok(allCommands().some(([name]) => name === 'reg-one.ping'))
  assert.equal(isScreen('reg-one-page'), true)
  assert.deepEqual(checkArguments('reg-one.ping', { n: 1 }), { ok: true })
  const bad = checkArguments('reg-one.ping', { n: 'one' })
  assert.equal(!bad.ok && bad.code, 'invalid-arguments')
  const unknown = checkArguments('reg-one.nothing', {})
  assert.equal(!unknown.ok && unknown.code, 'unknown-command')
})

test('registering is refused with the reason, and leaves nothing behind', () => {
  assert.throws(() => registerIntegration(manifest('Bad Id')), /not an integration id/)
  assert.throws(() => registerIntegration(manifest('reg-two', { commands: { 'other.ping': { description: 'x', runs: 'host', args: nothing } } })), /reg-two\.<something>/)
  assert.throws(() => registerIntegration(manifest('reg-two', { commands: { 'reg-two.': { description: 'x', runs: 'host', args: nothing } } })), /reg-two\.<something>/)
  assert.throws(() => registerIntegration(manifest('app', { commands: { 'app.state': { description: 'x', runs: 'host', args: nothing } } })), /already has/)
  // The second command is a duplicate: the first must not stay registered.
  assert.throws(() => registerIntegration(manifest('reg-three', { commands: { 'reg-three.a': { description: 'x', runs: 'host', args: nothing }, 'reg-three.b': { description: 'x', runs: 'host', args: nothing } }, screens: [{ id: 'work', label: 'x', line: 'x', keywords: [] }] })), /screen/)
  assert.equal(isCommand('reg-three.a'), false)
  assert.equal(isScreen('reg-three-page'), false)
  registerIntegration(manifest('reg-four'))
  assert.throws(() => registerIntegration(manifest('reg-four')), /already has/)
  assert.throws(() => registerIntegration(manifest('reg-five', { screens: [{ id: 'reg-four-page', label: 'x', line: 'x', keywords: [] }] })), /already has/)
  assert.equal(isCommand('reg-five.ping'), false)
})

test('view.open takes a core screen or a registered one, and refuses any other', () => {
  registerIntegration(manifest('reg-six'))
  assert.deepEqual(checkArguments('view.open', { screen: 'work' }), { ok: true })
  assert.deepEqual(checkArguments('view.open', { screen: 'reg-six-page' }), { ok: true })
  assert.equal(checkArguments('view.open', { screen: 'nowhere' }).ok, false)
})

interface Heard { what: string; detail: unknown }

/** The fixture folders loaded the way the host loads them, with what the echo integration heard and the host logged. */
async function loaded(t: TestContext, extra: Record<string, unknown> = {}, integrations: string | readonly IntegrationModule[] = FIXTURES, more: Partial<IntegrationHostOptions> = {}) {
  const heard: Heard[] = []
  const logs: string[] = []
  const changes: number[] = []
  const host = await IntegrationHost.load({
    integrations,
    live: false,
    integrationOptions: { echo: { heard, ...extra } },
    log: (line) => logs.push(line),
    changed: () => changes.push(1),
    connected: () => true,
    hobkin: () => {
      throw new Unavailable('hobkin is not open')
    },
    dataRoot: () => '/nowhere',
    snapshotWork: () => undefined,
    ...more,
  })
  t.after(() => host.close())
  const only = (what: string) => heard.filter((item) => item.what === what).map(({ detail }) => detail)
  return { host, heard, logs, changes, only }
}

test('a folder that loads gets its commands registered, and one that fails is left out whole and logged', async (t) => {
  const { host, logs } = await loaded(t)
  assert.deepEqual(host.ids(), ['echo'])
  assert.equal(isCommand('echo.say'), true)
  assert.equal(isScreen('echo-page'), true)
  assert.equal(isCommand('broken.run'), false, 'its commands are not registered')
  assert.ok(logs.some((line) => line.includes('The integration broken is left out: it cannot start')), logs.join('\n'))
  assert.ok(logs.some((line) => line.includes('The integration mismatch is left out') && line.includes('another')), logs.join('\n'))
  assert.ok(logs.includes('echo: ready'), 'its log lines carry its id')
})

test('closing takes the commands out again, and a folder the app already has commands for is refused', async (t) => {
  const { host } = await loaded(t)
  host.close()
  assert.equal(isCommand('echo.say'), false)
  const { logs } = await loaded(t, {}, [
    { folder: 'app', manifest: defineIntegration({ id: 'app', name: 'App', line: 'x', screens: [], commands: { 'app.state': { description: 'x', runs: 'host', args: Type.Object({}) } } }) },
  ])
  assert.ok(logs.some((line) => line.includes('The integration app is left out') && line.includes('app.state')), logs.join('\n'))
})

test("an integration's commands are checked, run, refused on a bad argument, and listed to hobkin when marked", async (t) => {
  const { host, changes } = await loaded(t)
  const window = host.hooks('window')
  assert.deepEqual(await runCommand(host.handlers(), 'echo.say', { text: 'hi' }, window), { ok: true, value: { said: 'hi' } })
  assert.equal(changes.length, 1, 'its state changed, so the host publishes')
  const bad = await runCommand(host.handlers(), 'echo.say', { text: 3 }, window)
  assert.equal(!bad.ok && bad.error.code, 'invalid-arguments')
  const unknown = await runCommand(host.handlers(), 'echo.nothing', {}, window)
  assert.equal(!unknown.ok && unknown.error.code, 'unknown-command')

  const client = createClientTool({ run: (name, args) => runCommand(host.handlers(), name, args, host.hooks('hobkin')) })
  const listed = (await client.execute('1', { action: 'list' })).details as { name: string }[]
  assert.ok(listed.some(({ name }) => name === 'echo.say'))
  assert.ok(!listed.some(({ name }) => name === 'echo.quiet'), 'a command not marked for hobkin is not listed')
  assert.deepEqual((await client.execute('2', { action: 'run', name: 'echo.say', args: { text: 'again' } })).details, { said: 'again' })
  await assert.rejects(client.execute('3', { action: 'run', name: 'echo.quiet' }), /cannot run echo\.quiet/)
})

test("an integration's state is its slice, read each time", async (t) => {
  const { host } = await loaded(t)
  assert.deepEqual(host.slices(), { echo: { said: 0 } })
  await runCommand(host.handlers(), 'echo.say', { text: 'x' })
  assert.deepEqual(host.slices(), { echo: { said: 1 } })
})

test("beforeCommand refuses a window command and a hobkin command, and afterCommand hears both with who ran them", async (t) => {
  const refuse = (call: CommandCall) => (call.name === 'app.state' && call.from === 'window' ? 'No state from the window.' : call.name === 'echo.say' && call.from === 'hobkin' ? 'hobkin may not say.' : null)
  const { host, only } = await loaded(t, { refuse })
  let ran = 0
  const handlers = { ...host.handlers(), 'app.state': () => (ran += 1) }

  const window = await runCommand(handlers, 'app.state', {}, host.hooks('window'))
  assert.deepEqual(window, { ok: false, error: { code: 'unavailable', message: 'No state from the window.' } })
  const hobkin = await runCommand(handlers, 'echo.say', { text: 'hi' }, host.hooks('hobkin'))
  assert.deepEqual(hobkin, { ok: false, error: { code: 'unavailable', message: 'hobkin may not say.' } })
  assert.equal(ran, 0, 'a refused command never ran')
  assert.equal(host.slices().echo && (host.slices().echo as { said: number }).said, 0)

  // The same commands the other way round run, and are heard.
  assert.equal((await runCommand(handlers, 'app.state', {}, host.hooks('hobkin'))).ok, true)
  assert.equal((await runCommand(handlers, 'echo.say', { text: 'hi' }, host.hooks('window'))).ok, true)
  assert.deepEqual(only('after'), [
    { name: 'app.state', from: 'window', ok: false },
    { name: 'echo.say', from: 'hobkin', ok: false },
    { name: 'app.state', from: 'hobkin', ok: true },
    { name: 'echo.say', from: 'window', ok: true },
  ])
})

test("onToolCall hears a main conversation call and a run's call once as each starts and once as each ends", async (t) => {
  const { host, only } = await loaded(t)
  const watcher = new ToolCallWatcher((call) => host.toolCall(call))
  watcher.event({ type: 'tool_execution_start', toolCallId: 'm1', toolName: 'client', args: {} })
  watcher.event({ type: 'tool_execution_end', toolCallId: 'm1', toolName: 'client', result: 'ok', isError: false })
  const tool = (state: ActivityEntry['state']): ActivityEntry => ({ id: 'tool:r1', kind: 'tool', name: 'bash', input: '{}', state })
  for (const state of ['running', 'running', 'completed', 'completed'] as const) watcher.activity({ 'run-9': [tool(state)] })
  assert.deepEqual(only('tool'), [
    { agent: '#main', id: 'm1', name: 'client', state: 'running' },
    { agent: '#main', id: 'm1', name: 'client', state: 'completed' },
    { agent: 'run-9', id: 'r1', name: 'bash', state: 'running' },
    { agent: 'run-9', id: 'r1', name: 'bash', state: 'completed' },
  ])
})

test('a hook that throws is logged and changes nothing else, and only a refusal refuses', async (t) => {
  const { host, logs, only } = await loaded(t, { fail: true })
  assert.deepEqual(await runCommand(host.handlers(), 'echo.say', { text: 'hi' }, host.hooks('window')), { ok: true, value: { said: 'hi' } })
  host.toolCall({ agent: '#main', id: 'x', name: 'bash', args: {}, state: 'running' })
  host.merged({ url: 'https://example.invalid/pull/1' })
  assert.equal(only('tool').length, 1, 'it was called')
  for (const what of ['beforeCommand failed for echo.say', 'afterCommand failed for echo.say', 'onToolCall failed for bash', 'onMerged failed']) {
    assert.ok(logs.some((line) => line.includes(what)), `${what} is logged: ${logs.join(' | ')}`)
  }
})

test('start and close reach the parts, and a merge is heard', async (t) => {
  const { host, only } = await loaded(t)
  host.start()
  host.merged({ repo: 'acme/web', number: 4 })
  host.close()
  assert.deepEqual(only('start'), [null])
  assert.deepEqual(only('merged'), [{ repo: 'acme/web', number: 4 }])
  assert.deepEqual(only('close'), [null])
})

test('the pull requests the parts know are combined, and a sample never counts beside real ones', async (t) => {
  const pull = (number: number) => ({ url: `https://example.invalid/acme/web/pull/${number}`, number }) as never
  const part = (id: string, pulls: { mine: never[]; waiting: never[]; sample: boolean } | null): IntegrationModule => ({
    folder: id,
    manifest: defineIntegration({ id, name: id, line: 'x', screens: [], commands: {} }),
    host: () => ({ pulls: () => pulls }),
  })
  const known = async (...modules: IntegrationModule[]) => {
    const { host } = await loaded(t, {}, modules)
    const pulls = host.pulls()
    host.close()
    return pulls
  }
  assert.equal(await known(part('none', null)), null)
  assert.deepEqual(await known(part('made-up', { mine: [pull(1)], waiting: [], sample: true })), { mine: [pull(1)], waiting: [], sample: true })
  assert.deepEqual(
    await known(part('a-real', { mine: [pull(2)], waiting: [pull(3)], sample: false }), part('b-sample', { mine: [pull(4)], waiting: [], sample: true }), part('c-real', { mine: [pull(5)], waiting: [], sample: false })),
    { mine: [pull(2), pull(5)], waiting: [pull(3)], sample: false },
  )
})

test('a host started with an integration runs its commands, sends its slice with the reset and again when it differs, and hears the window', async (t) => {
  const heard: Heard[] = []
  const host = await hostFor(t, { integrationFolder: [{ folder: 'echo', manifest: echo, host: echoHost }], integrationOptions: { echo: { heard } } })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  const states = () => client.received.flatMap((message) => (message.type === 'state' && message.slices ? [message] : []))

  await client.until(() => states().length > 0, "the integration's slice")
  assert.equal(states()[0]!.reset, true, 'with the reset')
  assert.deepEqual(states()[0]!.slices, { echo: { said: 0 } })

  const said = await client.command('echo.say', { text: 'hello' })
  assert.deepEqual(said, { type: 'result', id: said.id, ok: true, value: { said: 'hello' } })
  await client.until(() => states().length > 1, 'the changed slice')
  assert.deepEqual(states()[1]!.slices, { echo: { said: 1 } })
  assert.equal(states()[1]!.reset, undefined)
  const wrong = await client.command('echo.say', { text: 3 })
  assert.equal(!wrong.ok && wrong.error.code, 'invalid-arguments')
  assert.deepEqual(await client.command('view.open', { screen: 'echo-page' }).then(({ ok }) => ok), true)
  assert.deepEqual(heard.filter(({ what }) => what === 'after').map(({ detail }) => detail), [
    { name: 'echo.say', from: 'window', ok: true },
    { name: 'view.open', from: 'window', ok: true },
  ])
})

// Tools, hooks on tool calls and workflows (spec 065, A9 to A11).

/** An integration made of a few lines: its host part is what the test gives. */
const inline = (id: string, part: HostPart | ((context: HostContext) => HostPart)): IntegrationModule => ({
  folder: id,
  manifest: defineIntegration({ id, name: id, line: 'x', screens: [], commands: {} }),
  host: (context) => (typeof part === 'function' ? part(context) : part),
})
const runtimeOf = async (t: TestContext, modules: IntegrationModule[], more: Partial<IntegrationHostOptions> = {}) => {
  const { host } = await loaded(t, {}, modules, more)
  return host.runtimeOption()
}
const call = (name: string, args: Record<string, unknown> = {}) => ({ agent: '#main', id: 'c1', name, args })

test("an integration's tools are offered to agents by their prefixed names with JSON schemas, and a call runs in the host with the agent named", async (t) => {
  const { host, logs } = await loaded(t)
  const option = host.runtimeOption()!
  const [shout] = option.tools()
  assert.equal(shout!.name, 'echo_shout')
  assert.deepEqual(shout!.agents, ['main', 'runs'])
  assert.equal((shout!.parameters as { type: string }).type, 'object')
  assert.equal(JSON.parse(JSON.stringify(shout)).parameters.properties.text.type, 'string')
  assert.deepEqual(await option.callTool('echo_shout', { text: 'hi' }, { agent: 'run-7', id: 'x' }), { text: 'run-7: HI' })
  assert.deepEqual(await option.callTool('echo_shout', { text: 'explode' }, { agent: '#main', id: 'x' }), { text: 'it exploded', failed: true })
  const bad = await option.callTool('echo_shout', { text: 3 }, { agent: '#main', id: 'x' })
  assert.equal(bad.failed, true)
  assert.match(bad.text, /echo_shout was given arguments that do not fit/)
  assert.equal((await option.callTool('nothing', {}, { agent: '#main', id: 'x' })).failed, true)
  assert.ok(logs.some((line) => line.includes('echo: The tool echo_shout failed: it exploded')))
})

test('with no tools, hooks or workflows the host offers hobkin nothing, and a bad tool leaves its folder out', async (t) => {
  assert.equal(await runtimeOf(t, [inline('plain', {})]), null)
  const { host, logs } = await loaded(t, {}, [inline('odd', { tools: [{ name: 'Bad Name', description: 'x', parameters: Type.Object({}), execute: () => 'x' }] }), inline('twice', { tools: [{ name: 'a', description: 'x', parameters: Type.Object({}), execute: () => 'x' }, { name: 'a', description: 'x', parameters: Type.Object({}), execute: () => 'x' }] })])
  assert.deepEqual(host.ids(), [])
  assert.equal(logs.filter((line) => line.includes('is left out')).length, 2)
})

test('a tool name is its integration id with _ for -, and two integrations cannot give the same name', async (t) => {
  const tool = (name: string) => ({ name, description: 'x', parameters: Type.Object({}), execute: () => 'x' })
  const { host, logs } = await loaded(t, {}, [inline('a-b', { tools: [tool('c_d')] }), inline('a', { tools: [tool('b_c_d')] })])
  assert.deepEqual(host.runtimeOption()!.tools().map(({ name }) => name), ['a_b_c_d'], 'the second is left out as a duplicate')
  assert.ok(logs.some((line) => line.includes('a_b_c_d is given twice')))
})

test('a before hook refuses a hooked call with its reason, changes another call, and a call nothing hooks is let through', async (t) => {
  const { host, only } = await loaded(t)
  const option = host.runtimeOption()!
  assert.deepEqual(option.hookedTools(), ['echo_shout', 'bash'])
  assert.deepEqual(await option.beforeTool(call('echo_shout', { text: 'forbidden' })), { block: 'echo does not say that.' })
  assert.deepEqual(await option.beforeTool(call('bash', { command: 'ls' })), { args: { command: 'ls --quiet' } })
  assert.equal(await option.beforeTool(call('echo_shout', { text: 'fine' })), null)
  assert.equal(await option.beforeTool(call('read', { path: 'x' })), null, 'not its tool')
  assert.equal(only('tool-before').length, 3, 'the hook never heard the unhooked call')
})

test('an after hook changes what the agent reads, and leaves other results as they were', async (t) => {
  const { host } = await loaded(t, { hide: 'secret' })
  const option = host.runtimeOption()!
  assert.deepEqual(await option.afterTool(call('echo_shout'), { text: 'a secret here', failed: false }), { text: 'a *** here', failed: false })
  assert.equal(await option.afterTool(call('echo_shout'), { text: 'nothing', failed: false }), null)
  assert.equal(await option.afterTool(call('read'), { text: 'a secret', failed: false }), null)
})

test('hooks run in folder order: the first refusal wins, and changed arguments pass to the next hook', async (t) => {
  const seen: unknown[] = []
  const hook = (name: string, before: ToolHooks['before']) => inline(name, { toolHooks: { tools: 'all', before: (c) => (seen.push([name, c.args]), before!(c)) } })
  const option = (await runtimeOf(t, [
    hook('b-second', (c) => (c.args.stop ? { block: 'second said no' } : undefined)),
    hook('a-first', (c) => ({ args: { ...c.args, first: true } })),
    hook('c-third', (c) => ({ args: { ...c.args, third: true } })),
  ]))!
  assert.equal(option.hookedTools(), 'all')
  assert.deepEqual(await option.beforeTool(call('x', { n: 1 })), { args: { n: 1, first: true, third: true } })
  assert.deepEqual(seen.slice(0, 3), [['a-first', { n: 1 }], ['b-second', { n: 1, first: true }], ['c-third', { n: 1, first: true }]])
  seen.length = 0
  assert.deepEqual(await option.beforeTool(call('x', { stop: true })), { block: 'second said no' })
  assert.deepEqual((seen as [string, unknown][]).map(([name]) => name), ['a-first', 'b-second'], 'the third was never asked')
})

test('a hook that throws or is slow lets the call through and is logged, unless it says to refuse', async (t) => {
  const failing = (id: string, failClosed: boolean, how: 'throw' | 'slow') =>
    inline(id, { toolHooks: { tools: ['x'], failClosed, before: () => (how === 'throw' ? Promise.reject(Error('it broke')) : new Promise(() => {})), after: () => { throw Error('after broke') } } })
  const open = await loaded(t, {}, [failing('open-throw', false, 'throw'), failing('open-slow', false, 'slow')], { hookTimeoutMs: 20 })
  const option = open.host.runtimeOption()!
  assert.equal(await option.beforeTool(call('x', { n: 1 })), null)
  assert.equal(await option.afterTool(call('x'), { text: 'as it was', failed: false }), null)
  assert.ok(open.logs.some((line) => line.includes('open-throw: Its before hook failed for x, so the call went through: it broke')))
  assert.ok(open.logs.some((line) => line.includes('did not answer within')))
  open.host.close()

  const closed = (await runtimeOf(t, [failing('shut', true, 'slow')], { hookTimeoutMs: 20 }))!
  assert.match((await closed.beforeTool(call('x')) as { block: string }).block, /shut integration's check of this call failed, so it was refused/)
  const after = await closed.afterTool(call('x'), { text: 'secret', failed: false })
  assert.equal(after?.failed, true)
  assert.match(after!.text!, /withheld/)
})

test("each integration's workflows folder is given with that integration's tool names", async (t) => {
  const { host } = await loaded(t)
  assert.deepEqual(host.runtimeOption()!.workflowFolders(), [{ id: 'echo', folder: join(FIXTURES, 'echo', 'workflows'), tools: ['echo_shout'] }])
  assert.equal((await runtimeOf(t, [inline('bare', {})]))?.workflowFolders(), undefined)
})

test('a command that ended well starts the workflows that list after:<command>, with its arguments and answer, and no other', async (t) => {
  const started: unknown[] = []
  const rows = [
    { id: 'echo/digest', integration: 'echo', on: ['press', 'after:echo.say'], enabled: true },
    { id: 'echo/off', integration: 'echo', on: ['after:echo.say'], enabled: false },
    { id: 'echo/other', integration: 'echo', on: ['after:echo.quiet'], enabled: true },
    { id: 'routine', on: ['after:echo.say'] },
  ]
  const { host } = await loaded(t, {}, FIXTURES, { workflows: { rows: () => rows, start: async (id, input) => (started.push([id, input]), { run: 'r1' }) } })
  await runCommand(host.handlers(), 'echo.say', { text: 'hi' }, host.hooks('window'))
  await runCommand(host.handlers(), 'echo.say', { text: 3 }, host.hooks('window'))
  assert.deepEqual(started, [['echo/digest', { command: 'echo.say', args: { text: 'hi' }, answer: { said: 'hi' } }]])
  started.length = 0
  await runCommand({ 'echo.say': () => { throw Error('no') } }, 'echo.say', { text: 'hi' }, host.hooks('window'))
  assert.deepEqual(started, [], 'a command that failed starts nothing')
})

test("a part starts its own workflow by its file name, and is refused with the reason when hobkin cannot", async (t) => {
  const started: unknown[] = []
  let context!: HostContext
  await loaded(t, {}, [inline('flow', (given) => ((context = given), {}))], { workflows: { rows: () => [], start: async (id, input) => (started.push([id, input]), { run: 'r2' }) } })
  assert.deepEqual(await context.startWorkflow('digest', { n: 1 }), { run: 'r2' })
  assert.deepEqual(started, [['flow/digest', { n: 1 }]])
  await assert.rejects(context.startWorkflow('../x'), /not a workflow's file name/)
  await loaded(t, {}, [inline('lone', (given) => ((context = given), {}))])
  await assert.rejects(context.startWorkflow('digest'), /no workflow starts/)
})

test("workflow.run and workflow.enable go to the application's own calls, and say why when the runtime has none", async () => {
  const calls: unknown[] = []
  const app = {
    startWorkflow: async (id: string, input?: unknown) => (calls.push(['start', id, input]), { run: 'r3' }),
    setWorkflowEnabled: async (id: string, enabled: boolean) => (calls.push(['enable', id, enabled]), { id, enabled }),
  }
  const handlers = workflowHandlers({ app: () => app })
  assert.deepEqual(await runCommand(handlers, 'workflow.run', { id: 'echo/digest' }), { ok: true, value: { run: 'r3' } })
  assert.deepEqual(await runCommand(handlers, 'workflow.enable', { id: 'echo/digest', on: false }), { ok: true, value: { id: 'echo/digest', enabled: false } })
  assert.deepEqual(calls, [['start', 'echo/digest', undefined], ['enable', 'echo/digest', false]])
  assert.equal((await runCommand(handlers, 'workflow.run', { id: 'digest' })).ok, false, 'an id names its integration')
  assert.equal(commandDefinition('workflow.run')?.hobkin, true)
  assert.equal(commandDefinition('workflow.enable')?.hobkin, undefined, 'turning one off is the window only')

  const old = workflowHandlers({ app: () => ({}) })
  const none = await runCommand(old, 'workflow.run', { id: 'echo/digest' })
  assert.deepEqual(none, { ok: false, error: { code: 'unavailable', message: "hobkin's runtime in this host has no workflows yet." } })
  const refused = workflowHandlers({ app: () => ({ startWorkflow: async () => { throw Error('Workflow is turned off.') } }) })
  assert.deepEqual(await runCommand(refused, 'workflow.run', { id: 'echo/digest' }), { ok: false, error: { code: 'unavailable', message: 'Workflow is turned off.' } })
})
