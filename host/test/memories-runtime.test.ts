import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { remember } from 'hobkin/src/cli/inbox.mjs'
import { resolveDataRoot } from 'hobkin/src/cli/migration/admission.mjs'
import type { MemoryForgot, MemoryList, MemoryNowChanged, MemorySaved } from '#shared/protocol/memory.ts'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import { runCommand } from '../src/commands.ts'
import { memoryHandlers, memoryOperationsAt } from '../src/memories.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

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

test("a memory an agent saves reaches the window as a quiet line with its note, and the snapshot's stamp moves with every change", async (t) => {
  const host = await hostFor(t)
  const window = await Client.connect(host)
  afterTest(t, () => window.close())
  const first = await window.live()
  const stampAtStart = first.snapshot.memoriesStamp
  assert.match(String(stampAtStart), /^[0-9a-f]{16}$/)

  // Another of the user's sessions, here a Claude Code one, hands hobkin a fact with `hobkin remember`, which saves it at once.
  const handed = remember(resolveDataRoot(host.root), { words: ['The', 'user', 'lives', 'in', 'Lisbon'], from: 'Claude Code' }, Date.now(), { env: {} })
  assert.ok(handed.memory, handed.message)
  await window.command('app.refresh', {})

  const noted = (message: ChatMessage) => message.memory?.name === handed.memory
  const seen = await window.until((view) => view.messages.some(noted) && view.snapshot.memoriesStamp !== stampAtStart, 'the quiet line and a new stamp')
  const line = seen.messages.find(noted)!
  assert.equal(line.role, 'notice')
  assert.equal(line.tone, 'quiet')
  assert.equal(line.content, 'Remembered from another session (Claude Code): The user lives in Lisbon')
  assert.deepEqual(Object.keys(line.memory!).sort(), ['change', 'did', 'name'])
  assert.equal(line.memory!.did, 'added')
  const stampAfterAdd = seen.snapshot.memoriesStamp

  // What another session saved is not kept until the user or the main chat keeps it, and the user keeps it by saving it.
  const listMemory = async () => {
    const listed = await window.command('memory.list', {})
    return (listed.ok ? (listed.value as MemoryList).memories : []).find(({ name }) => name === handed.memory)
  }
  const unkept = await listMemory()
  assert.equal(unkept?.unconfirmed, true)
  const { name, description, text, kind, version } = unkept!
  const keptBy = await window.command('memory.save', { name, description, text, kind, version })
  assert.ok(keptBy.ok && (keptBy.value as MemorySaved).saved, JSON.stringify(keptBy))
  const kept = keptBy.value as Extract<MemorySaved, { saved: true }>
  assert.equal(kept.memory.unconfirmed, undefined)
  assert.equal((await listMemory())?.unconfirmed, undefined)

  // The line's change is one hobkin knows, which the keep has moved past; the keep's own change can be taken back.
  await window.command('app.refresh', {})
  const stampAfterKeep = (await window.until((view) => view.snapshot.memoriesStamp !== stampAfterAdd, 'a stamp after the keep')).snapshot.memoriesStamp
  const tooLate = await window.command('memory.undo', { change: line.memory!.change })
  assert.deepEqual(tooLate.ok && tooLate.value, { ok: false, reason: `"${handed.memory}" changed since; edit it instead.` })
  const undone = await window.command('memory.undo', { change: kept.change })
  assert.deepEqual(undone.ok && undone.value, { ok: true })
  await window.command('app.refresh', {})
  // The view is the window's live one, so each stamp is taken as it is then.
  const stampAfterUndo = (await window.until((view) => view.snapshot.memoriesStamp !== stampAfterKeep, 'a stamp after the undo')).snapshot.memoriesStamp

  // A change to the right-now list moves it as well.
  const listed = await window.command('memory.list', {})
  const { nowVersion } = (listed.ok ? listed.value : {}) as MemoryList
  const added = await window.command('memory.now.change', { action: 'add', text: 'Book the dentist', version: nowVersion })
  assert.ok(added.ok && (added.value as MemoryNowChanged).ok, JSON.stringify(added))
  await window.command('app.refresh', {})
  await window.until((view) => view.snapshot.memoriesStamp !== stampAfterUndo, 'a stamp after the right-now list changed')
})
