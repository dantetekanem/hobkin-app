import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test, type TestContext } from 'node:test'
import { Type } from 'typebox'
import { allCommands, checkArguments, commandDefinition, isCommand, isScreen, registerIntegration } from '#shared/commands/registry.ts'
import { defineIntegration, type IntegrationManifest } from '#shared/integration/manifest.ts'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { runCommand, Unavailable } from '../src/commands.ts'
import { createClientTool } from '../src/client-tool.ts'
import type { CommandCall } from '../src/integration-contract.ts'
import { IntegrationHost, type IntegrationModule } from '../src/integration-host.ts'
import { ToolCallWatcher } from '../src/tool-calls.ts'

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
async function loaded(t: TestContext, extra: Record<string, unknown> = {}, integrations: string | readonly IntegrationModule[] = FIXTURES) {
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
