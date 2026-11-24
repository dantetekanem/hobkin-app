import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MEMORIES_MAX, MEMORY_NOW_MAX, readMemoryList, readMemoryNote, type MemoryEntry } from '#shared/protocol/memory.ts'

// Invented memories: nothing here is the user's.
const LISBON: MemoryEntry = {
  name: 'lives-in-lisbon',
  description: 'Lives in Lisbon since 2025; use Portuguese sites, prices and rules first',
  kind: 'user',
  text: 'The user lives in Lisbon. See [[car-insurance-renewal]].',
  private: false,
  until: '2027-01-01',
  added: { at: '2026-11-15T18:18:48Z', by: { kind: 'outside', title: 'Claude Code' } },
  changed: { at: '2026-11-20T09:02:00Z', by: { kind: 'main' } },
  source: { kind: 'remember', said: 'I live in Lisbon, look up the Portuguese one', from: 'Claude Code' },
  links: ['car-insurance-renewal'],
  past: false,
  version: 'a'.repeat(64),
}

test('a list in the shape of the contract reads as it came', () => {
  const partner: MemoryEntry = { name: 'partner-name', kind: 'user', description: 'Partner is called Ana', private: true, added: { at: '2026-11-02T10:00:00Z', by: { kind: 'hobkin', id: 'a1b2c3d4' } } }
  const list = { memories: [LISBON, partner], now: ['Reply to the landlord by Nov 28'], nowVersion: 'b'.repeat(64), unreadable: ['broken.md'] }
  assert.deepEqual(readMemoryList(list), list)
})

test('a runtime that answers nothing a list can be read from reads as an empty list', () => {
  for (const none of [undefined, null, 'busy', 3, [], { memories: 'all' }]) assert.deepEqual(readMemoryList(none), { memories: [] }, JSON.stringify(none))
})

test('a memory whose name does not fit the pattern is dropped, and so is a second one of the same name', () => {
  const names = [undefined, '', 'a', 'Lives-in-lisbon', '-starts-with-a-hyphen', 'has space', 'has_underscore', 'x'.repeat(61), '../escape', 'lives-in-lisbon']
  const read = readMemoryList({ memories: [null, 'lives-in-lisbon', ...names.map((name) => ({ name, kind: 'user' })), { ...LISBON, description: 'a second copy' }] })
  assert.deepEqual(read.memories, [{ name: 'lives-in-lisbon', kind: 'user' }])
  assert.deepEqual(readMemoryList({ memories: [{ name: 'ab' }, { name: 'x'.repeat(60) }] }).memories, [{ name: 'ab' }, { name: 'x'.repeat(60) }], 'two and sixty characters are the ends of the pattern')
})

test('a kind the window does not know is left out, and the memory keeps the rest', () => {
  const [read] = readMemoryList({
    memories: [
      {
        name: 'some-memory',
        kind: 'secret',
        description: 7,
        text: ['not', 'words'],
        private: 'yes',
        until: 'next week',
        added: { at: 'yesterday', by: { kind: 'agent', id: 3, title: 'A run' } },
        changed: 'today',
        source: { kind: 'web', said: 42, from: 'a page' },
        links: ['ok-link', 'Bad Link', 5, 'ok-link'],
        past: 1,
        version: 99,
        extra: 'not in the contract',
      },
    ],
  }).memories
  assert.deepEqual(read, { name: 'some-memory', added: { by: { title: 'A run' } }, source: { from: 'a page' }, links: ['ok-link'] })
})

test('words are cut to the lengths the notes give, a cut never splits a character, and a fingerprint or an id is never cut', () => {
  const [read] = readMemoryList({
    memories: [
      {
        name: 'long-one',
        kind: 'preference',
        description: `${'d'.repeat(149)}😀 and more`,
        text: 't'.repeat(2500),
        added: { at: '2026-11-15T18:18:48Z', by: { kind: 'hobkin', id: 'h'.repeat(129), title: 'n'.repeat(200) } },
        source: { kind: 'chat', said: 's'.repeat(400), from: 'f'.repeat(200) },
        version: 'v'.repeat(129),
      },
    ],
  }).memories
  assert.equal(read!.description, 'd'.repeat(149), 'the emoji that would be cut in half goes whole')
  assert.equal(read!.text!.length, 2000)
  assert.equal(read!.source!.said!.length, 300)
  assert.equal(read!.source!.from!.length, 120)
  assert.deepEqual(read!.added, { at: '2026-11-15T18:18:48Z', by: { kind: 'hobkin', title: 'n'.repeat(120) } })
  assert.equal(read!.version, undefined, 'a cut fingerprint would match no file')
})

test('at most 300 memories are read, the first ones', () => {
  const memories = Array.from({ length: MEMORIES_MAX + 4 }, (_, index) => ({ name: `memory-${index}` }))
  const read = readMemoryList({ memories }).memories
  assert.equal(MEMORIES_MAX, 300)
  assert.equal(read.length, MEMORIES_MAX)
  assert.equal(read.at(-1)!.name, `memory-${MEMORIES_MAX - 1}`)
})

test('the right-now list keeps its first twenty lines of words, each cut to 200 characters', () => {
  const now = [42, '', 'first', null, `${'n'.repeat(199)}😀`, ...Array.from({ length: 30 }, (_, index) => `item ${index}`)]
  const read = readMemoryList({ memories: [], now, nowVersion: 'c'.repeat(64) })
  assert.equal(MEMORY_NOW_MAX, 20)
  assert.equal(read.now!.length, MEMORY_NOW_MAX)
  assert.deepEqual(read.now!.slice(0, 3), ['first', 'n'.repeat(199), 'item 0'])
  assert.equal(read.nowVersion, 'c'.repeat(64))
  assert.deepEqual(readMemoryList({ memories: [], now: 'all of it', nowVersion: 5, unreadable: [3, 'a.md'] }), { memories: [], unreadable: ['a.md'] })
})

test('a page line that says why there is nothing comes through, cut short', () => {
  assert.deepEqual(readMemoryList({ memories: [], unavailable: 'This hobkin has no memory yet. Restart the app to load it.' }), { memories: [], unavailable: 'This hobkin has no memory yet. Restart the app to load it.' })
  assert.equal(readMemoryList({ memories: [], unavailable: 'u'.repeat(400) }).unavailable!.length, 300)
})

test("a chat line's note about a memory reads into its shape, and anything else reads as none", () => {
  assert.deepEqual(readMemoryNote({ change: 'chg-1', name: 'lives-in-lisbon', did: 'added' }), { change: 'chg-1', name: 'lives-in-lisbon', did: 'added' })
  assert.deepEqual(readMemoryNote({ change: 'chg-1', name: 'lives-in-lisbon', did: 'moved', extra: 1 }), { change: 'chg-1', name: 'lives-in-lisbon' })
  for (const none of [undefined, null, 'chg-1', { change: 'chg-1' }, { name: 'lives-in-lisbon' }, { change: '', name: 'lives-in-lisbon' }, { change: 'c'.repeat(129), name: 'lives-in-lisbon' }, { change: 'chg-1', name: 'Not A Name' }]) {
    assert.equal(readMemoryNote(none), undefined, JSON.stringify(none))
  }
})
