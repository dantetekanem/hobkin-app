import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogEntry } from '../integrations/catalog.ts'
import { fillValue, withEnabled } from '../integrations/entry.ts'
import type { Fill, PiServerEntry } from '../integrations/types.ts'

/** A value that is not an address, such as the client ID of an app of the person's own. */
const clientId: Fill = { key: 'client-id', label: 'Client ID of your app', example: '1234567890.1234567890' }

test('turning off keeps the entry with enabled false, and turning on takes the key away again', () => {
  const entry: PiServerEntry = { url: 'https://mcp.linear.app/mcp', description: 'Issues and projects' }
  const off = withEnabled(entry, false)
  assert.deepEqual(off, { url: 'https://mcp.linear.app/mcp', description: 'Issues and projects', enabled: false })
  assert.deepEqual(withEnabled(off, true), entry, 'on reads as it did before it was turned off')
  assert.deepEqual(entry, { url: 'https://mcp.linear.app/mcp', description: 'Issues and projects' }, 'the entry passed in is not changed')
})

test('turning on an entry that says enabled true leaves it as written', () => {
  const entry: PiServerEntry = { command: 'uvx', args: ['tools-mcp'], enabled: true }
  assert.deepEqual(withEnabled(entry, true), entry)
})

test('fields hobkin does not know are kept as they are', () => {
  const entry = { url: 'https://api.githubcopilot.com/mcp/', exposure: 'deferred', toolExposure: { 'delete_*': 'hidden' } } as PiServerEntry
  assert.deepEqual(withEnabled(entry, false), { ...entry, enabled: false })
  assert.deepEqual(withEnabled(withEnabled(entry, false), true), entry)
})

test('a filled value is trimmed, and an address loses its last slash', () => {
  const address = catalogEntry('home-assistant')!.connect.fills[0]!
  assert.deepEqual(fillValue(address, '  http://homeassistant.local:8123/ '), { value: 'http://homeassistant.local:8123' })
  assert.deepEqual(fillValue(address, 'https://house.example.org'), { value: 'https://house.example.org' })
  assert.deepEqual(fillValue(clientId, ' 1234567890.1234567890 '), { value: '1234567890.1234567890' })
})

test('a value that is missing, has spaces, or has the wrong shape is refused, with a reason', () => {
  const address = catalogEntry('home-assistant')!.connect.fills[0]!
  for (const [fill, value] of [
    [address, '   '],
    [address, 'homeassistant.local:8123'],
    [address, 'ftp://homeassistant.local'],
    [clientId, ''],
    [clientId, 'two words'],
    [clientId, '${CLIENT_SECRET}'],
    [clientId, '<client-id>'],
  ] as const) {
    const result = fillValue(fill, value)
    assert.ok('problem' in result && result.problem.trim(), `"${value}" is refused with a reason`)
  }
})
