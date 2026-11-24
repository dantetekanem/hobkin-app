import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MEMORY_KINDS, type MemoryEntry, type MemoryList } from '#shared/protocol/memory.ts'
import { createMemoryActions } from '../src/features/memory/actions.ts'
import { createSampleHost } from '../src/features/memory/sample-host.ts'
import { sampleMemoryList } from '../src/features/memory/sample.ts'
import { createMemoryStore, NEW_DRAFT, NOT_AVAILABLE_YET, refusalWords, type MemoryCommand, type MemorySend } from '../src/features/memory/store.ts'
import { RESTART_NEEDED } from '../src/lib/host/refusal.ts'

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

const LISBON: MemoryEntry = { name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon', text: 'Since 2025.', version: 'v1', added: { at: '2026-11-15T10:00:00Z', by: { kind: 'outside', title: 'Claude Code' } } }

/** A host the test answers by hand: each command is kept, and answered by `answers` for its name. */
function fakeHost(answers: Partial<Record<MemoryCommand, (args: Record<string, unknown>) => unknown>>) {
  const sent: { name: MemoryCommand; args: Record<string, unknown> }[] = []
  const send: MemorySend = async (name, args) => {
    sent.push({ name, args: args as Record<string, unknown> })
    const answer = answers[name]
    if (!answer) throw new Error(`no answer for ${name}`)
    return answer(args as Record<string, unknown>)
  }
  return { send, sent, named: (name: MemoryCommand) => sent.filter((one) => one.name === name) }
}

function pageWith(list: MemoryList, more: Parameters<typeof fakeHost>[0] = {}) {
  const host = fakeHost({ 'memory.list': () => list, ...more })
  const store = createMemoryStore({ send: host.send })
  const actions = createMemoryActions(store, host.send)
  return { host, store, actions }
}

test('a save the host refuses because the memory changed meanwhile keeps the draft and says why in the row', async () => {
  const { host, store, actions } = pageWith({ memories: [LISBON] }, { 'memory.save': () => ({ saved: false, message: 'It changed since you opened it.' }) })
  store.opened()
  await settle()
  store.edit('lives-in-lisbon')
  store.change('lives-in-lisbon', { description: 'Lives in Lisbon since March 2025' })
  await actions.save('lives-in-lisbon')

  assert.deepEqual(host.named('memory.save')[0]?.args, { name: 'lives-in-lisbon', version: 'v1', description: 'Lives in Lisbon since March 2025', kind: 'user', text: 'Since 2025.', private: false })
  const state = store.getState()
  assert.equal(state.drafts['lives-in-lisbon']?.description, 'Lives in Lisbon since March 2025', 'the words typed stay')
  assert.equal(state.refused['lives-in-lisbon'], 'It changed since you opened it.')
  assert.equal(state.busy['lives-in-lisbon'], undefined)
})

test('a save that goes through takes the host memory, closes the draft and can be undone', async () => {
  const changed = { ...LISBON, description: 'Lives in Lisbon since 2025', version: 'v2' }
  const { host, store, actions } = pageWith({ memories: [LISBON] }, { 'memory.save': () => ({ saved: true, memory: changed, change: 'c-7' }), 'memory.undo': () => ({ ok: true }) })
  store.opened()
  await settle()
  store.edit('lives-in-lisbon')
  store.change('lives-in-lisbon', { description: '  Lives in Lisbon since 2025 ' })
  await actions.save('lives-in-lisbon')

  const state = store.getState()
  assert.equal(state.drafts['lives-in-lisbon'], undefined)
  assert.equal(state.list?.memories[0]?.version, 'v2')
  assert.equal(state.saved['lives-in-lisbon'], 'c-7')
  await actions.undoSave('lives-in-lisbon')
  assert.deepEqual(host.named('memory.undo').map(({ args }) => args), [{ change: 'c-7' }])
  assert.equal(store.getState().saved['lives-in-lisbon'], undefined)
})

test('a description left empty is not sent, and says what is missing', async () => {
  const { host, store, actions } = pageWith({ memories: [] })
  store.add('date')
  assert.equal(store.getState().drafts[NEW_DRAFT]?.kind, 'date')
  await actions.save(NEW_DRAFT)
  assert.equal(host.named('memory.save').length, 0)
  assert.match(store.getState().refused[NEW_DRAFT] ?? '', /description/i)
})

test('forget turns the row into a forgotten line in place, and Undo brings the memory back', async () => {
  let memories: MemoryEntry[] = [LISBON]
  const { host, store, actions } = pageWith({ memories: [] }, {
    'memory.list': () => ({ memories }),
    'memory.forget': () => {
      memories = []
      return { forgot: true, change: 'c-9' }
    },
    'memory.undo': () => {
      memories = [{ ...LISBON, version: 'v3' }]
      return { ok: true }
    },
  })
  store.opened()
  await settle()
  await actions.forget('lives-in-lisbon')

  assert.deepEqual(host.named('memory.forget')[0]?.args, { name: 'lives-in-lisbon', version: 'v1' })
  assert.deepEqual(store.getState().list?.memories, [])
  assert.equal(store.getState().forgotten['lives-in-lisbon']?.change, 'c-9')
  assert.equal(store.getState().forgotten['lives-in-lisbon']?.entry.description, 'Lives in Lisbon')

  await actions.undoForget('lives-in-lisbon')
  await settle()
  assert.deepEqual(host.named('memory.undo')[0]?.args, { change: 'c-9' })
  assert.equal(store.getState().forgotten['lives-in-lisbon'], undefined)
  assert.equal(store.getState().list?.memories[0]?.version, 'v3', 'the page reads the list again')
})

test('an undo the host refuses stays on the forgotten line with its reason, and leaving the page clears it', async () => {
  const { store, actions } = pageWith({ memories: [LISBON] }, { 'memory.forget': () => ({ forgot: true, change: 'c-1' }), 'memory.undo': () => ({ ok: false, reason: 'It changed since.' }) })
  store.opened()
  await settle()
  await actions.forget('lives-in-lisbon')
  await actions.undoForget('lives-in-lisbon')
  assert.equal(store.getState().forgotten['lives-in-lisbon']?.refused, 'It changed since.')
  store.left()
  assert.deepEqual(store.getState().forgotten, {})
})

test('the page reads again when the stamp changes, and waits while a row is being edited', async () => {
  const { host, store } = pageWith({ memories: [LISBON] })
  store.stampSeen('s1')
  assert.equal(host.named('memory.list').length, 0, 'a closed page reads nothing')
  store.opened()
  await settle()
  assert.equal(host.named('memory.list').length, 1)
  store.stampSeen('s2')
  await settle()
  assert.equal(host.named('memory.list').length, 2)
  store.stampSeen('s2')
  store.stampSeen(undefined)
  await settle()
  assert.equal(host.named('memory.list').length, 2, 'the same stamp, or none from an older host, reads nothing')

  store.edit('lives-in-lisbon')
  store.stampSeen('s3')
  await settle()
  assert.equal(host.named('memory.list').length, 2, 'nothing moves around the row being edited')
  store.cancel('lives-in-lisbon')
  await settle()
  assert.equal(host.named('memory.list').length, 3, 'it reads once the row is closed')
})

test('a command the running hobkin does not have reads as not available yet', async () => {
  assert.equal(refusalWords(new Error('There is no command named "memory.list".')), NOT_AVAILABLE_YET)
  assert.equal(refusalWords(new Error(RESTART_NEEDED)), NOT_AVAILABLE_YET)
  assert.equal(refusalWords(new Error('Disconnected from hobkin.')), 'Disconnected from hobkin.')

  const missing: MemorySend = async () => {
    throw new Error(NOT_AVAILABLE_YET)
  }
  const store = createMemoryStore({ send: missing })
  store.opened()
  await settle()
  assert.equal(store.getState().problem, NOT_AVAILABLE_YET)
})

test('the Right now list changes through its own command, with its version, and a removed line can be put back', async () => {
  const { host, store, actions } = pageWith({ memories: [], now: ['Call the bank'], nowVersion: 'n1' }, { 'memory.now.change': () => ({ ok: true }) })
  store.opened()
  await settle()
  store.nowStart(null)
  store.nowType('  Book the dentist ')
  await actions.nowSave()
  store.nowStart('Call the bank')
  store.nowType('Call the bank on Monday')
  await actions.nowSave()
  await actions.nowRemove('Call the bank on Monday', 0)
  await actions.nowUndoRemove('Call the bank on Monday')
  assert.deepEqual(
    host.named('memory.now.change').map(({ args }) => args),
    [
      { action: 'add', text: 'Book the dentist', version: 'n1' },
      { action: 'replace', item: 'Call the bank', text: 'Call the bank on Monday', version: 'n1' },
      { action: 'remove', item: 'Call the bank on Monday', version: 'n1' },
      { action: 'add', text: 'Call the bank on Monday', version: 'n1' },
    ],
  )
  assert.deepEqual(store.getState().nowRemoved, [])
})

test('with no host the sample holds memories of every kind, and its changes work on it in memory', async () => {
  const sample = sampleMemoryList()
  assert.ok(sample.memories.length >= 12)
  assert.deepEqual(new Set(sample.memories.map(({ kind }) => kind)), new Set(MEMORY_KINDS))
  assert.equal(sample.memories.filter((memory) => memory.private).length, 1)
  assert.equal(sample.memories.filter((memory) => memory.past).length, 1)
  assert.deepEqual(new Set(sample.memories.map((memory) => memory.added?.by?.kind)), new Set(['user', 'main', 'hobkin', 'outside', 'suggested']))
  assert.equal(sample.now?.length, 5)

  const host = createSampleHost(sample, () => Date.parse('2026-11-23T12:00:00Z'))
  const store = createMemoryStore({ send: host.send })
  const actions = createMemoryActions(store, host.send)
  store.opened()
  await settle()
  assert.equal(store.getState().list?.memories.length, sample.memories.length)

  store.add('preference')
  store.change(NEW_DRAFT, { description: 'Likes the window seat', text: 'On trains and planes.' })
  await actions.save(NEW_DRAFT)
  await settle()
  const added = store.getState().list?.memories.find((memory) => memory.description === 'Likes the window seat')
  assert.equal(added?.added?.by?.kind, 'user')

  await actions.forget(added!.name)
  await settle()
  assert.equal(store.getState().list?.memories.some((memory) => memory.name === added!.name), false)
  await actions.undoForget(added!.name)
  await settle()
  assert.equal(store.getState().list?.memories.some((memory) => memory.name === added!.name), true)

  // The sample keeps the rules a user meets: a stale version and a secret are refused, and the draft stays.
  store.edit(added!.name)
  store.change(added!.name, { text: 'My password is hunter2' })
  await actions.save(added!.name)
  assert.match(store.getState().refused[added!.name] ?? '', /secret/i)
  assert.equal(store.getState().drafts[added!.name]?.text, 'My password is hunter2')
})
