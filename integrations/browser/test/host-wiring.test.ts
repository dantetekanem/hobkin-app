import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Unavailable } from '#host/commands.ts'
import { IntegrationHost } from '#host/integration-host.ts'
import { afterTest, Client, hostFor } from '../../../host/test/support.ts'
import type { BrowserState } from '../protocol.ts'
import { commandNames, fakeEngine, temporaryFolder } from './support.ts'

/** The repository's own folder of integrations, as the host finds it when it starts. */
const INTEGRATIONS = fileURLToPath(new URL('../..', import.meta.url))

/** The browser slice a window holds after the messages received so far. */
function browserOf(client: Client): BrowserState | null {
  let browser: BrowserState | null = null
  for (const message of client.received) if (message.type === 'state' && message.slices?.browser) browser = message.slices.browser as BrowserState
  return browser
}

test('the host takes the folder as it is, and offers agents one tool named browser_run', async (t) => {
  const logs: string[] = []
  const engine = fakeEngine()
  const host = await IntegrationHost.load({
    integrations: INTEGRATIONS,
    live: false,
    integrationOptions: { browser: { exec: engine.exec, binary: '/fake/agent-browser', chrome: '/fake/chrome-158.0.1/Chrome' } },
    log: (line) => logs.push(line),
    changed: () => {},
    connected: () => true,
    hobkin: () => {
      throw new Unavailable('hobkin is not open')
    },
    dataRoot: () => temporaryFolder(t),
    snapshotWork: () => undefined,
  })
  t.after(() => host.close())
  assert.ok(host.ids().includes('browser'), logs.join('\n'))
  assert.deepEqual(logs.filter((line) => line.includes('browser')), [], 'nothing was said against the folder')

  const runtime = host.runtimeOption()!
  const tools = runtime.tools().filter((tool) => tool.name.startsWith('browser'))
  assert.deepEqual(tools.map((tool) => tool.name), ['browser_run'])
  const [tool] = tools
  assert.equal(tool!.agents, undefined, 'the main chat, runs and durable hobkins all get it')
  assert.equal((tool!.parameters as { type: string }).type, 'object')
  assert.match(tool!.description, /^Drive your own browser, a real Chrome with a clean profile/)

  // A call comes in the way hobkin's runtime makes it: by the full name, with the agent the host knows.
  const help = await runtime.callTool('browser_run', { do: 'help' }, { agent: '#main', id: 'c1' })
  assert.equal(help.failed, undefined)
  assert.match(help.text, /^# The browser tool/)
  const read = await runtime.callTool('browser_run', { do: 'read' }, { agent: 'hobkin:0a1b2c3d:2', id: 'c2' })
  assert.equal(read.text.split('\n')[0], 'read → 12 elements')
  // The new browser is made safe first: its control port closed, hobkin's own window blocked. Then the step, and where it is.
  assert.deepEqual(commandNames(engine.ranIn('hobkin-0a1b2c3d')), ['stream', 'network', 'snapshot', 'get'])
  // The host checks the arguments against the tool's schema, so a call cannot name a session.
  const sneaky = await runtime.callTool('browser_run', { do: 'read', session: 'hobkin-main' }, { agent: 'run-7', id: 'c3' })
  assert.equal(sneaky.failed, true)
  assert.match(sneaky.text, /browser_run was given arguments that do not fit/)
  const bad = await runtime.callTool('browser_run', { do: 'fill' }, { agent: '#main', id: 'c4' })
  assert.deepEqual(bad, { text: 'fill needs `on` and `text`', failed: true })
  assert.deepEqual(logs.filter((line) => line.includes('failed')), [], 'a refusal is an answer, not a fault in the log')
})

test('a running host sends the browser state as slices.browser and answers browser.status and browser.close', { timeout: 30000 }, async (t) => {
  const engine = fakeEngine()
  const host = await hostFor(t, { integrationOptions: { browser: { exec: engine.exec, binary: '/fake/agent-browser', chrome: '/fake/chrome-158.0.1/Chrome' } } })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  // The host looks once as it starts, so the window is told the engine is there without asking.
  await client.until(() => browserOf(client)?.engine.state === 'ready', 'the browser state')
  assert.equal(client.received.some((message) => message.type === 'state' && 'browser' in message), false, 'the core has no browser key')
  const state = await client.run<BrowserState>('browser.status')
  assert.deepEqual(state, { engine: { state: 'ready', version: '0.45.0', chrome: '158.0.1', note: null }, sessions: [] })
  assert.deepEqual(await client.run<{ closed: number }>('browser.close', {}), { closed: 0 })
  await assert.rejects(client.run('browser.close', { agent: '' }))
  assert.equal(engine.calls.some(({ args }) => args[0] === 'install'), false, 'nothing was installed')
})

test('a scripted host with nothing handed in shows the made-up browser and installs nothing', { timeout: 30000 }, async (t) => {
  const host = await hostFor(t)
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.until(() => browserOf(client) !== null, 'the browser state')
  const state = await client.run<BrowserState>('browser.status')
  assert.equal(state.engine.state, 'ready')
  assert.deepEqual(state.sessions.map(({ agent, url }) => [agent, url]), [['#main', 'https://app.sample.invalid/dashboard']])
  await assert.rejects(client.run('browser.install', {}), /scripted host/)
})
