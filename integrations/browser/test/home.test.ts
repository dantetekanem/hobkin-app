import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrowserSession, BrowserState } from '../protocol.ts'
import { browserHome } from '../window/home.ts'
import { BROWSER_UNKNOWN, sampleBrowser } from '../window/sample.ts'

type Engine = BrowserState['engine']

const now = new Date(2026, 10, 25, 18).getTime()

/** Where the card with the Install button is, which the tile and the need both go to. */
const integrationsScreen = { to: 'screen', screen: 'integrations' }

/** The browser with its engine in this state, and the browsers the test says are open. */
function browserIn(state: Engine['state'], known: Partial<Engine> = {}, sessions: BrowserSession[] = []): BrowserState {
  return {
    engine: { state, version: null, chrome: null, note: null, ...known },
    sessions,
  }
}

/** This agent's browser, open on a made-up shop. */
function sessionOf(agent: string): BrowserSession {
  return {
    agent,
    label: agent,
    url: 'https://shop.invalid/',
    title: 'Shop',
    since: now - 60_000,
    lastAt: now - 1000,
  }
}

test('before the host has looked, the browser adds nothing to Home', () => {
  const home = browserHome(BROWSER_UNKNOWN, now)

  assert.deepEqual(home, { known: false })
})

test('a ready browser has a tile that says so, with its versions, and needs nothing', () => {
  const home = browserHome(browserIn('ready', { version: '0.45.0', chrome: '143.0.7499.40' }), now)

  assert.equal(home.known, true)
  assert.deepEqual(home.tile, {
    key: 'browser',
    name: 'Browser',
    status: 'Ready',
    tone: 'ok',
    note: 'Engine 0.45.0 · Chrome 143.0.7499.40',
    target: integrationsScreen,
  })
  assert.equal(home.needs, undefined)
  assert.equal(home.cards, undefined)
  assert.equal(home.lift, undefined)
  assert.equal(home.more, undefined)
})

test('the tile counts the browsers that are open', () => {
  const twoOpen = browserHome(browserIn('ready', {}, [sessionOf('#main'), sessionOf('run-2')]), now)
  const oneOpen = browserHome(browserIn('ready', {}, [sessionOf('#main')]), now)
  const sample = browserHome(sampleBrowser(now), now)

  assert.equal(twoOpen.tile?.status, 'Ready · 2 open')
  assert.equal(oneOpen.tile?.status, 'Ready · 1 open')
  assert.equal(sample.tile?.status, 'Ready · 2 open')
})

test('a ready browser whose versions are not known has no second line on its tile', () => {
  const home = browserHome(browserIn('ready'), now)

  assert.equal(home.tile?.note, null)
})

test('a missing engine has a quiet tile and one thing that needs the user: a row and its card, going to the card with the Install button', () => {
  const home = browserHome(browserIn('missing'), now)

  assert.equal(home.known, true)
  assert.deepEqual(home.tile, {
    key: 'browser',
    name: 'Browser',
    status: 'Not installed',
    tone: 'quiet',
    note: null,
    target: integrationsScreen,
  })

  assert.equal(home.needs?.length, 1)
  const need = home.needs![0]!
  assert.deepEqual(need.row, {
    id: 'browser:install',
    title: 'The browser for agents is not installed',
    detail: 'Agents need it to open and test pages.',
    tone: 'warn',
    aside: null,
    action: { label: 'Install', target: integrationsScreen },
  })
  assert.deepEqual(need.card, {
    id: 'browser:install',
    label: 'Browser',
    reason: 'Not installed',
    tone: 'warn',
    title: 'The browser for agents is not installed',
    detail: 'Agents need it to open and test pages.',
    primary: { label: 'Install', target: integrationsScreen },
  })
})

test('a failed install has a tile and a need of its own that say why, and offer to try again', () => {
  const tryAgain = { label: 'Try again', target: integrationsScreen }

  const home = browserHome(browserIn('failed', { note: 'The download stopped half way.' }), now)

  assert.deepEqual(home.tile, {
    key: 'browser',
    name: 'Browser',
    status: 'Install failed',
    tone: 'bad',
    note: 'The download stopped half way.',
    target: integrationsScreen,
  })

  assert.equal(home.needs?.length, 1)
  const { row, card } = home.needs![0]!
  assert.equal(row.id, 'browser:install-failed')
  assert.equal(row.title, 'The browser for agents did not install')
  assert.equal(row.detail, 'The download stopped half way.')
  assert.equal(row.tone, 'bad')
  assert.deepEqual(row.action, tryAgain)

  assert.equal(card.id, row.id)
  assert.equal(card.reason, 'Install failed')
  assert.equal(card.detail, 'The download stopped half way.')
  assert.deepEqual(card.primary, tryAgain)
})

test('a failure with no reason still says what it costs', () => {
  const home = browserHome(browserIn('failed'), now)

  assert.equal(home.tile?.note, null)
  assert.equal(home.needs![0]!.row.detail, 'Agents cannot open pages until it does.')
})

test('while it installs the tile says so with what the install is doing, and nothing waits on the user', () => {
  const home = browserHome(browserIn('installing', { note: 'Downloading Chrome' }), now)

  assert.deepEqual(home.tile, {
    key: 'browser',
    name: 'Browser',
    status: 'Installing…',
    tone: 'info',
    note: 'Downloading Chrome',
    target: integrationsScreen,
  })
  assert.equal(home.needs, undefined)

  const withNoNote = browserHome(browserIn('installing'), now)
  assert.equal(withNoNote.tile?.note, null)
})
