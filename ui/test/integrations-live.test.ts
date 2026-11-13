import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INTEGRATIONS_UNKNOWN, type IntegrationsState } from '#shared/integrations/wire.ts'
import { FRESH_MS, needsLook, shouldLookAtServers, shownServers } from '../src/features/integrations/source.ts'
import { SAMPLE_SERVERS } from '../src/features/integrations/sample-data.ts'

const NOW = Date.parse('2026-11-10T10:00:00.000Z')
const read = (rest: Partial<IntegrationsState> = {}): IntegrationsState => ({
  ...INTEGRATIONS_UNKNOWN,
  path: '~/.pi/agent/mcp.json',
  servers: [{ name: 'notes', entry: { command: 'notes-server' }, state: 'connected', tools: [], error: null }],
  checkedAt: new Date(NOW - 5_000).toISOString(),
  ...rest,
})

test('with a host, the screen shows only what the host read from Pi, never the sample', () => {
  assert.deepEqual(
    shownServers({ live: true, pi: read(), sample: SAMPLE_SERVERS }).map(({ name }) => name),
    ['notes'],
  )
  assert.deepEqual(shownServers({ live: true, pi: INTEGRATIONS_UNKNOWN, sample: SAMPLE_SERVERS }), [], 'nothing read yet is nothing shown')
  assert.deepEqual(shownServers({ live: true, pi: null, sample: SAMPLE_SERVERS }), [], 'a host that does not read Pi shows none rather than the sample')
})

test('without a host, the screen shows the sample', () => {
  assert.equal(shownServers({ live: false, pi: null, sample: SAMPLE_SERVERS }), SAMPLE_SERVERS)
})

test('opening the screen looks at the servers when nothing was read in the last minute, and never twice at once', () => {
  assert.equal(needsLook(INTEGRATIONS_UNKNOWN, NOW), true, 'never read')
  assert.equal(needsLook(read(), NOW), false, 'read a moment ago')
  assert.equal(needsLook(read({ checkedAt: new Date(NOW - FRESH_MS - 1).toISOString() }), NOW), true, 'read over a minute ago')
  assert.equal(needsLook(read({ checking: true, checkedAt: null }), NOW), false, 'a look is under way')
  assert.equal(needsLook(null, NOW), false, 'a host that does not read Pi has nothing to look at')
})

test('Home asks the host to look at Pi once per connection, once the host has sent its empty reading', () => {
  const ask = (rest: Partial<Parameters<typeof shouldLookAtServers>[0]>) =>
    shouldLookAtServers({ connected: true, asked: false, pi: INTEGRATIONS_UNKNOWN, now: NOW, ...rest })
  assert.equal(ask({}), true, 'connected with nothing read')
  assert.equal(ask({ pi: null }), false, 'the state with the reading has not arrived yet')
  assert.equal(ask({ asked: true }), false, 'already asked on this connection')
  assert.equal(ask({ connected: false }), false, 'no connection')
  assert.equal(ask({ pi: read() }), false, 'read a moment ago')
})
