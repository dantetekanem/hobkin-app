import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogEntry } from '#shared/integrations/catalog.ts'
import { splitServers } from '#shared/integrations/servers.ts'
import type { CatalogEntry, ConfiguredServer } from '#shared/integrations/types.ts'
import { begin, fillProblems, outcomeOf, remove, retry, settle, signIn, toolsOf, turnOff, turnOn } from '../src/features/integrations/changes.ts'
import { itemsOf } from '../src/features/integrations/items.ts'
import { SAMPLE_SERVERS } from '../src/features/integrations/sample-data.ts'

const linear = catalogEntry('linear')!
const sentry = catalogEntry('sentry')!
const homeAssistant = catalogEntry('home-assistant')!

function only(servers: readonly ConfiguredServer[], name: string): ConfiguredServer {
  const found = servers.filter((server) => server.name === name)
  assert.equal(found.length, 1, `one server called ${name}`)
  return found[0]!
}

test('connecting a service adds its entry under a free name, connecting, with nothing known yet', () => {
  const begun = begin([], linear, {})
  assert.ok(begun)
  assert.equal(begun.name, 'linear')
  assert.deepEqual(only(begun.servers, 'linear'), { name: 'linear', entry: { url: 'https://mcp.linear.app/mcp' }, state: 'connecting', tools: [], error: null })

  const again = begin(begun.servers, linear, {})
  assert.equal(again?.name, 'linear-2', 'a second one for another account gets its own name')
})

test('what a person fills in is written into the entry, and a missing or wrong value stops the connection', () => {
  assert.deepEqual(fillProblems(homeAssistant, { address: ' http://homeassistant.local:8123/ ' }), {})
  const begun = begin([], homeAssistant, { address: ' http://homeassistant.local:8123/ ' })
  assert.deepEqual(begun?.servers[0]?.entry, { url: 'http://homeassistant.local:8123/api/mcp' })

  assert.deepEqual(Object.keys(fillProblems(homeAssistant, {})), ['address'], 'the missing value is named')
  assert.equal(begin([], homeAssistant, {}), null)
  assert.equal(begin([], homeAssistant, { address: 'not an address' }), null)
})

test('a service Pi cannot use is not connected', () => {
  const blocked: CatalogEntry = { ...linear, usable: false, blocked: 'Pi cannot reach it.' }
  assert.equal(begin([], blocked, {}), null)
})

test('a service that signs in through the browser asks for sign-in once it connects, and one with a key is connected', () => {
  const keyed: CatalogEntry = { ...linear, connect: { ...linear.connect, kind: 'header' } }
  assert.equal(outcomeOf(linear), 'sign-in')
  assert.equal(outcomeOf(keyed), 'connected')

  const connecting = begin([], linear, {})!.servers
  assert.deepEqual(only(settle(connecting, 'linear', 'sign-in', toolsOf(linear)), 'linear').state, 'sign-in')
  const connected = only(settle(connecting, 'linear', 'connected', toolsOf(sentry)), 'linear')
  assert.equal(connected.state, 'connected')
  assert.equal(connected.tools.length, sentry.tools.length, 'it brings its tools')
})

test('settling leaves alone a server that is no longer connecting', () => {
  const connecting = begin([], linear, {})!.servers
  const off = turnOff(connecting, 'linear')
  assert.deepEqual(settle(off, 'linear', 'connected', toolsOf(linear)), off, 'turned off while it was connecting')
  assert.deepEqual(settle(remove(connecting, 'linear'), 'linear', 'connected', []), [], 'removed while it was connecting')
})

test('signing in and trying again go back to connecting, and only from their own state', () => {
  const waiting = settle(begin([], linear, {})!.servers, 'linear', 'sign-in', [])
  assert.equal(only(signIn(waiting, 'linear'), 'linear').state, 'connecting')

  const failed: ConfiguredServer[] = [{ name: 'notion', entry: { url: 'https://mcp.notion.com/mcp' }, state: 'failed', tools: [], error: 'Request timed out.' }]
  const retried = only(retry(failed, 'notion'), 'notion')
  assert.equal(retried.state, 'connecting')
  assert.equal(retried.error, null, 'the old message goes')

  assert.deepEqual(signIn(failed, 'notion'), failed, 'a failed server is tried again, not signed in')
  assert.deepEqual(retry(waiting, 'linear'), waiting, 'a server waiting for sign-in is signed in, not tried again')
})

test('turning off keeps the entry with enabled false, and turning on takes it away and connects again', () => {
  const connected = settle(begin([], sentry, {})!.servers, 'sentry', 'connected', toolsOf(sentry))
  const off = only(turnOff(connected, 'sentry'), 'sentry')
  assert.equal(off.state, 'off')
  assert.equal(off.entry.enabled, false)

  const on = only(turnOn(turnOff(connected, 'sentry'), 'sentry'), 'sentry')
  assert.equal(on.state, 'connecting')
  assert.ok(!('enabled' in on.entry), 'the entry reads as it did before')
})

test('removing a service puts it back in the catalog, and removing one of the person\'s own takes it away', () => {
  const before = splitServers(SAMPLE_SERVERS)
  const after = splitServers(remove(SAMPLE_SERVERS, 'stripe'))
  assert.ok(before.connected.some((item) => item.entry.id === 'stripe'))
  assert.ok(!after.connected.some((item) => item.entry.id === 'stripe'))
  assert.ok(after.available.some((entry) => entry.id === 'stripe'))

  assert.equal(splitServers(remove(SAMPLE_SERVERS, 'docs')).own.length, before.own.length - 1)
})

test('the sample splits into three connected, one each needing sign-in, failed and off, and two of the person\'s own', () => {
  const split = splitServers(SAMPLE_SERVERS)
  const stateOf = (id: string) => split.connected.find((item) => item.entry.id === id)?.server.state
  for (const id of ['atlassian', 'sentry', 'home-assistant']) assert.equal(stateOf(id), 'connected', id)
  assert.deepEqual(
    split.connected.filter((item) => item.server.state !== 'connected').map((item) => item.server.state).sort(),
    ['failed', 'off', 'sign-in'],
  )
  assert.ok(split.connected.find((item) => item.server.state === 'failed')?.server.error, 'the failed one carries a message')
  assert.deepEqual(split.own.map((server) => ('command' in server.entry ? 'command' : 'remote')).sort(), ['command', 'remote'])
  assert.ok(split.own.every((server) => server.tools.length > 0), 'each of the person\'s own servers has tools')
  assert.ok(SAMPLE_SERVERS.every((server) => server.state !== 'connected' || server.tools.length > 0), 'a connected server has tools')
})

test('a service keeps its key when it moves between the catalog and the connected part, so its tile can travel', () => {
  const keysOf = (servers: readonly ConfiguredServer[]) => {
    const items = itemsOf(splitServers(servers))
    return { connected: items.connected.map((item) => item.key), available: items.available.map((item) => item.key), own: items.own.map((item) => item.key) }
  }
  const before = keysOf([])
  assert.ok(before.available.includes('linear'))
  const after = keysOf(begin([], linear, {})!.servers)
  assert.deepEqual(after.connected, ['linear'])
  assert.ok(!after.available.includes('linear'))

  const renamed = keysOf([{ name: 'house', entry: { url: 'http://ha.local:8123/api/mcp' }, state: 'connected', tools: [], error: null }])
  assert.deepEqual(renamed.own, ['own~house'], 'a server the catalog does not know is keyed apart from catalog services')
  const twice = begin(begin([], linear, {})!.servers, linear, {})!.servers
  assert.deepEqual(keysOf(twice).connected, ['linear', 'linear~linear-2'], 'two servers for one service have keys of their own')
})

test('GitHub has a page of its own, so it is no MCP item: a GitHub MCP server the person configured is one of their own', () => {
  const githubServer: ConfiguredServer = { name: 'github', entry: { url: 'https://api.githubcopilot.com/mcp/' }, state: 'connected', tools: [], error: null }

  const items = itemsOf(splitServers([githubServer]))

  assert.equal(catalogEntry('github'), null, 'GitHub connects through gh, so the MCP catalog has no entry for it')
  assert.deepEqual(items.own.map((item) => item.key), ['own~github'])
  assert.deepEqual(items.connected, [], 'and no catalog service is connected')
})
