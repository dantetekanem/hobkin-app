import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinishedChange, FinishedGroup, StackPlace } from '#shared/protocol/work.ts'
import { arrange, headingOf, isWholeCard, layerLine, type Entry } from '../src/features/work/stacks.ts'

function change(item: string, stack?: Partial<StackPlace> & { layer: number }, over: Partial<FinishedChange> = {}): FinishedChange {
  const place = stack && { id: 'aaa111', of: 5, name: null, below: null, base: null, ...stack }
  return { key: `rpg:${item}`, slug: 'rpg', project: 'rpsleague', item, title: `Title ${item}`, ...(place ? { stack: place } : {}), ...over } as FinishedChange
}
const group = (name: string, changes: FinishedChange[]): FinishedGroup => ({ name, heading: name, why: null, action: null, changes }) as FinishedGroup
const keys = (entries: Entry[]) => entries.map((entry) => (entry.kind === 'stack' ? `${entry.key}[${entry.layers.map(({ change }) => change.item).join(',')}]` : entry.key))

test('changes with one stack id are one stack, bottom layer first, whatever order they came in', () => {
  const [merge] = arrange([group('merge', [change('l3', { layer: 3 }), change('l1', { layer: 1 }), change('l2', { layer: 2 })])])
  assert.deepEqual(keys(merge!.entries), ['stack:aaa111[l1,l2,l3]'])
})

test('a stack stands where its bottom layer stood, and changes in no stack keep their order untouched', () => {
  const before = change('x'), after = change('y'), other = change('z')
  const [merge] = arrange([group('merge', [before, change('l2', { layer: 2 }), after, change('l1', { layer: 1 }), other])])
  assert.deepEqual(keys(merge!.entries), ['rpg:x', 'rpg:y', 'stack:aaa111[l1,l2]', 'rpg:z'])
  const entry = merge!.entries[0]!
  assert.ok(entry.kind === 'change' && entry.at.change === before && entry.place === null)
})

test('a stack leaves the groups its upper layers came in and stands in the bottom layer\'s group', () => {
  const groups = arrange([group('merge', [change('l1', { layer: 1 })]), group('needs', [change('n'), change('l2', { layer: 2 })])])
  assert.deepEqual(keys(groups[0]!.entries), ['stack:aaa111[l1,l2]'])
  assert.deepEqual(keys(groups[1]!.entries), ['rpg:n'])
  const stack = groups[0]!.entries[0]!
  assert.ok(stack.kind === 'stack' && stack.layers[1]!.group.name === 'needs', 'a layer keeps the group it came in, which says why it is there')
})

test('a layer alone here is a card marked with its place, not a group', () => {
  const [merge] = arrange([group('merge', [change('l2', { layer: 2 }), change('x')])])
  const [lone] = merge!.entries
  assert.ok(lone!.kind === 'change' && lone.place?.layer === 2 && lone.place.of === 5)
  assert.equal(merge!.entries.length, 2)
})

test('a stack of two is a stack too, and two stacks stay two', () => {
  const [merge] = arrange([group('merge', [change('a1', { id: 'A', layer: 1, of: 2 }), change('b1', { id: 'B', layer: 1 }), change('a2', { id: 'A', layer: 2, of: 2 }), change('b2', { id: 'B', layer: 2 })])])
  assert.deepEqual(keys(merge!.entries), ['stack:A[a1,a2]', 'stack:B[b1,b2]'])
})

test('only the bottom layer is a whole card; the others are lines that say their place, their title and what they land after', () => {
  const l1 = change('l1', { layer: 1 }), l3 = change('l3', { layer: 3 }, { title: 'Cover the turn limits' })
  assert.equal(isWholeCard(l1), true)
  assert.equal(isWholeCard(l3), false)
  assert.equal(isWholeCard(change('x')), false)
  assert.deepEqual(layerLine({ stack: l3.stack!, title: l3.title }), { place: '3 of 5', title: 'Cover the turn limits', lands: 'lands after 2' })
})

test('the heading says how many layers and what they are of, and the project only when no whole card says it', () => {
  const whole = arrange([group('merge', [change('l1', { layer: 1, name: 'Enemy AI' }), change('l2', { layer: 2, name: 'Enemy AI' })])])[0]!.entries[0]!
  assert.ok(whole.kind === 'stack')
  assert.equal(headingOf(whole), 'Stack of 5 · Enemy AI')
  const unnamed = arrange([group('merge', [change('l1', { layer: 1 }), change('l2', { layer: 2 })])])[0]!.entries[0]!
  assert.ok(unnamed.kind === 'stack')
  assert.equal(headingOf(unnamed), 'Stack of 5')
  const noBottom = arrange([group('merge', [change('l2', { layer: 2 }), change('l3', { layer: 3 })])])[0]!.entries[0]!
  assert.ok(noBottom.kind === 'stack')
  assert.equal(headingOf(noBottom), 'Stack of 5 · rpsleague')
})
