import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withEnabled } from '../integrations/entry.ts'
import type { PiServerEntry } from '../integrations/types.ts'

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
