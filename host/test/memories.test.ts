import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COMMANDS } from '#shared/commands/registry.ts'
import type { MemoryEntry } from '#shared/protocol/memory.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand, Unavailable } from '../src/commands.ts'
import { memoryHandlers, type MemoryOperations } from '../src/memories.ts'

// Invented memories: nothing here is the user's.
const LISBON: MemoryEntry = { name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon since 2025', text: 'The user lives in Lisbon.', version: 'v1' }
const TRAINS: MemoryEntry = { name: 'prefers-trains', kind: 'preference', description: 'Train over flying under 600 km', version: 'v7' }
const NOW = { now: ['Reply to the landlord by Nov 28'], nowVersion: 'n1' }
const WINDOW = { by: { kind: 'user' }, source: { kind: 'window' } }
const NOT_AVAILABLE = 'This hobkin has no memory yet. Restart the app to load it.'
const CHANGING = ['memory.save', 'memory.forget', 'memory.undo', 'memory.now.change'] as const

/** The runtime's memory functions over a list in memory, recording each change they are asked for. */
function fakeRuntime(answers: Partial<Record<keyof MemoryOperations, (...args: unknown[]) => unknown>> = {}) {
  let memories: MemoryEntry[] = [LISBON, TRAINS]
  const calls: unknown[][] = []
  const operations: MemoryOperations = {
    list: async () => answers.list?.() ?? { memories, ...NOW },
    save: async (memory, who) => {
      calls.push(['save', memory, who])
      if (answers.save) return answers.save(memory, who)
      const kept: MemoryEntry = { ...memory, name: memory.name ?? 'new-memory', version: 'v2', added: { at: '2026-11-23T12:00:00Z', by: { kind: 'user' } } }
      memories = [...memories.filter(({ name }) => name !== kept.name), kept]
      return { saved: true, memory: kept, change: 'chg-1' }
    },
    forget: async (forget, who) => {
      calls.push(['forget', forget, who])
      return answers.forget ? answers.forget(forget, who) : { forgot: true, change: 'chg-2' }
    },
    undo: async (change, who) => {
      calls.push(['undo', change, who])
      return answers.undo ? answers.undo(change, who) : { ok: true }
    },
    changeNow: async (change, who) => {
      calls.push(['now', change, who])
      return answers.changeNow ? answers.changeNow(change, who) : { ok: true, now: [...NOW.now, 'Book the dentist'], nowVersion: 'n2' }
    },
  }
  return { calls, operations, handlers: memoryHandlers({ operations: async () => operations }) }
}

test('memory.list answers every memory and the right-now list, read without trust', async () => {
  const { handlers } = fakeRuntime({ list: () => ({ memories: [LISBON, { name: 'Bad Name' }, { ...TRAINS, kind: 'mood' }], ...NOW, extra: 1 }) })
  const { kind: _mood, ...trains } = TRAINS
  assert.deepEqual(await runCommand(handlers, 'memory.list', {}), { ok: true, value: { memories: [LISBON, trains], ...NOW } })
})

test("a save with no version adds, one with a version changes, and both go as the user's own from the window", async () => {
  const { calls, handlers } = fakeRuntime()
  const added = await runCommand(handlers, 'memory.save', { description: 'Car insurance renews every March 3', kind: 'date', until: '2027-03-03' })
  assert.deepEqual(added, {
    ok: true,
    value: { saved: true, change: 'chg-1', memory: { name: 'new-memory', description: 'Car insurance renews every March 3', kind: 'date', until: '2027-03-03', version: 'v2', added: { at: '2026-11-23T12:00:00Z', by: { kind: 'user' } } } },
  })
  const changed = await runCommand(handlers, 'memory.save', { name: 'lives-in-lisbon', description: 'Lives in Lisbon since 2024', kind: 'user', version: 'v1' })
  assert.equal(changed.ok && (changed.value as { saved: boolean }).saved, true)
  assert.deepEqual(calls, [
    ['save', { description: 'Car insurance renews every March 3', kind: 'date', until: '2027-03-03' }, WINDOW],
    ['save', { name: 'lives-in-lisbon', description: 'Lives in Lisbon since 2024', kind: 'user', version: 'v1' }, WINDOW],
  ])
})

test('a save or a forget of a memory that changed since it was read is refused in words that keep the draft, and the runtime is not asked', async () => {
  const { calls, handlers } = fakeRuntime()
  const stale = await runCommand(handlers, 'memory.save', { name: 'lives-in-lisbon', description: 'Lives in Porto', kind: 'user', version: 'v0' })
  assert.deepEqual(stale, { ok: true, value: { saved: false, message: 'This memory changed since you opened it, so your change was not saved. Your draft is kept: look at the memory as it is now, then save again.' } })
  const gone = await runCommand(handlers, 'memory.save', { name: 'old-car', description: 'Drives a 2012 Golf', kind: 'user', version: 'v3' })
  assert.deepEqual(gone, { ok: true, value: { saved: false, message: 'This memory was forgotten since you opened it, so your change was not saved. Your draft is kept: save it again with no name to add it back.' } })
  const forgetStale = await runCommand(handlers, 'memory.forget', { name: 'prefers-trains', version: 'v6' })
  assert.deepEqual(forgetStale, { ok: true, value: { forgot: false, message: 'This memory changed since you opened it, so hobkin did not forget it. Look at it as it is now first.' } })
  const nowStale = await runCommand(handlers, 'memory.now.change', { action: 'add', text: 'Book the dentist', version: 'n0' })
  assert.deepEqual(nowStale, { ok: true, value: { ok: false, reason: 'The Right now list changed since you opened it, so nothing changed. Your words are kept: look at the list as it is now, then try again.' } })
  assert.deepEqual(calls, [])
})

test("the runtime's refusal comes back in its own words, cut short, and an answer it does not know is a refusal too", async () => {
  const said = fakeRuntime({
    save: () => ({ saved: false, message: 'Another memory says nearly the same: lives-in-lisbon. Change that one, or pass a different name.' }),
    forget: () => ({ forgot: false, message: 'x'.repeat(2000) }),
    undo: () => ({ ok: false, reason: 'It changed since; edit it instead.' }),
    changeNow: () => ({ ok: false, reason: 'The list is full at 20 lines. Replace or remove one first.' }),
  })
  assert.deepEqual(await runCommand(said.handlers, 'memory.save', { description: 'Lives in Lisbon', kind: 'user' }), {
    ok: true,
    value: { saved: false, message: 'Another memory says nearly the same: lives-in-lisbon. Change that one, or pass a different name.' },
  })
  const forgot = await runCommand(said.handlers, 'memory.forget', { name: 'lives-in-lisbon', version: 'v1' })
  assert.equal(forgot.ok && (forgot.value as { message: string }).message.length, 300)
  assert.deepEqual(await runCommand(said.handlers, 'memory.undo', { change: 'chg-1' }), { ok: true, value: { ok: false, reason: 'It changed since; edit it instead.' } })
  assert.deepEqual(await runCommand(said.handlers, 'memory.now.change', { action: 'add', text: 'One more', version: 'n1' }), { ok: true, value: { ok: false, reason: 'The list is full at 20 lines. Replace or remove one first.' } })

  for (const answer of [undefined, null, 'ok', { saved: 'yes' }, { saved: false }, { saved: true, memory: { name: 'Not A Name' } }, { forgot: true }, { ok: 'yes' }, { ok: false, reason: ' ' }]) {
    const odd = fakeRuntime({ save: () => answer, forget: () => answer, undo: () => answer, changeNow: () => answer })
    const values = [
      await runCommand(odd.handlers, 'memory.save', { description: 'Lives in Lisbon', kind: 'user' }),
      await runCommand(odd.handlers, 'memory.forget', { name: 'lives-in-lisbon', version: 'v1' }),
      await runCommand(odd.handlers, 'memory.undo', { change: 'chg-1' }),
      await runCommand(odd.handlers, 'memory.now.change', { action: 'remove', item: 'Reply to the landlord by Nov 28', version: 'n1' }),
    ].map((outcome) => outcome.ok && outcome.value)
    assert.deepEqual(
      values,
      [
        { saved: false, message: 'hobkin did not say it kept the memory. Your draft is kept: look at the list before you save again.' },
        { forgot: false, message: 'hobkin did not say it forgot the memory, so it may still be there.' },
        { ok: false, reason: 'hobkin did not say it took the change back, so the memory may be as it was.' },
        { ok: false, reason: 'hobkin did not say it changed the list, so it may be as it was.' },
      ],
      JSON.stringify(answer),
    )
  }
})

test('forget, undo and a change to the right-now list reach the runtime as the user, and answer in the contract', async () => {
  const { calls, handlers } = fakeRuntime()
  assert.deepEqual(await runCommand(handlers, 'memory.forget', { name: 'lives-in-lisbon', version: 'v1' }), { ok: true, value: { forgot: true, change: 'chg-2' } })
  assert.deepEqual(await runCommand(handlers, 'memory.undo', { change: 'chg-2' }), { ok: true, value: { ok: true } })
  assert.deepEqual(await runCommand(handlers, 'memory.now.change', { action: 'add', text: 'Book the dentist', version: 'n1' }), {
    ok: true,
    value: { ok: true, now: ['Reply to the landlord by Nov 28', 'Book the dentist'], nowVersion: 'n2' },
  })
  assert.deepEqual(calls, [
    ['forget', { name: 'lives-in-lisbon', version: 'v1' }, WINDOW],
    ['undo', 'chg-2', WINDOW],
    ['now', { action: 'add', text: 'Book the dentist', version: 'n1' }, WINDOW],
  ])
})

test('a runtime without memories, or one that throws, lists none with a line the page shows and refuses every change in the same words', async () => {
  const broken = () => {
    throw Error('memories.mjs is not there')
  }
  const throwing: MemoryOperations = { list: broken, save: broken, forget: broken, undo: broken, changeNow: broken }
  for (const operations of [async () => null, async () => undefined, async () => broken(), async () => throwing]) {
    const handlers = memoryHandlers({ operations })
    assert.deepEqual(await runCommand(handlers, 'memory.list', {}), { ok: true, value: { memories: [], unavailable: NOT_AVAILABLE } })
    const values = [
      await runCommand(handlers, 'memory.save', { description: 'Lives in Lisbon', kind: 'user' }),
      await runCommand(handlers, 'memory.forget', { name: 'lives-in-lisbon' }),
      await runCommand(handlers, 'memory.undo', { change: 'chg-1' }),
      await runCommand(handlers, 'memory.now.change', { action: 'add', text: 'One more' }),
    ].map((outcome) => outcome.ok && outcome.value)
    assert.deepEqual(values, [{ saved: false, message: NOT_AVAILABLE }, { forgot: false, message: NOT_AVAILABLE }, { ok: false, reason: NOT_AVAILABLE }, { ok: false, reason: NOT_AVAILABLE }])
  }

  // hobkin not open yet says so, in the same shapes.
  const starting = memoryHandlers({
    operations: () => {
      throw new Unavailable('hobkin is still starting.')
    },
  })
  assert.deepEqual(await runCommand(starting, 'memory.list', {}), { ok: true, value: { memories: [], unavailable: 'hobkin is still starting.' } })
  assert.deepEqual(await runCommand(starting, 'memory.undo', { change: 'chg-1' }), { ok: true, value: { ok: false, reason: 'hobkin is still starting.' } })
})

test("only the window changes memories: hobkin's own client tool lists and runs memory.list alone", async () => {
  const { calls, handlers } = fakeRuntime()
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })
  const listed = ((await tool.execute('1', { action: 'list' })).details as { name: string }[]).map(({ name }) => name)
  assert.ok(listed.includes('memory.list'))
  assert.deepEqual((await tool.execute('2', { action: 'run', name: 'memory.list' })).details, { memories: [LISBON, TRAINS], ...NOW })

  for (const name of CHANGING) {
    assert.equal(COMMANDS[name].runs, 'host')
    assert.equal('hobkin' in COMMANDS[name], false, name)
    assert.equal(listed.includes(name), false, name)
  }
  await assert.rejects(tool.execute('3', { action: 'run', name: 'memory.save', args: { description: 'Lives in Lisbon', kind: 'user' } }), /needs the user's yes in the window/)
  await assert.rejects(tool.execute('4', { action: 'run', name: 'memory.forget', args: { name: 'lives-in-lisbon' } }), /needs the user's yes in the window/)
  await assert.rejects(tool.execute('5', { action: 'run', name: 'memory.undo', args: { change: 'chg-1' } }), /needs the user's yes in the window/)
  await assert.rejects(tool.execute('6', { action: 'run', name: 'memory.now.change', args: { action: 'add', text: 'x' } }), /needs the user's yes in the window/)
  assert.deepEqual(calls, [])
})

test('the arguments are checked before any handler', async () => {
  const { calls, handlers } = fakeRuntime()
  for (const [name, args] of [
    ['memory.save', { kind: 'user' }],
    ['memory.save', { description: 'Two\nlines', kind: 'user' }],
    ['memory.save', { description: 'd'.repeat(151), kind: 'user' }],
    ['memory.save', { description: 'Lives in Lisbon', kind: 'mood' }],
    ['memory.save', { description: 'Lives in Lisbon', kind: 'user', text: 't'.repeat(2001) }],
    ['memory.save', { description: 'Lives in Lisbon', kind: 'user', until: 'March' }],
    ['memory.save', { description: 'Lives in Lisbon', kind: 'user', name: '../escape' }],
    ['memory.save', { description: 'Lives in Lisbon', kind: 'user', version: 'v1' }],
    ['memory.save', { description: 'Lives in Lisbon', kind: 'user', by: { kind: 'main' } }],
    ['memory.forget', {}],
    ['memory.forget', { name: 'Lives In Lisbon' }],
    ['memory.undo', {}],
    ['memory.undo', { change: 'has space' }],
    ['memory.now.change', { action: 'add' }],
    ['memory.now.change', { action: 'remove' }],
    ['memory.now.change', { action: 'replace', item: 'Reply to the landlord by Nov 28' }],
    ['memory.now.change', { action: 'add', text: 't'.repeat(201) }],
    ['memory.now.change', { action: 'clear' }],
    ['memory.list', { all: true }],
  ] as const) {
    const said = await runCommand(handlers, name, args)
    assert.equal(!said.ok && said.error.code, 'invalid-arguments', JSON.stringify([name, args]))
  }
  assert.deepEqual(calls, [])
})
