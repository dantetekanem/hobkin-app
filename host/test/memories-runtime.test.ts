import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { MemoryForgot, MemoryList, MemoryNowChanged, MemorySaved } from '#shared/protocol/memory.ts'
import { runCommand } from '../src/commands.ts'
import { memoryHandlers, memoryOperationsAt } from '../src/memories.ts'
import { temporaryDirectory } from './support.ts'

// hobkin's own memory functions (its src/cli/memory-window.mjs) on a temporary home. Invented memories.

async function window(t: import('node:test').TestContext) {
  const root = temporaryDirectory(t)
  const handlers = memoryHandlers({ operations: () => memoryOperationsAt(root) })
  const run = async <Value>(name: string, args: unknown): Promise<Value> => {
    const outcome = await runCommand(handlers, name, args)
    assert.ok(outcome.ok, JSON.stringify(outcome))
    return outcome.value as Value
  }
  return { root, run }
}

test("the window's add, change, forget and undo go through hobkin's runtime as the user's own, from the window", async (t) => {
  const { root, run } = await window(t)
  assert.deepEqual((await run<MemoryList>('memory.list', {})).memories, [])

  const added = await run<MemorySaved>('memory.save', { description: 'Lives in Lisbon since 2025; use Portuguese sites first', kind: 'user', text: 'The user lives in Lisbon.' })
  assert.ok(added.saved, JSON.stringify(added))
  const { memory } = added
  assert.match(memory.name, /^lives-in-lisbon/)
  assert.equal(memory.added?.by?.kind, 'user')
  assert.equal(memory.source?.kind, 'window')
  assert.ok(memory.version && added.change)
  assert.ok(existsSync(join(root, 'memories', `${memory.name}.md`)), 'kept in the home it was given')

  const changed = await run<MemorySaved>('memory.save', { name: memory.name, description: 'Lives in Lisbon since 2024', kind: 'user', version: memory.version })
  assert.ok(changed.saved, JSON.stringify(changed))
  assert.equal(changed.memory.changed?.by?.kind, 'user')
  assert.equal(changed.memory.added?.at, memory.added?.at, 'a change keeps who added it and when')

  const stale = await run<MemorySaved>('memory.save', { name: memory.name, description: 'Lives in Porto', kind: 'user', version: memory.version })
  assert.deepEqual(stale, { saved: false, message: 'This memory changed since you opened it, so your change was not saved. Your draft is kept: look at the memory as it is now, then save again.' })

  const forgot = await run<MemoryForgot>('memory.forget', { name: memory.name, version: changed.memory.version })
  assert.ok(forgot.forgot, JSON.stringify(forgot))
  assert.deepEqual((await run<MemoryList>('memory.list', {})).memories, [])
  assert.deepEqual(await run('memory.undo', { change: forgot.change }), { ok: true })
  const [back] = (await run<MemoryList>('memory.list', {})).memories
  assert.equal(back?.description, 'Lives in Lisbon since 2024')
})

test('a private memory is listed for the window as private, and the right-now list changes by its version', async (t) => {
  const { root, run } = await window(t)
  const kept = await run<MemorySaved>('memory.save', { name: 'partner-name', description: 'Partner is called Ana', kind: 'user', private: true })
  assert.ok(kept.saved, JSON.stringify(kept))
  assert.deepEqual(readdirSync(join(root, 'memories', 'private')), ['partner-name.md'])
  assert.equal((await run<MemoryList>('memory.list', {})).memories[0]?.private, true)

  const { now, nowVersion } = await run<MemoryList>('memory.list', {})
  assert.deepEqual(now, [])
  assert.match(nowVersion ?? '', /^[0-9a-f]{64}$/)
  const added = await run<MemoryNowChanged>('memory.now.change', { action: 'add', text: 'Book the dentist', version: nowVersion })
  assert.ok(added.ok, JSON.stringify(added))
  assert.deepEqual(added.now, ['Book the dentist'])
  assert.notEqual(added.nowVersion, nowVersion)
  const again = await run<MemoryNowChanged>('memory.now.change', { action: 'add', text: 'Reply to the landlord', version: nowVersion })
  assert.equal(again.ok, false, 'the version it was read at has moved on')
})
