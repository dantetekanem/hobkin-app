import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ConfiguredServer } from '#shared/integrations/types.ts'
import { remove, retry, settle, signIn, turnOff, turnOn } from '../src/features/integrations/changes.ts'
import { itemsOf } from '../src/features/integrations/items.ts'
import { SAMPLE_SERVERS } from '../src/features/integrations/sample-data.ts'

function only(servers: readonly ConfiguredServer[], name: string): ConfiguredServer {
  const found = servers.filter((server) => server.name === name)
  assert.equal(found.length, 1, `one server called ${name}`)
  return found[0]!
}

const connecting: ConfiguredServer[] = [{ name: 'tickets', entry: { url: 'https://tickets.example.com/mcp' }, state: 'connecting', tools: [], error: null }]
const tools = [{ name: 'search', does: 'Searches', effect: 'reads' as const }]

test('a connection settles into sign-in or connected, and a connected server brings its tools', () => {
  assert.equal(only(settle(connecting, 'tickets', 'sign-in', tools), 'tickets').state, 'sign-in')
  assert.deepEqual(only(settle(connecting, 'tickets', 'sign-in', tools), 'tickets').tools, [], 'a server waiting for sign-in has none')
  const connected = only(settle(connecting, 'tickets', 'connected', tools), 'tickets')
  assert.equal(connected.state, 'connected')
  assert.deepEqual(connected.tools, tools)
})

test('settling leaves alone a server that is no longer connecting', () => {
  const off = turnOff(connecting, 'tickets')
  assert.deepEqual(settle(off, 'tickets', 'connected', tools), off, 'turned off while it was connecting')
  assert.deepEqual(settle(remove(connecting, 'tickets'), 'tickets', 'connected', []), [], 'removed while it was connecting')
})

test('signing in and trying again go back to connecting, and only from their own state', () => {
  const waiting = settle(connecting, 'tickets', 'sign-in', [])
  assert.equal(only(signIn(waiting, 'tickets'), 'tickets').state, 'connecting')

  const failed: ConfiguredServer[] = [{ name: 'wiki', entry: { url: 'https://wiki.example.com/mcp' }, state: 'failed', tools: [], error: 'Request timed out.' }]
  const retried = only(retry(failed, 'wiki'), 'wiki')
  assert.equal(retried.state, 'connecting')
  assert.equal(retried.error, null, 'the old message goes')

  assert.deepEqual(signIn(failed, 'wiki'), failed, 'a failed server is tried again, not signed in')
  assert.deepEqual(retry(waiting, 'tickets'), waiting, 'a server waiting for sign-in is signed in, not tried again')
})

test('turning off keeps the entry with enabled false, and turning on takes it away and connects again', () => {
  const connected = settle(connecting, 'tickets', 'connected', tools)
  const off = only(turnOff(connected, 'tickets'), 'tickets')
  assert.equal(off.state, 'off')
  assert.equal(off.entry.enabled, false)

  const on = only(turnOn(turnOff(connected, 'tickets'), 'tickets'), 'tickets')
  assert.equal(on.state, 'connecting')
  assert.ok(!('enabled' in on.entry), 'the entry reads as it did before')
})

test('removing a server takes it out of the list', () => {
  const after = remove(SAMPLE_SERVERS, 'docs')
  assert.equal(after.length, SAMPLE_SERVERS.length - 1)
  assert.ok(!after.some((server) => server.name === 'docs'))
})

test('the sample has servers connected, waiting for sign-in, failed and off, each with what it needs to be shown', () => {
  const states = SAMPLE_SERVERS.map((server) => server.state)
  for (const state of ['connected', 'sign-in', 'failed', 'off'] as const) assert.ok(states.includes(state), state)
  assert.ok(SAMPLE_SERVERS.find((server) => server.state === 'failed')?.error, 'the failed one carries a message')
  assert.ok(SAMPLE_SERVERS.every((server) => server.state !== 'connected' || server.tools.length > 0), 'a connected server has tools')
  assert.ok(SAMPLE_SERVERS.some((server) => 'command' in server.entry) && SAMPLE_SERVERS.some((server) => 'url' in server.entry), 'local and remote servers')
})

test('each server is one item, keyed by its name, in the order of the file', () => {
  const items = itemsOf(SAMPLE_SERVERS)
  assert.deepEqual(items.map((item) => item.key), SAMPLE_SERVERS.map((server) => server.name))
  assert.equal(items[0]?.server, SAMPLE_SERVERS[0])
})
