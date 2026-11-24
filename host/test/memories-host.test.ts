import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MemoryList, MemorySaved } from '#shared/protocol/memory.ts'
import { afterTest, Client, hostFor } from './support.ts'

test("the window lists and saves memories through the host, in the home's own folder", async (t) => {
  const host = await hostFor(t)
  const window = await Client.connect(host)
  afterTest(t, () => window.close())
  await window.live()

  const empty = await window.command('memory.list', {})
  assert.ok(empty.ok, JSON.stringify(empty))
  assert.deepEqual((empty.value as MemoryList).memories, [], 'a new home remembers nothing yet')

  const saved = await window.command('memory.save', { description: 'Prefers the train under 600 km', kind: 'preference' })
  assert.ok(saved.ok && (saved.value as MemorySaved).saved, JSON.stringify(saved))
  const listed = await window.command('memory.list', {})
  assert.deepEqual(
    (listed.ok ? (listed.value as MemoryList).memories : []).map(({ description, kind }) => ({ description, kind })),
    [{ description: 'Prefers the train under 600 km', kind: 'preference' }],
  )
})
