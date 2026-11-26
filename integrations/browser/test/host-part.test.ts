import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { Check } from 'typebox/value'
import type { BrowserState } from '../protocol.ts'
import type { Exec } from '../host/engine.ts'
import { sessionFor } from '../host/sessions.ts'
import manifest from '../integration.ts'
import { answered, callTool, commandNames, fakeEngine, PAGE, partFor, readyPart, run, runTool, stateOf, temporaryFolder } from './support.ts'

/** A turn of a durable hobkin, and a run of work: two agents besides the main chat. */
const DURABLE = 'hobkin:0a1b2c3d:4'
const RUN = 'work-7f3a9c2e-1b4d-4e8a-9c0f-2a6b8d1e3f50'
/** The engine's names for their browsers. */
const DURABLE_SESSION = 'hobkin-0a1b2c3d'
const RUN_SESSION = 'hobkin-run-376903477f8d'

/** The engine as `readyPart` has it once a call has looked for it. */
const READY = { state: 'ready', version: '0.45.0', chrome: '158.0.1', note: null }

type Calls = ReturnType<typeof fakeEngine>['calls']

const versionChecks = (calls: Calls): number => calls.filter(({ args }) => args[0] === '--version').length

test('the manifest names three commands, and the tool is one flat schema every provider takes', async (t) => {
  assert.equal(manifest.id, 'browser')
  assert.deepEqual(Object.keys(manifest.commands), ['browser.status', 'browser.install', 'browser.close'])
  assert.deepEqual(Object.entries(manifest.commands).map(([name, command]) => [name, 'hobkin' in command, 'outside' in command]), [
    ['browser.status', true, false],
    // It downloads to disk, so only the user starts it, from the window.
    ['browser.install', false, true],
    ['browser.close', true, false],
  ])
  assert.deepEqual(manifest.screens, [])
  assert.equal(Check(manifest.commands['browser.close'].args, { agent: '#main' }), true)
  assert.equal(Check(manifest.commands['browser.close'].args, {}), true)
  assert.equal(Check(manifest.commands['browser.close'].args, { session: 'hobkin-main' }), false)

  const { part } = await readyPart(t)
  assert.equal(part.tools!.length, 1)
  const tool = runTool(part)
  // An agent knows it as browser_run, and every agent gets it.
  assert.equal(tool.name, 'run')
  assert.equal(tool.agents, undefined)
  assert.ok(tool.description.length < 2400, 'the description is read on every request')
  assert.match(tool.description, /\{ do: "help" \}/)
  assert.match(tool.description, /`json: true`/)

  const schema = JSON.parse(JSON.stringify(tool.parameters))
  assert.equal(schema.additionalProperties, false)
  assert.equal(schema.properties.steps.items.additionalProperties, false)
  assert.equal(schema.required, undefined)
  assert.deepEqual(Object.keys(schema.properties), ['do', 'url', 'on', 'text', 'key', 'option', 'what', 'within', 'by', 'to', 'ms', 'code', 'full', 'steps', 'json'])
  assert.deepEqual(Object.keys(schema.properties.steps.items.properties), Object.keys(schema.properties).slice(0, -2))
  assert.equal(schema.properties.do.type, 'string')
  assert.equal(schema.properties.do.enum.length, 17)
  assert.doesNotMatch(JSON.stringify(schema), /anyOf|oneOf|allOf/)

  const taken = [
    { do: 'open', url: 'http://x.invalid' },
    { steps: [{ do: 'fill', on: 'Email', text: 'a' }, { do: 'read' }], json: true },
  ]
  for (const input of taken) assert.equal(Check(tool.parameters, input), true, JSON.stringify(input))

  const refused = [
    { do: 'fly' },
    // No call names its own session, or anyone else's.
    { do: 'read', session: 'hobkin-main' },
    { do: 'read', agent: '#main' },
    { steps: [{ steps: [] }] },
    { steps: [{ do: 'read', json: true }] },
    { do: 'wait', ms: '5' },
  ]
  for (const input of refused) assert.equal(Check(tool.parameters, input), false, JSON.stringify(input))
})

test("each agent's browser is named from the agent the host says is calling", async (t) => {
  assert.deepEqual(sessionFor('#main'), { name: 'hobkin-main', label: 'Main chat' })
  // A durable hobkin keeps one browser from turn to turn.
  assert.deepEqual(sessionFor(DURABLE), { name: DURABLE_SESSION, label: 'hobkin 0a1b2c3d' })
  assert.deepEqual(sessionFor('hobkin:0a1b2c3d:117'), sessionFor(DURABLE))
  assert.deepEqual(sessionFor(RUN), { name: RUN_SESSION, label: 'work-7f3a9c2…' })
  assert.deepEqual(sessionFor('run-7'), { name: 'hobkin-run-2e6ec62bde4b', label: 'run-7' })
  assert.notEqual(sessionFor('run-7').name, sessionFor('run-8').name)
  assert.equal(sessionFor('#main', 'hobkin-live-test').name, 'hobkin-live-test-main')

  // An id made to look like another agent's, or to carry an option, is only hashed.
  const lookalikes = ['hobkin:0a1b2c3d', 'hobkin:0A1B2C3D:1', 'hobkin-main', '--cdp 9222', '../main', '']
  for (const agent of lookalikes) assert.match(sessionFor(agent).name, /^hobkin-run-[0-9a-f]{12}$/, agent)

  const { part, engine } = await readyPart(t)
  const callers = ['#main', DURABLE, 'hobkin:0a1b2c3d:5', RUN]

  for (const agent of callers) {
    const read = await callTool(part, { do: 'read' }, agent)
    assert.equal(read.failed, false)
  }

  // Four callers, three browsers: the durable hobkin's two turns share one.
  const sessionsUsed = engine.calls.filter(({ args }) => args[0] === '--session').map(({ args }) => args[1])
  assert.deepEqual([...new Set(sessionsUsed)], ['hobkin-main', DURABLE_SESSION, RUN_SESSION])
  assert.deepEqual([...engine.sessions], ['hobkin-main', DURABLE_SESSION, RUN_SESSION])
})

test('two agents get two browsers, and the state lists them newest first with the page each is on', async (t) => {
  let now = 1_000
  const { part, engine, root } = await readyPart(t, {}, { now: () => (now += 10) })
  assert.deepEqual(stateOf(part), { engine: { state: 'unknown', version: null, chrome: null, note: null }, sessions: [] })

  const opened = await callTool(part, { do: 'open', url: 'http://localhost:3000' }, '#main')
  assert.deepEqual(opened, { text: 'open → "Home" http://localhost:3000/', failed: false })
  // The first call looked for the engine and found it.
  assert.deepEqual(stateOf(part).engine, READY)
  assert.deepEqual(stateOf(part).sessions, [{ agent: '#main', label: 'Main chat', url: PAGE.url, title: PAGE.title, since: 1_020, lastAt: 1_030 }])
  const changes = part.heard.changed
  assert.ok(changes >= 2, 'the engine found, and the browser opened')

  await callTool(part, { do: 'read' }, RUN)
  assert.equal(part.heard.changed, changes + 1)
  assert.deepEqual(stateOf(part).sessions.map(({ agent, label }) => [agent, label]), [[RUN, 'work-7f3a9c2…'], ['#main', 'Main chat']])
  await callTool(part, { do: 'read', what: 'text' }, '#main')
  const [main, other] = stateOf(part).sessions
  assert.deepEqual([main!.agent, main!.since, other!.agent], ['#main', 1_020, RUN])
  assert.ok(main!.lastAt > other!.lastAt)
  // Nothing of the engine's is in what the window is told: no session name, no path.
  assert.deepEqual(Object.keys(main!), ['agent', 'label', 'url', 'title', 'since', 'lastAt'])
  assert.doesNotMatch(JSON.stringify(stateOf(part)), /hobkin-main|hobkin-run|\/fake\//)

  // What the engine is given on every call: the Chrome that was found, ten minutes left alone, and no call home.
  const call = engine.ranIn('hobkin-main').at(-1)!
  assert.equal(call.binary, '/fake/agent-browser')
  const env = call.options.env!
  const settings = Object.keys(env).filter((name) => name.startsWith('AGENT_BROWSER_')).sort()
  assert.deepEqual(settings, ['AGENT_BROWSER_CONFIG', 'AGENT_BROWSER_DOWNLOAD_PATH', 'AGENT_BROWSER_EXECUTABLE_PATH', 'AGENT_BROWSER_IDLE_TIMEOUT_MS', 'AGENT_BROWSER_NO_VERSION_CHECK'])
  assert.deepEqual([env.AGENT_BROWSER_EXECUTABLE_PATH, env.AGENT_BROWSER_IDLE_TIMEOUT_MS, env.AGENT_BROWSER_NO_VERSION_CHECK], ['/fake/chrome-158.0.1/Chrome', '600000', '1'])

  // Screenshots are kept in hobkin's own data folder.
  const shot = await callTool(part, { do: 'screenshot' }, '#main')
  assert.ok(shot.text.startsWith(`screenshot → ${join(root, 'browser', 'shots')}/hobkin-main-`), shot.text)
  assert.equal(existsSync(join(root, 'browser', 'shots')), true)
})

test("a cancelled call keeps what was known of the page, and one agent's calls run one after the other", async (t) => {
  const { part, engine } = await readyPart(t)
  await callTool(part, { do: 'open', url: 'http://localhost:3000' })
  const cut = await callTool(part, { do: 'read' }, '#main', AbortSignal.abort())
  assert.deepEqual(cut, { text: 'read failed: Cancelled before it finished.', failed: true })
  assert.deepEqual(stateOf(part).sessions.map(({ url, title }) => [url, title]), [[PAGE.url, PAGE.title]])

  // Started together: the second call's steps all come after the first's, on the one page they share.
  engine.commands.length = 0
  const both = await Promise.all([
    callTool(part, { steps: [{ do: 'read' }, { do: 'click', on: 'e2' }, { do: 'read', what: 'text' }] }),
    callTool(part, { steps: [{ do: 'hover', on: 'e3' }, { do: 'press', key: 'Enter' }] }),
    callTool(part, { do: 'scroll', by: 100 }, RUN),
  ])
  assert.deepEqual(both.map(({ failed }) => failed), [false, false, false])

  // Each call starts by closing the control port (`stream`), and each step is followed by asking where the browser is (`get`).
  const mainChatRan = commandNames(engine.ranIn('hobkin-main')).slice(-12)
  assert.deepEqual(mainChatRan, ['stream', 'snapshot', 'get', 'click', 'get', 'read', 'get', 'stream', 'hover', 'get', 'press', 'get'])
})

test('with no engine installed the tool says where the user installs it, and downloads nothing', async (t) => {
  const engine = fakeEngine()
  const fetched: string[] = []
  const root = temporaryFolder(t)
  const part = await partFor({
    root,
    options: {
      exec: engine.exec,
      fetch: async (url: string) => {
        fetched.push(url)
        return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }
      },
      browsersDir: join(root, 'no-browsers'),
    },
  })
  const refused = await callTool(part, { do: 'open', url: 'http://localhost:3000' })
  assert.equal(refused.failed, true)
  assert.equal(
    refused.text,
    'The browser is not installed on this computer, so nothing was opened. Tell the user: they can install it in the hobkin window, under Integrations, Browser, Install (about 400 MB). Nothing is downloaded until they do.',
  )
  // A script is told the same, as a failed call: there is no result to read.
  assert.deepEqual(await callTool(part, { do: 'read', json: true }), refused)
  assert.deepEqual(stateOf(part), { engine: { state: 'missing', version: null, chrome: null, note: null }, sessions: [] })
  assert.deepEqual(await answered<BrowserState>(part, 'browser.status'), stateOf(part))
  assert.deepEqual(await answered(part, 'browser.close'), { closed: 0 })

  assert.deepEqual(fetched, [], 'nothing was downloaded')
  assert.deepEqual(engine.calls, [], 'and nothing was run')
  assert.deepEqual(readdirSync(root), [], 'and nothing was written')

  // The guide is there all the same, and input that could not run is still said first.
  const help = await callTool(part, { do: 'help' })
  assert.equal(help.failed, false)
  assert.match(help.text, /^# The browser tool\n\n`browser_run` drives a real Chrome/)
  assert.match(help.text, /under Integrations, Browser, Install/)
  assert.equal(JSON.parse((await callTool(part, { do: 'help', json: true })).text).text, help.text)
  assert.deepEqual(await callTool(part, { do: 'click' }), { text: 'click needs `on`', failed: true })
})

test('a scripted host shows made-up state and reaches nothing real', async (t) => {
  // No engine handed in, and a data folder that must stay empty.
  const root = temporaryFolder(t)
  const part = await partFor({ root, live: false })
  part.start!()
  t.after(() => part.close!())
  const state = stateOf(part)
  assert.deepEqual(state.engine, { state: 'ready', version: '0.45.0', chrome: '158.0.8127.88', note: null })
  assert.deepEqual(state.sessions.map(({ agent, label, url }) => [agent, label, url]), [['#main', 'Main chat', 'https://app.sample.invalid/dashboard']])
  assert.deepEqual(stateOf(part), state, 'the same each time it is asked')
  assert.deepEqual(await answered<BrowserState>(part, 'browser.status'), state)

  assert.deepEqual(await callTool(part, { do: 'open', url: 'http://localhost:3000' }), { text: 'This is a scripted host, for development and tests: it runs no browser. Nothing was opened.', failed: true })
  assert.deepEqual(await run(part, 'browser.install'), { ok: false, error: { code: 'unavailable', message: 'This is a scripted host, for development and tests: it runs no browser. It installs nothing.' } })
  assert.deepEqual(await answered(part, 'browser.close'), { closed: 0 })
  assert.equal((await callTool(part, { do: 'help' })).failed, false)
  assert.deepEqual(readdirSync(root), [])
  assert.equal(part.heard.changed, 0)
})

test('closing a browser takes it out of the state: by the agent itself, by the window for one agent, or for all', async (t) => {
  const { part, engine } = await readyPart(t)
  const agents = ['#main', DURABLE, RUN, 'run-7']
  for (const agent of agents) await callTool(part, { do: 'open', url: 'http://localhost:3000' }, agent)
  assert.equal(stateOf(part).sessions.length, 4)

  // The agent closes its own.
  const changes = part.heard.changed
  assert.deepEqual(await callTool(part, { do: 'close' }, 'run-7'), { text: 'close → closed', failed: false })
  assert.deepEqual(stateOf(part).sessions.map(({ agent }) => agent).sort(), ['#main', DURABLE, RUN].sort())
  assert.equal(part.heard.changed, changes + 1)
  assert.equal(engine.sessions.has(sessionFor('run-7').name), false)

  // The window closes one agent's, by the agent as the state names it.
  assert.deepEqual(await answered(part, 'browser.close', { agent: DURABLE }), { closed: 1 })
  assert.deepEqual(engine.ranIn(DURABLE_SESSION).at(-1)!.args, ['--session', DURABLE_SESSION, '--json', 'close'])
  assert.deepEqual(stateOf(part).sessions.map(({ agent }) => agent).sort(), ['#main', RUN].sort())
  // An agent with no browser, or a name that is not an agent's, closes nothing.
  assert.deepEqual(await answered(part, 'browser.close', { agent: DURABLE }), { closed: 0 })
  assert.deepEqual(await answered(part, 'browser.close', { agent: 'hobkin-main' }), { closed: 0 })
  assert.equal(stateOf(part).sessions.length, 2)

  assert.deepEqual(await answered(part, 'browser.close'), { closed: 2 })
  assert.deepEqual(stateOf(part).sessions, [])
  assert.deepEqual([...engine.sessions], [])
  assert.deepEqual((await run(part, 'browser.close', { agent: '' })).ok, false)

  // The agent's next step gets a new browser.
  await callTool(part, { do: 'read' }, '#main')
  assert.deepEqual(stateOf(part).sessions.map(({ agent }) => agent), ['#main'])
})

test('a browser that closed itself leaves the state when the window asks again', async (t) => {
  const { part, engine } = await readyPart(t)
  await callTool(part, { do: 'read' }, '#main')
  await callTool(part, { do: 'read' }, RUN)

  // Left alone for ten minutes, the engine closed it.
  engine.sessions.delete(RUN_SESSION)
  const state = await answered<BrowserState>(part, 'browser.status')

  assert.deepEqual(state.sessions.map(({ agent }) => agent), ['#main'])
  assert.deepEqual(state.engine, READY)
  assert.deepEqual(engine.calls.at(-1)!.args, ['session', 'list', '--json'])
})

test('an engine that cannot say which browsers are open leaves the state as it is', async (t) => {
  const engine = fakeEngine()
  const cannotListSessions: Exec = async (binary, args, options) => {
    if (args[0] === 'session') return { stdout: 'not json', stderr: '', code: 1 }
    return engine.exec(binary, args, options)
  }
  const part = await partFor({
    root: temporaryFolder(t),
    options: { exec: cannotListSessions, binary: '/fake/agent-browser', chrome: '/fake/chrome' },
  })
  await callTool(part, { do: 'read' })
  engine.sessions.clear()

  const state = await answered<BrowserState>(part, 'browser.status')

  assert.equal(state.sessions.length, 1)
})

test('a stopping host closes every browser it opened, without waiting', async (t) => {
  const { part, engine } = await readyPart(t)
  part.start!()
  for (const agent of ['#main', RUN]) await callTool(part, { do: 'read' }, agent)
  const callsBefore = engine.calls.length

  part.close!()

  const closing = engine.calls.slice(callsBefore)
  assert.deepEqual(closing.map(({ args }) => args), [['--session', 'hobkin-main', 'close'], ['--session', RUN_SESSION, 'close']])
  for (const { options } of closing) {
    assert.equal(options.detached, true, 'it outlives the host')
    assert.equal(options.env!.AGENT_BROWSER_EXECUTABLE_PATH, '/fake/chrome-158.0.1/Chrome')
  }
  assert.deepEqual(stateOf(part).sessions, [])
  assert.deepEqual([...engine.sessions], [])
})

test('an engine that vanished fails the call, lists no browser, and is looked for again by the next call', async (t) => {
  const engine = fakeEngine()
  let binaryIsGone = true
  const failsWhileGone: Exec = async (binary, args, options) => {
    if (binaryIsGone && args[0] === '--session') throw Object.assign(Error('spawn /fake/agent-browser ENOENT'), { code: 'ENOENT' })
    return engine.exec(binary, args, options)
  }
  const part = await partFor({
    root: temporaryFolder(t),
    options: { exec: failsWhileGone, binary: '/fake/agent-browser', chrome: '/fake/chrome' },
  })

  const failed = await callTool(part, { do: 'read' })

  assert.deepEqual(failed, { text: 'read failed: The browser could not run: spawn /fake/agent-browser ENOENT', failed: true })
  assert.deepEqual(stateOf(part).sessions, [])

  binaryIsGone = false
  const checksBefore = versionChecks(engine.calls)
  const read = await callTool(part, { do: 'read' })

  assert.equal(read.failed, false)
  assert.equal(versionChecks(engine.calls), checksBefore + 1, 'it looked before it ran')
  assert.equal(stateOf(part).sessions.length, 1)
})

/** The tool's `json` flag, for scripts: the structured result as text, and a failed step never fails the call. */
async function toolOn(t: TestContext, answers: Parameters<typeof fakeEngine>[0] = {}) {
  const { part } = await readyPart(t, answers)
  return (args: Record<string, unknown>) => callTool(part, args)
}

test('with json the tool answers the structured result as text, and a step that fails is data, never a failed call', async (t) => {
  const tool = await toolOn(t, { click: { fail: 'Element not found: #go' } })

  const read = await tool({ steps: [{ do: 'open', url: 'http://localhost:3000' }, { do: 'read' }], json: true })
  assert.equal(read.failed, false)
  const page = JSON.parse(read.text)
  assert.deepEqual(Object.keys(page), ['ok', 'url', 'title', 'steps', 'elements'])
  assert.deepEqual([page.ok, page.url, page.title, page.elements.length], [true, PAGE.url, PAGE.title, 12])
  assert.deepEqual(page.steps.map((step: { do: string }) => step.do), ['open', 'read'])

  // A step that fails on the page, by its selector and by its words.
  const chain = { steps: [{ do: 'read', what: 'text' }, { do: 'click', on: 'css:#go' }, { do: 'read' }] }
  const missed = await tool({ ...chain, json: true })
  assert.equal(missed.failed, false, 'a script reads ok: false instead of catching an error')
  const result = JSON.parse(missed.text)
  assert.equal(result.ok, false)
  assert.deepEqual(result.error, { step: 1, do: 'click', message: 'Element not found: #go' })
  assert.equal(result.steps[0].text, '# Welcome\n\nHello.')
  const several = await tool({ do: 'hover', on: 'More', json: true })
  assert.equal(several.failed, false)
  assert.deepEqual(JSON.parse(several.text).error.candidates, [{ ref: 'e3', role: 'link', name: 'More' }, { ref: 'e4', role: 'link', name: 'More' }])

  // Without it the model reads the compact text, and the same failure is a failed call.
  const plain = await tool(chain)
  assert.equal(plain.failed, true)
  assert.match(plain.text, /click failed: Element not found: #go\nStopped at step 2 of 3; the step after it did not run\./)
  const fine = await tool({ do: 'read', json: false })
  assert.deepEqual([fine.failed, fine.text.split('\n')[0]], [false, 'read → 12 elements'])

  // Input that could not run fails the call either way, in plain words.
  for (const json of [true, false]) {
    assert.deepEqual(await tool({ do: 'fill', json }), { text: 'fill needs `on` and `text`', failed: true })
    assert.deepEqual(await tool({ do: 'open', url: 'file:///etc/passwd', json }), { text: 'The browser opens only http and https addresses, written in full, such as http://localhost:3000.', failed: true })
    assert.deepEqual(await tool({ json }), { text: '`do` is one of open, read, click, fill, press, select, hover, scroll, wait, back, forward, reload, screenshot, eval, console, close, help', failed: true })
  }
})
