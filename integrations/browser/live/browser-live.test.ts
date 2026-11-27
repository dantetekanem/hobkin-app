import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { BrowserState } from '../protocol.ts'
import { engineEnv, execFileOnce, type BrowserResult, type Exec } from '../host/engine.ts'
import { engineBinary, findChrome } from '../host/install.ts'
import { OWN_WINDOW_REFUSAL } from '../host/places.ts'
import { sessionFor } from '../host/sessions.ts'
import { answered, assertRunsAreHobkinsOwn, callTool, partFor, stateOf, until, type Call, type Part } from '../test/support.ts'
import { OWN_WINDOW_SECRET, startOwnWindow, startSite, type Site } from './site.ts'

/**
 * The browser tool against the real agent-browser and a real headless Chrome for Testing, on pages this file serves
 * itself, and one real install of the pinned engine into a folder of its own. It starts browsers and downloads the
 * engine's binary, so it is not among the tests `pnpm test` runs, and it runs only when asked:
 *
 *   HOBKIN_BROWSER_LIVE=1 node --test integrations/browser/live/browser-live.test.ts
 *
 * The engine's binary comes from HOBKIN_BROWSER_BINARY, or `agent-browser` on the PATH, and Chrome for Testing from agent-browser's own folder in
 * the user's home, which is only read: a Chrome that is not there is never downloaded by this file.
 */

const LIVE = process.env.HOBKIN_BROWSER_LIVE === '1'
const BINARY = process.env.HOBKIN_BROWSER_BINARY ?? 'agent-browser'
const BROWSERS = join(homedir(), '.agent-browser', 'browsers')
// Names of their own, so no browser of the user's or of hobkin's is touched, and a short wait so a miss fails fast.
const PREFIX = `hobkin-live-test-${process.pid}`
const WAIT_MS = 2000
const MAIN = '#main'
const WORKER = 'work-live-test-run'
const options = { binary: BINARY, sessionPrefix: PREFIX, env: { AGENT_BROWSER_DEFAULT_TIMEOUT: String(WAIT_MS) } }

let site: Site
/** A page on this computer that stands in for hobkin's own window: the part is told to keep every browser off it. */
let own: Awaited<ReturnType<typeof startOwnWindow>>
let home: string
let part: Part
const timings: Record<string, number> = {}

/** Every run of the engine the part made, as it made it. */
const runs: Call[] = []
const recording: Exec = (binary, args, given) => {
  runs.push({ binary, args, options: given })
  return execFileOnce(binary, args, given)
}

/** One command to the engine from this file itself, outside the part, and what it answered. */
async function engineSays(args: string[], env: Record<string, string> = {}): Promise<Record<string, any>> {
  const { stdout } = await execFileOnce(BINARY, [...args, '--json'], { env: engineEnv(env) })
  return (JSON.parse(stdout) as { data: Record<string, any> }).data ?? {}
}

/** The engine's own list of the sessions with a browser now. */
async function sessionsNow(): Promise<string[]> {
  const { stdout } = await execFileOnce(BINARY, ['session', 'list', '--json'], { env: engineEnv() })
  return (JSON.parse(stdout).data.sessions as string[]).filter((name) => name.startsWith(PREFIX))
}

/** A call a model makes: the compact text. It must not fail. */
async function ok(args: Record<string, unknown>, agent = MAIN): Promise<string> {
  const answer = await callTool(part, args, agent)
  assert.equal(answer.failed, false, `${JSON.stringify(args)}: ${answer.text}`)
  return answer.text
}

/** A call a script makes: the structured result, whether its steps worked or not. */
async function json(args: Record<string, unknown>, agent = MAIN): Promise<BrowserResult> {
  const answer = await callTool(part, { ...args, json: true }, agent)
  assert.equal(answer.failed, false, `with json a call does not fail: ${answer.text}`)
  return JSON.parse(answer.text) as BrowserResult
}

const pageValue = async (code: string, agent = MAIN): Promise<unknown> => (await json({ do: 'eval', code }, agent)).value
const byName = (result: BrowserResult, role: string, name: string) => result.elements!.find((element) => element.role === role && element.name === name)!

before(async () => {
  if (!LIVE) return
  assert.ok(existsSync(BINARY), `agent-browser is not at ${BINARY}`)
  assert.ok(findChrome(BROWSERS), `Chrome for Testing is not in ${BROWSERS}`)
  site = await startSite()
  own = await startOwnWindow()
  home = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-live-test-home-')))
  part = await partFor({ root: home, live: true, options: { ...options, exec: recording, refusedPlaces: [new URL(own.url).host] } })
  part.start!()
})

after(async () => {
  if (!LIVE) return
  // Whatever a test left open, this file's browsers do not outlive it.
  await answered(part, 'browser.close').catch(() => {})
  part.close!()
  for (const name of await sessionsNow()) await execFileOnce(BINARY, ['--session', name, 'close'], { env: engineEnv() })
  await site?.close()
  await own?.close()
  if (home) rmSync(home, { recursive: true, force: true })
  console.log(`timings: ${JSON.stringify(timings)}`)
})

test('the engine that is there is found, and open and read show the page', { skip: !LIVE }, async () => {
  const state = await answered<BrowserState>(part, 'browser.status')
  assert.equal(state.engine.state, 'ready')
  assert.equal(state.engine.version, '0.45.0')
  assert.match(state.engine.chrome!, /^\d+\.\d+\.\d+\.\d+$/)
  assert.deepEqual(state.sessions, [])

  assert.equal(await ok({ do: 'open', url: site.url }), `open → "Core Test Home" ${site.url}/`)
  const text = await ok({ do: 'read' })
  const lines = text.split('\n')
  assert.equal(lines[0], 'read → 18 elements')
  assert.match(lines[2]!, /^e\d+ link "About"$/)
  assert.equal(lines.at(-1), `now at "Core Test Home" ${site.url}/`)

  const page = await json({ do: 'read' })
  assert.deepEqual(Object.keys(page), ['ok', 'url', 'title', 'steps', 'elements'])
  assert.equal(page.elements!.length, 18)
  assert.equal(byName(page, 'link', 'About').href, `${site.url}/about`)
  assert.equal(byName(page, 'checkbox', 'I agree').checked, false)
  assert.equal(byName(page, 'button', 'Disabled one').disabled, true)
  assert.equal(byName(page, 'combobox', 'Color').value, 'Red')
  assert.equal((await json({ do: 'read', what: 'text', within: '#intro' })).text, 'A small page for the browser tool.')
  assert.match((await json({ do: 'read', what: 'text' })).text!, /Core test page[\s\S]*Nothing saved/)
  assert.match((await json({ do: 'read', what: 'all', within: 'nav' })).text!, /link "About" \[ref=e\d+, url=/)
  assert.match((await json({ do: 'read', within: '#missing' })).error!.message, /did not match any element/)

  // The window is told whose browser it is and where it is, and nothing of the engine's.
  assert.deepEqual(stateOf(part).sessions.map(({ agent, label, url, title }) => [agent, label, url, title]), [[MAIN, 'Main chat', `${site.url}/`, 'Core Test Home']])
  assert.deepEqual(await sessionsNow(), [`${PREFIX}-main`])
})

test('a chain fills a form by label, and stops at a step that fails saying which', { skip: !LIVE }, async () => {
  await ok({ do: 'open', url: site.url })
  const started = performance.now()
  const text = await ok({
    steps: [
      { do: 'fill', on: 'Email', text: 'a@b.c' },
      { do: 'fill', on: 'Password', text: '--secret' },
      { do: 'select', on: 'Color', option: 'Green' },
      { do: 'click', on: 'Save' },
      { do: 'wait', text: 'Saved a@b.c' },
      { do: 'read', what: 'text', within: '#out' },
    ],
  })
  timings.chainOfSixMs = Math.round(performance.now() - started)
  assert.match(text, /^fill → e\d+ textbox "Email"\nfill → e\d+ textbox "Password"\nselect → "Green" in e\d+ combobox "Color"\nclick → e\d+ button "Save"\nwait → text "Saved a@b\.c"\nread → 19 characters of text\nSaved a@b\.c \/ g \/ 8\nnow at /)
  const readStarted = performance.now()
  await ok({ do: 'read' })
  timings.singleReadMs = Math.round(performance.now() - readStarted)


  // Its third step names an element that is not there.
  const chain = {
    steps: [
      { do: 'open', url: site.url },
      { do: 'fill', on: 'Email', text: 'kept@b.c' },
      { do: 'click', on: 'css:#missing' },
      { do: 'fill', on: 'Email', text: 'never@b.c' },
    ],
  }
  const failed = await callTool(part, chain)
  assert.equal(failed.failed, true, 'the model is told the call failed')
  assert.match(failed.text, /click failed: Element not found: #missing.*\nStopped at step 3 of 4; the step after it did not run\.\nnow at "Core Test Home" /)
  assert.equal(await pageValue('document.querySelector("#email").value'), 'kept@b.c')
  // A script reads the same failure as data.
  const result = await json(chain)
  assert.equal(result.ok, false)
  assert.deepEqual([result.error!.step, result.error!.do, result.steps.length], [2, 'click', 3])
  assert.match((await json({ do: 'select', on: 'Color', option: 'Purple' })).error!.message, /option_not_found.*: Red, Green, Blue\.$/)
})

test('words must match exactly one element; a ref and a css selector name one too', { skip: !LIVE }, async () => {
  await ok({ do: 'open', url: site.url })
  const several = await json({ do: 'click', on: 'More' })
  assert.match(several.error!.message, /^2 elements are named "More"\. Use the ref of the one you mean:\ne\d+ link "More"\ne\d+ link "More"$/)
  assert.equal(several.url, `${site.url}/`, 'nothing was clicked')
  const none = await json({ do: 'click', on: 'Read the short guide' })
  assert.match(none.error!.message, /^No element is named "Read the short guide"\. The page has:\ne\d+ link "Read the long guide"\n/)
  assert.equal(none.error!.candidates!.length, 5)
  assert.match((await json({ do: 'fill', on: 'Save', text: 'x' })).error!.message, /^No field is named "Save"\. The page has:\ne\d+ textbox "Email"/)

  // Retry with the ref the failure offered, as a script would.
  const second = several.error!.candidates![1]!.ref
  const clicked = await json({ do: 'click', on: second })
  assert.deepEqual([clicked.ok, clicked.url, clicked.steps[0]!.ref], [true, `${site.url}/more?n=2`, second])

  const page = await json({ steps: [{ do: 'open', url: site.url }, { do: 'read' }] })
  const email = byName(page, 'textbox', 'Email')
  const done = await json({
    steps: [
      { do: 'fill', on: email.ref, text: 'by-ref@b.c' },
      { do: 'click', on: `@${byName(page, 'checkbox', 'I agree').ref}` },
      { do: 'fill', on: 'css:#password', text: 'by css' },
      { do: 'click', on: 'css:form button[type=submit]' },
      { do: 'eval', code: '({ out: document.querySelector("#out").textContent, agreed: document.querySelector("#agree").checked })' },
    ],
  })
  assert.deepEqual(done.value, { out: 'Saved by-ref@b.c / r / 6', agreed: true })
  // A ref does not outlive its page.
  await ok({ do: 'open', url: `${site.url}/about` })
  assert.match((await json({ do: 'click', on: email.ref })).error!.message, /Refs change when a new page loads: read again and use the new ref\.$/)
})

test('hover, press, scroll, wait, history, eval, console and screenshot act on the page', { skip: !LIVE }, async () => {
  await ok({ do: 'open', url: site.url })
  await ok({ steps: [{ do: 'hover', on: 'Hover me' }, { do: 'click', on: 'Key box' }, { do: 'press', key: 'Enter' }] })
  assert.deepEqual(await pageValue('[document.querySelector("#hovered").textContent, document.querySelector("#pressed").textContent]'), ['Hovered yes', 'Pressed Enter'])
  await ok({ do: 'press', key: 'Control+a' })
  assert.equal(await pageValue('document.querySelector("#pressed").textContent'), 'Pressed Control+a')

  const screen = (await pageValue('window.innerHeight')) as number
  assert.equal((await ok({ do: 'scroll' })).split('\n')[0], `scroll → down ${screen}px`)
  await ok({ do: 'scroll', by: -100 })
  assert.equal(await pageValue('window.scrollY'), screen - 100)
  await ok({ do: 'scroll', to: 'bottom' })
  assert.equal(await pageValue('Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight'), true)
  await ok({ do: 'scroll', to: 'top' })
  assert.equal(await pageValue('window.scrollY'), 0)
  await ok({ do: 'scroll', to: 'Bottom link' })
  assert.equal(await pageValue('(({ top, bottom }) => top >= 0 && bottom <= window.innerHeight)(document.querySelector("#bottom").getBoundingClientRect())'), true)

  // The text arrives 300ms after the click: each kind of wait sees it, and a miss says what never showed.
  await ok({ steps: [{ do: 'click', on: 'Load later' }, { do: 'wait', text: 'Loaded later' }] })
  await ok({
    steps: [
      { do: 'reload' },
      { do: 'click', on: 'Load later' },
      { do: 'wait', on: 'css:#late:not(:empty)' },
      { do: 'wait', on: 'Load later' },
      { do: 'wait', ms: 50 },
    ],
  })
  assert.equal((await json({ do: 'wait', text: 'Never on the page' })).error!.message, `Wait timed out after ${WAIT_MS}ms: text "Never on the page" never showed.`)
  assert.match((await json({ do: 'wait', on: 'Never a button' })).error!.message, new RegExp(`^No element is named "Never a button" after ${WAIT_MS}ms\\.`))

  const moved = await ok({ steps: [{ do: 'click', on: 'Bottom link' }, { do: 'wait', url: '**/about' }, { do: 'back' }, { do: 'forward' }, { do: 'reload' }] })
  assert.match(moved, new RegExp(`back → ${site.url}/\nforward → ${site.url}/about\nreload → ${site.url}/about\nnow at "About Core" ${site.url}/about$`))

  await ok({ do: 'open', url: site.url })
  assert.deepEqual(await pageValue('({ title: document.title, links: document.querySelectorAll("a").length })'), { title: 'Core Test Home', links: 5 })
  assert.equal(await pageValue('undefined'), null)
  assert.match((await json({ do: 'eval', code: 'throw new Error("boom")' })).error!.message, /Evaluation error: Error: boom/)
  // The page was opened many times by now, and still only this load's messages are there.
  const seen = await json({ do: 'console' })
  assert.deepEqual(seen.messages, [{ type: 'log', text: 'hello from the page' }, { type: 'warning', text: 'a warning from the page' }])
  assert.match(seen.errors![0]!.text, /^Error: a thrown page error/)

  // Screenshots are kept in hobkin's own data folder.
  const shot = (await json({ do: 'screenshot', full: true })).path!
  assert.ok(shot.startsWith(join(home, 'browser', 'shots', `${PREFIX}-main-`)) && shot.endsWith('.png'), shot)
  assert.equal(readFileSync(shot).subarray(1, 4).toString('latin1'), 'PNG')

  const long = await ok({ steps: [{ do: 'open', url: `${site.url}/long` }, { do: 'read' }] })
  assert.equal(long.split('\n').at(-2), '… 151 more elements. Narrow it with `within`, a CSS selector.')
})

test('open goes only to http and https pages, and a page that cannot be reached fails the step', { skip: !LIVE }, async () => {
  await ok({ do: 'open', url: site.url })
  for (const url of ['file:///etc/hosts', 'data:text/html,<h1>hi</h1>', 'javascript:alert(1)', 'localhost:3000']) {
    assert.deepEqual(await callTool(part, { do: 'open', url }), { text: 'The browser opens only http and https addresses, written in full, such as http://localhost:3000.', failed: true }, url)
  }
  assert.equal(await pageValue('location.href'), `${site.url}/`, 'the browser stayed where it was')

  // A port that was just given back: no server is there.
  const gone = await startSite()
  await gone.close()
  assert.equal((await json({ do: 'open', url: gone.url })).error!.message, 'Navigation failed: net::ERR_CONNECTION_REFUSED')
  assert.equal((await callTool(part, { do: 'help' })).text.split('\n')[0], '# The browser tool')
})

test('two agents have two browsers, a cancelled call returns at once, and closing takes a browser away', { skip: !LIVE }, async () => {
  await ok({ do: 'open', url: site.url })
  await ok({ do: 'open', url: `${site.url}/about` }, WORKER)
  const worker = sessionFor(WORKER, PREFIX).name
  assert.match(worker, new RegExp(`^${PREFIX}-run-[0-9a-f]{12}$`))
  assert.deepEqual((await sessionsNow()).sort(), [`${PREFIX}-main`, worker].sort())
  // Each stays on its own page, with its own storage.
  await pageValue('localStorage.setItem("whose", "main")')
  assert.deepEqual([await pageValue('document.title'), await pageValue('document.title', WORKER)], ['Core Test Home', 'About Core'])
  assert.equal(await pageValue('localStorage.getItem("whose")', WORKER), null)
  const listed = stateOf(part).sessions.map(({ agent, label, title }) => [agent, label, title])
  assert.deepEqual(listed, [
    [WORKER, 'work-live-te…', 'About Core'],
    [MAIN, 'Main chat', 'Core Test Home'],
  ])

  const stop = new AbortController()
  setTimeout(() => stop.abort(), 200)
  const started = performance.now()
  const cut = await callTool(part, { steps: [{ do: 'wait', ms: 5000 }, { do: 'click', on: 'About' }] }, MAIN, stop.signal)
  timings.cancelMs = Math.round(performance.now() - started)
  assert.ok(timings.cancelMs < 1500, `took ${timings.cancelMs}ms`)
  assert.deepEqual(cut, { text: 'wait failed: Cancelled before it finished.\nStopped at step 1 of 2; the step after it did not run.', failed: true })
  assert.equal(await pageValue('document.title'), 'Core Test Home', 'the click after the cancelled wait never ran')
  assert.equal(stateOf(part).sessions.find(({ agent }) => agent === MAIN)!.url, `${site.url}/`)

  // The window closes one agent's browser, and a browser the engine no longer has leaves the state when asked.
  assert.deepEqual(await answered(part, 'browser.close', { agent: WORKER }), { closed: 1 })
  assert.deepEqual(await sessionsNow(), [`${PREFIX}-main`])
  assert.deepEqual(stateOf(part).sessions.map(({ agent }) => agent), [MAIN])
  await execFileOnce(BINARY, ['--session', `${PREFIX}-main`, 'close'], { env: engineEnv() })
  assert.deepEqual((await answered<BrowserState>(part, 'browser.status')).sessions, [])

  // The agent closes its own, and a host that stops closes what is left without waiting.
  await ok({ do: 'read' }, WORKER)
  assert.equal(await ok({ do: 'close' }, WORKER), 'close → closed')
  assert.deepEqual(await sessionsNow(), [])
  await ok({ do: 'open', url: site.url })
  await ok({ do: 'open', url: site.url }, WORKER)
  assert.equal((await sessionsNow()).length, 2)
  part.close!()
  assert.deepEqual(stateOf(part).sessions, [])
  const deadline = Date.now() + 10_000
  while ((await sessionsNow()).length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
  assert.deepEqual(await sessionsNow(), [], 'no Chrome is left behind')
})

test("the engine's control port: a session left as the engine starts it can be driven from another browser, and hobkin's have none", { skip: !LIVE }, async (t) => {
  // A session as the engine starts one, outside the part: its control port is open on this computer.
  const unguarded = `${PREFIX}-unguarded`
  t.after(() => execFileOnce(BINARY, ['--session', unguarded, 'close'], { env: engineEnv() }))
  const chrome = findChrome(BROWSERS)!.path
  const asStarted = await engineSays(['--session', unguarded, 'stream', 'status'], { AGENT_BROWSER_EXECUTABLE_PATH: chrome })
  assert.equal(asStarted.enabled, true, 'the engine starts every session with it')
  assert.equal(typeof asStarted.port, 'number')

  // Two agents with a browser each, through the tool.
  await ok({ do: 'open', url: site.url })
  await ok({ do: 'open', url: `${site.url}/about` }, WORKER)
  const hobkins = [`${PREFIX}-main`, sessionFor(WORKER, PREFIX).name]

  // What the reviewer described: one agent's browser opens the port, and the page it gets may command any session.
  const reached = await json(
    {
      steps: [
        { do: 'open', url: `http://127.0.0.1:${asStarted.port}/` },
        { do: 'eval', code: "fetch('/api/sessions').then(async (response) => [response.status, await response.json()])" },
      ],
    },
    WORKER,
  )
  const [status, listed] = reached.value as [number, { session: string; port: number | null }[]]
  assert.equal(status, 200)
  assert.equal(reached.title, 'agent-browser')
  const command = "fetch('/api/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'url' }) }).then(async (response) => [response.status, (await response.json()).success])"
  assert.deepEqual(await pageValue(command, WORKER), [200, true], 'the unguarded session took a command from a page')

  // hobkin's own browsers have that port closed from their first call on, so there is nothing of theirs to open.
  for (const name of hobkins) {
    const now = await engineSays(['--session', name, 'stream', 'status'])
    assert.deepEqual([now.enabled, now.port], [false, null], name)
  }
  const stillOpen = listed.filter(({ session, port }) => hobkins.includes(session) && port)
  for (const { session, port } of stillOpen) {
    const tried = await json({ do: 'open', url: `http://127.0.0.1:${port}/` }, WORKER)
    assert.match(tried.error?.message ?? '', /ERR_CONNECTION_REFUSED/, `${session} is listed on a port nothing answers on`)
  }
  console.log(`control port: unguarded listed as ${JSON.stringify(listed.find(({ session }) => session === unguarded))}; hobkin's as ${JSON.stringify(listed.filter(({ session }) => hobkins.includes(session)))}`)

  // It stays closed across calls, and a browser started again after a close has it closed again.
  await ok({ steps: [{ do: 'close' }, { do: 'open', url: site.url }] })
  assert.equal((await engineSays(['--session', hobkins[0]!, 'stream', 'status'])).enabled, false)
  await ok({ do: 'close' }, WORKER)
})

test("a page cannot take the browser to hobkin's own window: not when asked, by a redirect, a link, a frame, a new tab or a popup", { skip: !LIVE }, async () => {
  const ownWindow = `${own.url}/`
  const waysOut = `${site.url}/ways-out?to=${encodeURIComponent(ownWindow)}`
  const taken = "That address is hobkin's own window; an agent's browser does not open it. A page sent the browser there, so it was moved to a blank page and nothing read in this call is given."
  /** Everything the tool answered in this test, to be searched for the window's words. */
  const answers: string[] = []
  const call = async (args: Record<string, unknown>) => {
    const answer = await callTool(part, args)
    answers.push(answer.text)
    return answer
  }
  const documentsAsked = () => own.asked.filter((request) => request.startsWith('document'))

  await call({ do: 'open', url: site.url })

  // Asked for by name, under any spelling of this computer: refused before the engine is asked.
  for (const url of [own.url, ownWindow.replace('127.0.0.1', 'localhost'), ownWindow.replace('127.0.0.1', '127.1'), ownWindow.replace('127.0.0.1', '[::1]')]) {
    assert.deepEqual(await call({ do: 'open', url }), { text: OWN_WINDOW_REFUSAL, failed: true }, url)
  }

  // A server that answers by redirecting there: the request is stopped in the browser.
  const redirected = await call({ do: 'open', url: `${site.url}/redirect?to=${encodeURIComponent(ownWindow)}`, json: true })
  assert.match(JSON.parse(redirected.text).error.message, /^Navigation failed: net::ERR_/)

  // A page that frames it, and a link to it in the same tab: stopped the same way. The browser ends on an error page.
  const framed = await call({ steps: [{ do: 'open', url: waysOut }, { do: 'read', what: 'all' }], json: true })
  assert.equal(JSON.parse(framed.text).ok, true)
  const followed = await call({ steps: [{ do: 'click', on: 'Same tab' }, { do: 'read', what: 'text' }], json: true })
  assert.match(JSON.parse(followed.text).url, /^chrome-error:/)
  assert.deepEqual(own.asked, [], 'no request has reached the window')

  // A link that opens a new tab: the engine moves to that tab, so the window is asked for. The step that did it
  // fails, the browser is moved off, and the button the chain went on to press is never pressed.
  await call({ do: 'open', url: waysOut })
  const newTab = await call({ steps: [{ do: 'click', on: 'New tab' }, { do: 'click', on: 'Approve' }, { do: 'read', what: 'text' }] })
  assert.deepEqual(newTab, { text: `click failed: ${taken}\nStopped at step 1 of 3; the 2 steps after it did not run.`, failed: true })
  assert.equal(stateOf(part).sessions.find(({ agent }) => agent === MAIN)!.url, 'about:blank')
  assert.equal(documentsAsked().length, 1)

  // A popup, by a button and by script: the same.
  await call({ do: 'open', url: waysOut })
  const popup = JSON.parse((await call({ steps: [{ do: 'click', on: 'Popup' }, { do: 'read', what: 'text' }], json: true })).text) as BrowserResult
  assert.deepEqual([popup.ok, popup.error!.step, popup.error!.message, popup.url, popup.text], [false, 0, taken, 'about:blank', undefined])
  await call({ do: 'open', url: site.url })
  const scripted = JSON.parse((await call({ do: 'eval', code: `window.open(${JSON.stringify(ownWindow)}); 1`, json: true })).text) as BrowserResult
  assert.deepEqual([scripted.ok, scripted.error!.message, scripted.value], [false, taken, undefined])

  // A popup on a timer opens between two calls: the next call finds the browser there and does nothing on it.
  await call({ do: 'open', url: site.url })
  await call({ do: 'eval', code: `setTimeout(() => window.open(${JSON.stringify(ownWindow)}), 150); 1` })
  await new Promise((resolve) => setTimeout(resolve, 900))
  const next = await call({ steps: [{ do: 'click', on: 'Approve' }, { do: 'read', what: 'text' }] })
  assert.deepEqual(next, { text: `click failed: ${taken}\nStopped at step 1 of 2; the step after it did not run.`, failed: true })

  // A new tab to a page like any other is followed in the browser's own tab, and the tab the page opened is closed:
  // the agent lands where the link goes, in the one tab whose requests are blocked.
  const about = `${site.url}/about`
  const followed2 = JSON.parse((await call({ steps: [{ do: 'open', url: `${site.url}/ways-out?to=${encodeURIComponent(about)}` }, { do: 'click', on: 'New tab' }, { do: 'read', what: 'text', within: 'h1' }], json: true })).text) as BrowserResult
  assert.deepEqual([followed2.ok, followed2.url, followed2.title, followed2.text], [true, about, 'About Core', 'About this site'])
  const tabs = (await engineSays(['--session', `${PREFIX}-main`, 'tab', 'list'])).tabs as { tabId: string }[]
  assert.deepEqual(tabs.map(({ tabId }) => tabId), ['t1'])

  // The agent goes on with its own pages afterwards.
  assert.equal((await call({ do: 'open', url: site.url })).text, `open → "Core Test Home" ${site.url}/`)
  // The window was asked for only by the tabs a page opened, each closed before anything was read or done in it. No
  // page the agent was on ever framed it, and no navigation of the agent's own tab reached it.
  assert.deepEqual(own.asked.filter((request) => !/^(document|image) /.test(request)), [])
  // Whatever tab reached the window, nothing it showed came back.
  for (const answer of answers) assert.equal(answer.includes(OWN_WINDOW_SECRET), false, answer.slice(0, 200))
  console.log(`own window was asked: ${JSON.stringify(own.asked)}`)
})

test("an option that looks like a switch is chosen as text, a download stays in hobkin's folder, and the clipboard is not read", { skip: !LIVE }, async () => {
  await ok({ do: 'open', url: `${site.url}/odd` })

  // The engine takes what follows `--` as text, in the middle of a command too.
  for (const option of ['--headed', '--json', 'plain']) {
    await ok({ do: 'select', on: 'Mode', option })
    assert.equal(await pageValue('document.querySelector("#mode").value'), option)
  }
  assert.deepEqual(await sessionsNow(), [`${PREFIX}-main`], 'and no other browser was started by it')

  // A page hands the browser a file: it is kept under hobkin's data folder, not in the user's Downloads.
  const name = `hobkin-live-test-${process.pid}.txt`
  await ok({ steps: [{ do: 'eval', code: `document.querySelector("#download").href = "/file.txt?name=${name}"; 1` }, { do: 'click', on: 'Download it' }, { do: 'wait', ms: 800 }] })
  assert.deepEqual(readdirSync(join(home, 'browser', 'downloads')), [name])
  assert.equal(readFileSync(join(home, 'browser', 'downloads', name), 'utf8'), 'downloaded bytes')
  assert.equal(existsSync(join(homedir(), 'Downloads', name)), false)

  // A page cannot read what the user last copied.
  const clipboard = await pageValue("navigator.clipboard.readText().then((text) => 'read: ' + text.length, (error) => 'refused: ' + error.name)")
  assert.equal(clipboard, 'refused: NotAllowedError')

  // Closing a browser that is already gone starts nothing.
  await execFileOnce(BINARY, ['--session', `${PREFIX}-main`, 'close'], { env: engineEnv() })
  assert.deepEqual(await answered(part, 'browser.close', { agent: MAIN }), { closed: 1 })
  assert.deepEqual(await sessionsNow(), [])
  assert.deepEqual(stateOf(part).sessions, [])
})

test("every run of the engine was hobkin's own, Chrome started on a short environment, and the window was told no query", { skip: !LIVE }, async () => {
  await ok({ do: 'open', url: `${site.url}/about?token=SECRET-IN-QUERY#fragment` })
  const [shown] = stateOf(part).sessions
  assert.equal(shown!.url, `${site.url}/about`)
  assert.equal((await json({ do: 'eval', code: 'location.search' })).url, `${site.url}/about?token=SECRET-IN-QUERY#fragment`, 'the agent itself is told in full')

  // Chrome was launched, many times over, by runs that carried only the allowlisted environment, hobkin's empty
  // config and hobkin's folder: nothing of the user's own engine setup, and no proxy setting.
  assert.ok(runs.length > 100, `${runs.length} runs`)
  assertRunsAreHobkinsOwn(runs, home)
  assert.equal(readFileSync(join(home, 'tools', 'browser', 'engine-config.json'), 'utf8'), '{}\n')
  for (const { options: given } of runs) assert.equal(Object.keys(given.env ?? {}).some((name) => /proxy/i.test(name)), false)
  await ok({ do: 'close' })
})

test('the pinned engine installs for real into a folder of its own, and the tool then runs it', { skip: !LIVE, timeout: 180_000 }, async (t) => {
  // Chrome for Testing is in the user's own folder already, so only the engine's binary is downloaded: about 9 MB.
  const chrome = findChrome(BROWSERS)!
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-live-test-install-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fresh = await partFor({ root, live: true, options: { sessionPrefix: `${PREFIX}-installed`, env: options.env } })
  t.after(() => fresh.close!())

  const missing = await answered<BrowserState>(fresh, 'browser.status')
  assert.deepEqual(missing.engine, { state: 'missing', version: null, chrome: chrome.version, note: null })
  assert.match((await callTool(fresh, { do: 'open', url: site.url })).text, /^The browser is not installed on this computer/)
  assert.equal(existsSync(join(root, 'tools')), false, 'a tool call downloads nothing')

  const seen: string[] = []
  fresh.heard.onChange = () => seen.push(`${stateOf(fresh).engine.state}: ${stateOf(fresh).engine.note}`)
  const started = performance.now()
  assert.equal((await answered<BrowserState>(fresh, 'browser.install')).engine.state, 'installing')
  const deadline = Date.now() + 150_000
  while (stateOf(fresh).engine.state === 'installing' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
  timings.installMs = Math.round(performance.now() - started)
  assert.deepEqual(stateOf(fresh).engine, { state: 'ready', version: '0.45.0', chrome: chrome.version, note: null }, seen.join(' | '))
  assert.deepEqual(seen.slice(0, 3), ['installing: Starting.', 'installing: Downloading agent-browser 0.45.0, 9 MB.', 'installing: Putting agent-browser 0.45.0 in place.'])
  assert.equal(seen.some((line) => line.includes('Chrome for Testing')), false, 'the Chrome that was there was not downloaded again')

  const binary = engineBinary(join(root, 'tools', 'browser'))
  assert.equal(statSync(binary).size, 20087232)
  assert.equal(statSync(binary).mode & 0o777, 0o755)
  assert.equal((await execFileOnce(binary, ['--version'], { env: engineEnv() })).stdout.trim(), 'agent-browser 0.45.0')

  // The binary that was just installed drives a real page.
  const page = JSON.parse((await callTool(fresh, { steps: [{ do: 'open', url: site.url }, { do: 'read', what: 'text', within: 'h1' }], json: true })).text) as BrowserResult
  assert.deepEqual([page.ok, page.title, page.text], [true, 'Core Test Home', 'Core test page'])
  assert.deepEqual(await answered(fresh, 'browser.close'), { closed: 1 })
  await until(() => stateOf(fresh).sessions.length === 0, 'the browser to leave the state')
})
