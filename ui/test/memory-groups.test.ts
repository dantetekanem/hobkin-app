import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MemoryEntry } from '#shared/protocol/memory.ts'
import { countsOf, findMemories, fromWords, pageOf, textParts, untilWords, type PagePart } from '../src/features/memory/groups.ts'

const TODAY = '2026-11-23'
const NOW = Date.parse('2026-11-23T15:00:00Z')

const memory = (name: string, fields: Partial<MemoryEntry> = {}): MemoryEntry => ({ name, description: name.replaceAll('-', ' '), kind: 'user', ...fields })
const at = (day: string) => ({ at: `${day}T12:00:00Z` })

const MEMORIES: MemoryEntry[] = [
  memory('lives-in-lisbon', { kind: 'user', changed: at('2026-11-20') }),
  memory('partner-is-sam', { kind: 'user', private: true, added: at('2026-11-02') }),
  memory('short-replies', { kind: 'preference', added: at('2026-10-01') }),
  memory('car-insurance-renews', { kind: 'date', until: '2027-03-03', added: at('2026-10-30') }),
  memory('flat-viewing', { kind: 'date', until: '2026-10-31', past: true, added: at('2026-10-20') }),
  memory('kept-old-laptop', { kind: 'decision', added: at('2026-10-12') }),
  memory('tax-papers', { kind: 'pointer', added: at('2026-09-01') }),
  memory('moving-house', { kind: 'project', added: at('2026-11-10') }),
  // A kind the window does not know reads as none.
  memory('odd-one', { kind: undefined, added: at('2026-11-01') }),
]

const labels = (parts: readonly PagePart[]) => parts.map((part) => (part.key === 'now' ? `now:${part.lines.length}` : `${part.label}:${part.memories.map(({ name }) => name).join(',')}`))

test('the page lists memories by kind in the page order, newest change first, then Right now, then the past ones apart', () => {
  const page = pageOf({ memories: MEMORIES, now: ['Reply to the landlord', 'Book the dentist'], today: TODAY })
  assert.deepEqual(labels(page), [
    'About you:lives-in-lisbon,partner-is-sam',
    'How you like things:short-replies',
    'Dates:car-insurance-renews',
    'Decisions:kept-old-laptop',
    'Projects:moving-house',
    'Where things are:tax-papers',
    'Other:odd-one',
    'now:2',
    'Past:flat-viewing',
  ])
})

test('a memory whose day has passed is past even when the host did not say so', () => {
  const page = pageOf({ memories: [memory('old', { until: '2026-11-22' }), memory('today', { until: TODAY })], today: TODAY })
  assert.deepEqual(labels(page), ['About you:today', 'now:0', 'Past:old'])
})

test('a kind chosen shows only that kind, even with nothing in it, and Right now or Past shows only that', () => {
  assert.deepEqual(labels(pageOf({ memories: MEMORIES, filter: 'decision', today: TODAY })), ['Decisions:kept-old-laptop'])
  assert.deepEqual(labels(pageOf({ memories: [], filter: 'pointer', today: TODAY })), ['Where things are:'])
  assert.deepEqual(labels(pageOf({ memories: MEMORIES, now: ['One'], filter: 'now', today: TODAY })), ['now:1'])
  assert.deepEqual(labels(pageOf({ memories: MEMORIES, filter: 'past', today: TODAY })), ['Past:flat-viewing'])
})

test('the counts are by kind, the past ones apart, and Right now beside them', () => {
  const counts = countsOf(MEMORIES, ['a', 'b', 'c'], TODAY)
  assert.equal(counts.all, 8)
  assert.deepEqual(counts.kinds, { user: 2, preference: 1, date: 1, decision: 1, project: 1, pointer: 1 })
  assert.equal(counts.other, 1)
  assert.equal(counts.past, 1)
  assert.equal(counts.now, 3)
})

test('a search needs every word somewhere in the name, the description or the text, and the name counts most', () => {
  const memories = [
    memory('trains', { description: 'Prefers trains under 600 km', text: 'Over flying, for Lisbon trips too', changed: at('2026-11-21') }),
    memory('lisbon-flat', { description: 'The flat', text: 'Rented since 2025', added: at('2026-01-01') }),
    memory('lives-in-lisbon', { description: 'Lives there since 2025', added: at('2025-06-01') }),
    memory('nothing-here', { description: 'Unrelated', text: 'Nothing at all' }),
  ]
  // In the name beats in the text, and two in the name tie on the newest change.
  assert.deepEqual(findMemories(memories, 'Lisbon').map(({ name }) => name), ['lisbon-flat', 'lives-in-lisbon', 'trains'])
  // Every word must match, in any of the three, in any case, and each adds what its place counts.
  assert.deepEqual(findMemories(memories, 'lisbon 2025').map(({ name }) => name), ['lives-in-lisbon', 'lisbon-flat'])
  assert.deepEqual(findMemories(memories, 'lisbon  moon'), [])
  assert.deepEqual(findMemories(memories, '   '), [])
})

test('with a search the page shows what was found, ranked, past ones too, and the Right now lines that match', () => {
  const page = pageOf({ memories: MEMORIES, now: ['Renew the car insurance by March', 'Call Sam'], query: 'car', today: TODAY })
  assert.deepEqual(labels(page), ['1 found:car-insurance-renews', 'now:1'])
  assert.deepEqual(labels(pageOf({ memories: MEMORIES, query: 'flat viewing', today: TODAY })), ['1 found:flat-viewing', 'now:0'])
  assert.deepEqual(labels(pageOf({ memories: MEMORIES, query: 'zebra', filter: 'user', today: TODAY })), ['Nothing found:'])
})

test('a row says who added it, where, who changed it and when, in plain words', () => {
  const words = (fields: Partial<MemoryEntry>) => fromWords({ name: 'm', ...fields }, { now: NOW, timeZone: 'UTC' })
  assert.equal(words({ added: { at: '2026-11-02T10:00:00Z', by: { kind: 'main' } }, source: { kind: 'chat', said: 'Remember Sam is my partner' } }), 'From you, in Chat, Nov 2')
  assert.equal(
    words({ added: { at: '2026-11-15T18:18:48Z', by: { kind: 'outside', title: 'Claude Code' } }, changed: { at: '2026-11-20T09:02:00Z', by: { kind: 'main' } }, source: { kind: 'remember' } }),
    'From Claude Code, Nov 15 · changed by hobkin, Nov 20',
  )
  assert.equal(words({ added: { at: '2026-11-03T09:00:00Z', by: { kind: 'user' } }, source: { kind: 'window' } }), 'From you, Nov 3')
  assert.equal(words({ added: { at: '2026-11-04T09:00:00Z', by: { kind: 'main' } } }), 'From hobkin, Nov 4')
  assert.equal(words({ added: { at: '2026-11-05T09:00:00Z', by: { kind: 'hobkin', id: 'h1', title: 'Trip planner' } } }), 'From Trip planner, Nov 5')
  assert.equal(words({ added: { at: '2026-11-06T09:00:00Z', by: { kind: 'suggested', title: 'Morning check' } } }), 'Suggested by Morning check, Nov 6')
  assert.equal(words({ added: { at: '2025-12-30T09:00:00Z', by: { kind: 'user' } }, changed: { at: '2026-01-02T09:00:00Z', by: { kind: 'user' } } }), 'From you, Dec 30, 2025 · changed by you, Jan 2')
  // A change that is the add itself says nothing more.
  assert.equal(words({ added: { at: '2026-11-07T09:00:00Z', by: { kind: 'main' } }, changed: { at: '2026-11-07T09:00:00Z', by: { kind: 'main' } } }), 'From hobkin, Nov 7')
  assert.equal(words({}), null)
})

test('a day it holds until reads as a date, and links in the text are their own parts', () => {
  assert.equal(untilWords('2027-03-03', NOW), 'until Mar 3, 2027')
  assert.equal(untilWords('2026-12-24', NOW), 'until Dec 24')
  assert.deepEqual(textParts('See [[car-insurance-quotes]] and [[Not A Name]].'), [{ text: 'See ' }, { link: 'car-insurance-quotes' }, { text: ' and [[Not A Name]].' }])
  assert.deepEqual(textParts('Plain'), [{ text: 'Plain' }])
})
