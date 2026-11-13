import assert from 'node:assert/strict'
import test from 'node:test'
import { rotationWindow, stripItems, thoughtsOf, TIPS } from '../src/features/home/tips.ts'
import type { Thought, Tip } from '../src/features/home/types.ts'

const tips: Tip[] = [
  { id: 'a', text: 'A', kbd: '⌘K' },
  { id: 'b', text: 'B' },
  { id: 'c', text: 'C' },
]
const thoughts: Thought[] = [{ id: 'x', text: 'X' }]

test('stripItems lists thoughts first then tips, keeps the kbd, and drops dismissed items by key', () => {
  const items = stripItems(tips, thoughts, new Set())
  assert.deepEqual(items.map(item => item.id), ['thought:x', 'tip:a', 'tip:b', 'tip:c'])
  assert.equal(items[0]?.kind, 'thought')
  assert.equal(items[1]?.kind === 'tip' && items[1].kbd, '⌘K')

  const pruned = stripItems(tips, thoughts, new Set(['thought:x', 'tip:b']))
  assert.deepEqual(pruned.map(item => item.id), ['tip:a', 'tip:c'])
})

test('rotationWindow shows all when they fit, and otherwise a sliding, wrapping window', () => {
  assert.deepEqual(rotationWindow(['a', 'b'], 5, 3), ['a', 'b'], 'fewer than the window: show them all')
  const list = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual(rotationWindow(list, 0, 3), ['a', 'b', 'c'])
  assert.deepEqual(rotationWindow(list, 1, 3), ['b', 'c', 'd'])
  assert.deepEqual(rotationWindow(list, 4, 3), ['e', 'a', 'b'], 'the window wraps around')
  // Over a full cycle every item is shown, so the strip rotates through the whole set.
  const seen = new Set([0, 1, 2, 3, 4].flatMap(step => rotationWindow(list, step, 3)))
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c', 'd', 'e'])
})

test('thoughtsOf validates the snapshot shape, keeps the optional time, and de-duplicates by id', () => {
  const kept = thoughtsOf([
    { id: 't1', text: 'One', at: '2026-11-12T20:00:00Z' },
    { id: 't2', text: 'Two' },
    { id: 't1', text: 'Duplicate' },
    { id: 'no-text' },
    { text: 'no id' },
    null,
    'nonsense',
  ])
  assert.deepEqual(kept.map(thought => thought.id), ['t1', 't2'])
  assert.equal(kept[0]?.at, '2026-11-12T20:00:00Z')
  assert.equal(kept[1]?.at, undefined)
  assert.deepEqual(thoughtsOf(null), [])
})

test('the seeded tips are well-formed with unique ids', () => {
  assert.ok(TIPS.length >= 5)
  assert.equal(new Set(TIPS.map(tip => tip.id)).size, TIPS.length)
  for (const tip of TIPS) assert.ok(tip.text.trim().length > 0)
})
