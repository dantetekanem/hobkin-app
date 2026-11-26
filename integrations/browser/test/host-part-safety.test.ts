import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { OWN_WINDOW_REFUSAL } from '../host/places.ts'
import { answered, assertRunsAreHobkinsOwn, callTool, fakeEngine, PAGE, partFor, readyPart, stateOf, temporaryFolder, until } from './support.ts'

test('every run of the engine is given an empty config of hobkin\'s own and a folder of its own, whatever the user has set up', async (t) => {
  const { part, engine, root } = await readyPart(t)
  part.start!()

  // One of each kind of run: the look for its version, a tool call, the list of sessions, a close, and the closes of a stopping host.
  await callTool(part, { steps: [{ do: 'open', url: 'http://localhost:3000' }, { do: 'read' }] })
  await callTool(part, { do: 'read' }, 'run-7')
  await answered(part, 'browser.status')
  await answered(part, 'browser.close', { agent: 'run-7' })
  part.close!()

  const kinds = new Set(engine.calls.map(({ args }) => (args[0] === '--session' ? (args[2] === '--json' ? 'page' : 'shutdown close') : args[0])))
  assert.deepEqual([...kinds].sort(), ['--version', 'page', 'session', 'shutdown close'])
  assertRunsAreHobkinsOwn(engine.calls, root)

  // The config is there before the first run, holds nothing, and only the user reads it.
  const config = join(root, 'tools', 'browser', 'engine-config.json')
  assert.equal(readFileSync(config, 'utf8'), '{}\n')
  assert.equal(statSync(config).mode & 0o777, 0o600)
})

test("a page's downloads are kept in hobkin's data folder, and its Chrome is the one that was found", async (t) => {
  const { part, engine, root } = await readyPart(t)
  await callTool(part, { do: 'read' })

  const env = engine.ranIn('hobkin-main').at(-1)!.options.env!
  const settings = Object.fromEntries(Object.entries(env).filter(([name]) => name.startsWith('AGENT_BROWSER_')))

  assert.deepEqual(settings, {
    AGENT_BROWSER_NO_VERSION_CHECK: '1',
    AGENT_BROWSER_EXECUTABLE_PATH: '/fake/chrome-158.0.1/Chrome',
    AGENT_BROWSER_IDLE_TIMEOUT_MS: '600000',
    AGENT_BROWSER_DOWNLOAD_PATH: join(root, 'browser', 'downloads'),
    AGENT_BROWSER_CONFIG: join(root, 'tools', 'browser', 'engine-config.json'),
  })
})

test('the window is told the origin and path of a page, never its query or fragment, and a long title is cut', async (t) => {
  const address = 'http://localhost:3000/reset/confirm?token=SECRET-TOKEN&next=%2Fhome#access_token=ALSO-SECRET'
  const title = 'T'.repeat(1000)
  const { part } = await readyPart(t, { get: (command) => (command[1] === 'title' ? { title } : { url: address }) })

  const read = await callTool(part, { do: 'read', what: 'text' })

  // The agent that asked is told where it is in full.
  assert.equal(read.text.split('\n').at(-1), `now at ${JSON.stringify(title)} ${address}`)
  const [shown] = stateOf(part).sessions
  assert.equal(shown!.url, 'http://localhost:3000/reset/confirm')
  assert.equal(shown!.title, `${'T'.repeat(300)}…`)
  assert.doesNotMatch(JSON.stringify(stateOf(part)), /SECRET|token/)

  // An address that is not one, or longer than any real one, is not passed on as it is.
  const odd = await readyPart(t, { get: (command) => (command[1] === 'title' ? { title: 'x' } : { url: `http://localhost:3000/${'p'.repeat(5000)}` }) })
  await callTool(odd.part, { do: 'read' })
  assert.equal(stateOf(odd.part).sessions[0]!.url!.length, 2001)
  const none = await readyPart(t, { get: (command) => (command[1] === 'title' ? { title: 'x' } : { url: 'about:blank' }) })
  await callTool(none.part, { do: 'read' })
  assert.equal(stateOf(none.part).sessions[0]!.url, 'about:blank')
})

test("a durable hobkin's turns share one browser and one row, which names its latest turn", async (t) => {
  let now = 1_000
  const { part, engine } = await readyPart(t, {}, { now: () => (now += 10) })

  await callTool(part, { do: 'read' }, 'hobkin:0a1b2c3d:4')
  const [first] = stateOf(part).sessions
  await callTool(part, { do: 'read' }, 'hobkin:0a1b2c3d:5')
  await callTool(part, { do: 'read' }, 'hobkin:0a1b2c3d:6')

  const rows = stateOf(part).sessions
  assert.equal(rows.length, 1, 'one browser, one row')
  assert.deepEqual([rows[0]!.agent, rows[0]!.label, rows[0]!.since], ['hobkin:0a1b2c3d:6', 'hobkin 0a1b2c3d', first!.since])
  assert.ok(rows[0]!.lastAt > first!.lastAt)
  assert.deepEqual([...engine.sessions], ['hobkin-0a1b2c3d'])

  // Closing by any of its turns closes that one browser.
  assert.deepEqual(await answered(part, 'browser.close', { agent: 'hobkin:0a1b2c3d:4' }), { closed: 1 })
  assert.deepEqual(stateOf(part).sessions, [])
  assert.deepEqual([...engine.sessions], [])
})

test('the browsers listed are checked against the engine while any is open, with or without a window', async (t) => {
  // No window is open.
  const { part, engine } = await readyPart(t, {}, { reconcileMs: 10 }, { connected: () => false })
  await callTool(part, { do: 'read' })
  await callTool(part, { do: 'read' }, 'run-7')
  assert.equal(stateOf(part).sessions.length, 2)

  // One browser closed itself after being left alone.
  engine.sessions.delete('hobkin-main')
  part.start!()
  t.after(() => part.close!())

  await until(() => stateOf(part).sessions.length === 1, 'the closed browser to leave the list')
  assert.deepEqual(stateOf(part).sessions.map(({ agent }) => agent), ['run-7'])
})

test("the tool does not open hobkin's own window, blocks it in every browser it starts, and a longer list can be handed in", async (t) => {
  const { part, engine } = await readyPart(t, {}, { refusedPlaces: ['127.0.0.1:40123'] })

  for (const url of ['http://127.0.0.1:5187', 'http://localhost:5187/work', 'http://[::1]:4848/', 'http://localhost:40123/x']) {
    assert.deepEqual(await callTool(part, { do: 'open', url }), { text: OWN_WINDOW_REFUSAL, failed: true }, url)
    assert.deepEqual(await callTool(part, { steps: [{ do: 'read' }, { do: 'open', url }], json: true }), { text: `steps[1]: ${OWN_WINDOW_REFUSAL}`, failed: true })
  }
  assert.deepEqual(engine.calls.filter(({ args }) => args[0] === '--session'), [], 'the engine was asked nothing')

  const opened = await callTool(part, { do: 'open', url: 'http://localhost:3000' })
  assert.equal(opened.failed, false)
  assert.equal(engine.portClosed.has('hobkin-main'), true)
  const blocked = engine.blocked.get('hobkin-main')!
  // Ports 5187 and 4848 and the one handed in, each under the four spellings of this computer.
  assert.equal(blocked.length, 12)
  for (const port of ['5187', '4848', '40123']) assert.ok(blocked.includes(`**://127.0.0.1:${port}/**`) && blocked.includes(`**://localhost:${port}/**`), port)

  // A page that takes the browser there by itself: the call fails, and the window's own row does not show the address.
  const moved = await readyPart(t, { get: (command) => (command[1] === 'title' ? { title: 'hobkin' } : { url: 'http://127.0.0.1:5187/?token=1' }) })
  const taken = await callTool(moved.part, { do: 'read' })
  assert.equal(taken.failed, true)
  assert.match(taken.text, /^read failed: That address is hobkin's own window; an agent's browser does not open it\. A page sent the browser there/)
  assert.deepEqual(stateOf(moved.part).sessions.map(({ url }) => url), ['about:blank'])
  assert.equal(PAGE.url.includes('5187'), false)
})

test('a host that starts before hobkin has opened looks again until it has seen the engine, and writes nothing until it runs it', async (t) => {
  const engine = fakeEngine()
  // hobkin is not open: it has no data folder yet.
  const fakes: Parameters<typeof partFor>[0] = { options: { exec: engine.exec, binary: '/fake/agent-browser', chrome: '/fake/chrome-158.0.1/Chrome', firstLookMs: 5 } }
  const part = await partFor(fakes)
  part.start!()
  t.after(() => part.close!())

  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(stateOf(part).engine.state, 'unknown')
  assert.deepEqual(engine.calls, [], 'nothing can be run from nowhere')

  // hobkin opens.
  fakes.root = temporaryFolder(t)
  await until(() => stateOf(part).engine.state === 'ready', 'the engine to be seen')

  assert.deepEqual(stateOf(part).engine, { state: 'ready', version: '0.45.0', chrome: '158.0.1', note: null })
  assertRunsAreHobkinsOwn(engine.calls, fakes.root)
  const looks = engine.calls.length
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(engine.calls.length, looks, 'and once it has seen, it stops looking')
})
