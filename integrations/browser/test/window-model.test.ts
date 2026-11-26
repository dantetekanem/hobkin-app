import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BrowserSession, BrowserState } from '../protocol.ts'
import {
  browserCard,
  closeBrowsers,
  closedWords,
  engineLine,
  enginePill,
  INSTALL_SAYS,
  installButton,
  NO_PAGE,
  NONE_OPEN,
  openWords,
  reasonOf,
  SAMPLE_CLOSE,
  sessionLine,
  versionsLine,
  type CloseCommand,
  type EngineState,
} from '../window/model.ts'
import { BROWSER_UNKNOWN, sampleBrowser } from '../window/sample.ts'

type Engine = BrowserState['engine']

const now = new Date(2026, 10, 25, 18).getTime()
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const STATES: EngineState[] = ['unknown', 'missing', 'installing', 'ready', 'failed']

/** An engine in this state, with nothing known of it but what the test says. */
function engineIn(state: EngineState, known: Partial<Engine> = {}): Engine {
  return { state, version: null, chrome: null, note: null, ...known }
}

/** The browser with its engine in this state, and the browsers the test says are open. */
function browserIn(state: EngineState, known: Partial<Engine> = {}, sessions: BrowserSession[] = []): BrowserState {
  return { engine: engineIn(state, known), sessions }
}

/** The main chat's browser on a shop's cart, last used two minutes ago, but for what the test changes. */
function session(changed: Partial<BrowserSession> = {}): BrowserSession {
  return {
    agent: '#main',
    label: 'Main chat',
    url: 'https://shop.invalid/cart',
    title: 'Your cart',
    since: now - 10 * MINUTE,
    lastAt: now - 2 * MINUTE,
    ...changed,
  }
}

test('each engine state has its pill and its line under the name', () => {
  const said = STATES.map((state) => ({ state, pill: enginePill(state), line: engineLine(state) }))

  assert.deepEqual(said, [
    { state: 'unknown', pill: { label: 'Looking', tone: 'quiet', busy: true }, line: 'Looking for the browser' },
    { state: 'missing', pill: { label: 'Not installed', tone: 'warn', busy: false }, line: 'The browser for agents is not installed' },
    { state: 'installing', pill: { label: 'Installing', tone: 'quiet', busy: true }, line: 'Installing the browser for agents' },
    { state: 'ready', pill: { label: 'Ready', tone: 'ok', busy: false }, line: 'Agents open and test pages in a Chrome of their own' },
    { state: 'failed', pill: { label: 'Install failed', tone: 'bad', busy: false }, line: 'The browser for agents did not install' },
  ])
})

test('the button says Install while the engine is missing and Try again after a failure, and is not there otherwise', () => {
  const buttons = Object.fromEntries(STATES.map((state) => [state, installButton(state)]))

  assert.deepEqual(buttons, {
    unknown: null,
    missing: 'Install',
    installing: null,
    ready: null,
    failed: 'Try again',
  })
})

test('the versions line names what is there, and is not there while nothing is known', () => {
  assert.equal(versionsLine({ version: '0.45.0', chrome: '143.0.7499.40' }), 'Engine 0.45.0 · Chrome 143.0.7499.40')
  assert.equal(versionsLine({ version: '0.45.0', chrome: null }), 'Engine 0.45.0')
  assert.equal(versionsLine({ version: null, chrome: '143.0.7499.40' }), 'Chrome 143.0.7499.40')
  assert.equal(versionsLine({ version: null, chrome: null }), null)
})

test('what installing does is said once, in plain words, with what it downloads, how much and where', () => {
  const facts = ['agent-browser', 'Chrome for Testing', 'about 400 MB', "hobkin's folder", '~/.agent-browser', 'no sign-ins']
  for (const fact of facts) {
    assert.ok(INSTALL_SAYS.includes(fact), fact)
  }

  const timesNamed = INSTALL_SAYS.split('agent-browser').length - 1
  assert.equal(timesNamed, 2, 'agent-browser is named as the engine and in its folder, no more')
})

test("an open browser's row says whose it is, the page it is on and how long ago it was used", () => {
  const line = sessionLine(session(), now)

  assert.deepEqual(line, {
    agent: '#main',
    label: 'Main chat',
    page: 'Your cart',
    used: '2 min ago',
    address: 'https://shop.invalid/cart',
    closeLabel: 'Close the browser of Main chat',
  })
})

test('a page with no title is named by the host of its address, and a browser with no page says so', () => {
  const pageOf = (changed: Partial<BrowserSession>) => sessionLine(session(changed), now).page

  assert.equal(pageOf({ title: null }), 'shop.invalid')
  assert.equal(pageOf({ title: '  ', url: 'http://localhost:5173/settings' }), 'localhost:5173')
  assert.equal(pageOf({ title: null, url: null }), NO_PAGE)
  assert.equal(pageOf({ title: null, url: 'about:blank' }), NO_PAGE)
  assert.equal(pageOf({ title: null, url: 'not an address' }), NO_PAGE)
})

test('how long ago a browser was used is said in the short style of the app, and never as a time to come', () => {
  const usedAgo = (ago: number) => sessionLine(session({ lastAt: now - ago }), now).used

  assert.equal(usedAgo(0), 'just now')
  assert.equal(usedAgo(40 * SECOND), '40s ago')
  assert.equal(usedAgo(6 * MINUTE), '6 min ago')
  assert.equal(usedAgo(3 * HOUR), '3 h ago')
  assert.equal(usedAgo(2 * DAY), '2 d ago')

  const usedInFiveMinutes = usedAgo(-5 * MINUTE)
  assert.equal(usedInFiveMinutes, 'just now')
})

test('the count of open browsers and what closing answered', () => {
  assert.equal(openWords(2), '2 open')

  assert.equal(closedWords(0), 'No browser was open.')
  assert.equal(closedWords(1), 'Closed 1 browser.')
  assert.equal(closedWords(3), 'Closed 3 browsers.')
})

test("a refusal is read in the host's own words", () => {
  assert.equal(reasonOf(new Error('There is no build for this Mac.')), 'There is no build for this Mac.')
  assert.equal(reasonOf('no'), 'no')
})

test("closing asks the host for one agent's browser or for all of them, and says how many it closed", async () => {
  const asked: { agent?: string }[] = []
  const command: CloseCommand = async (args) => {
    asked.push(args)
    return { closed: args.agent ? 1 : 2 }
  }

  const one = await closeBrowsers({ live: true, command, agent: '#main' })
  const all = await closeBrowsers({ live: true, command })

  assert.deepEqual(one, { tone: 'done', text: 'Closed 1 browser.' })
  assert.deepEqual(all, { tone: 'done', text: 'Closed 2 browsers.' })
  assert.deepEqual(asked, [{ agent: '#main' }, {}])
})

test("a close the host refuses says the host's reason, and with no host nothing is asked", async () => {
  const refuses: CloseCommand = async () => {
    throw new Error('hobkin is not open.')
  }

  const refused = await closeBrowsers({ live: true, command: refuses })
  const withNoHost = await closeBrowsers({ live: false, command: refuses, agent: '#main' })

  assert.deepEqual(refused, { tone: 'refused', text: 'hobkin is not open.' })
  assert.deepEqual(withNoHost, { tone: 'done', text: SAMPLE_CLOSE })
})

test('before the first look the card only says it is looking', () => {
  const card = browserCard(BROWSER_UNKNOWN, now)

  assert.deepEqual(card, {
    pill: { label: 'Looking', tone: 'quiet', busy: true },
    line: 'Looking for the browser',
    versions: null,
    button: null,
    explains: null,
    progress: null,
    failure: null,
    sessions: [],
    open: null,
    empty: null,
  })
})

test('a missing engine offers Install and says what installing does', () => {
  const card = browserCard(browserIn('missing'), now)

  assert.equal(card.button, 'Install')
  assert.equal(card.explains, INSTALL_SAYS)
  assert.equal(card.progress, null)
  assert.equal(card.failure, null)
  assert.equal(card.empty, null)
})

test('while it installs the card has no button and says what the install is doing', () => {
  const card = browserCard(browserIn('installing', { note: 'Downloading Chrome, 120 of 180 MB' }), now)

  assert.equal(card.button, null)
  assert.equal(card.explains, null)
  assert.equal(card.progress, 'Downloading Chrome, 120 of 180 MB')
  assert.equal(card.failure, null)
  assert.equal(card.empty, null)

  const withNoNote = browserCard(browserIn('installing'), now)
  assert.equal(withNoNote.progress, null)
})

test('a failed install offers Try again, says why it failed and says again what installing does', () => {
  const card = browserCard(browserIn('failed', { note: 'The download stopped half way.' }), now)

  assert.equal(card.button, 'Try again')
  assert.equal(card.explains, INSTALL_SAYS)
  assert.equal(card.progress, null)
  assert.equal(card.failure, 'The download stopped half way.')
  assert.equal(card.empty, null)

  const withNoReason = browserCard(browserIn('failed'), now)
  assert.equal(withNoReason.failure, null)
})

test('a ready engine with nothing open has no button, its versions and a quiet line', () => {
  const card = browserCard(browserIn('ready', { version: '0.45.0', chrome: '143.0.7499.40' }), now)

  assert.equal(card.button, null)
  assert.equal(card.explains, null)
  assert.equal(card.versions, 'Engine 0.45.0 · Chrome 143.0.7499.40')
  assert.deepEqual(card.sessions, [])
  assert.equal(card.open, null)
  assert.equal(card.empty, NONE_OPEN)
})

test('a ready engine lists the open browsers in the order the host gave, with how many', () => {
  const mainChat = session()
  const aRun = session({ agent: 'run-2', label: 'hobkin 1dd62269', title: null, lastAt: now - 9 * MINUTE })

  const card = browserCard(browserIn('ready', {}, [mainChat, aRun]), now)

  const rows = card.sessions.map((line) => ({ agent: line.agent, label: line.label, page: line.page, used: line.used }))
  assert.deepEqual(rows, [
    { agent: '#main', label: 'Main chat', page: 'Your cart', used: '2 min ago' },
    { agent: 'run-2', label: 'hobkin 1dd62269', page: 'shop.invalid', used: '9 min ago' },
  ])
  assert.equal(card.open, '2 open')
  assert.equal(card.empty, null)
})

test('a note the host left behind is not shown as progress or as a failure once the engine is ready', () => {
  const card = browserCard(browserIn('ready', { note: 'Done.' }), now)

  assert.equal(card.progress, null)
  assert.equal(card.failure, null)
})

test('the state before the host has looked is an unknown engine and no open browser', () => {
  assert.deepEqual(BROWSER_UNKNOWN, {
    engine: { state: 'unknown', version: null, chrome: null, note: null },
    sessions: [],
  })
})

test('the sample is made up: ready, two browsers open on addresses that reach nothing real, used before now', () => {
  const sample = sampleBrowser(now)

  assert.equal(sample.engine.state, 'ready')
  assert.equal(sample.sessions.length, 2)

  for (const { url, since, lastAt } of sample.sessions) {
    const { hostname } = new URL(url!)
    const reachesNothingReal = hostname === 'localhost' || hostname.endsWith('.invalid')
    assert.ok(reachesNothingReal, hostname)
    assert.ok(since <= lastAt && lastAt <= now)
  }

  const lastUses = sample.sessions.map((one) => one.lastAt)
  const newestFirst = [...lastUses].sort((left, right) => right - left)
  assert.deepEqual(lastUses, newestFirst, 'newest use first')
})
