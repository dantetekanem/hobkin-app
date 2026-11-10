import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INTEGRATIONS_UNKNOWN, type IntegrationsState } from '#shared/integrations/wire.ts'
import { FRESH_MS, needsLook, shownServers } from '../src/features/integrations/source.ts'
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
