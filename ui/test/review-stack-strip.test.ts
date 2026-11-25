import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinishedChange, StackPlace } from '#shared/protocol/work.ts'
import type { ReviewListItem } from '#shared/review/status.ts'
import { layerPlaceOf, layerStateOf, openKeyOf, stackStrip } from '../src/features/review/stack-strip.ts'

function change(item: string, layer: number | null, over: Partial<StackPlace> = {}): FinishedChange {
  const stack = layer === null ? {} : { stack: { id: 'aaa111', of: 5, name: null, below: null, base: null, layer, ...over } }
  return { key: `rpg:${item}`, slug: 'rpg', project: 'rpsleague', item, title: `Title ${item}`, ...stack } as FinishedChange
}
const five = [1, 2, 3, 4, 5].map((layer) => change(`l${layer}`, layer))

test('a layer in the middle knows its place, the layer under it and the one over it', () => {
  const strip = stackStrip([...five].reverse(), 'rpg:l3')!
  assert.deepEqual([strip.at, strip.of, strip.slots.map((slot) => slot?.number)], [3, 5, [1, 2, 3, 4, 5]])
  assert.deepEqual(strip.slots.map((slot) => slot?.open), [false, false, true, false, false])
  assert.equal(strip.under?.item, 'l2')
  assert.equal(strip.over?.item, 'l4')
  assert.equal(strip.under?.reviewId, 'change:rpg:l2')
  assert.equal(strip.line, 'This layer alone, on top of layer 2.')
})

test('the bottom layer has nothing under it and rests on the default branch', () => {
  const strip = stackStrip(five, 'rpg:l1')!
  assert.equal(strip.under, null)
  assert.equal(strip.over?.item, 'l2')
  assert.equal(strip.line, 'The bottom layer, on top of the default branch.')
})

test('the top layer has nothing over it', () => {
  const strip = stackStrip(five, 'rpg:l5')!
  assert.equal(strip.over, null)
  assert.equal(strip.under?.item, 'l4')
})

test('a review in no stack, or not among the changes, has no strip', () => {
  assert.equal(stackStrip([...five, change('solo', null)], 'rpg:solo'), null)
  assert.equal(stackStrip(five, 'rpg:nope'), null)
  assert.equal(stackStrip(five, null), null)
})

test('layers of another stack are left out', () => {
  const other = change('o1', 1, { id: 'zzz999', of: 2 })
  const strip = stackStrip([...five, other], 'rpg:l2')!
  assert.deepEqual(strip.slots.map((slot) => slot?.item), ['l1', 'l2', 'l3', 'l4', 'l5'])
})

test('a stack whose other layers are not here keeps every place and moves to the nearest layer that is', () => {
  const strip = stackStrip([change('l1', 1), change('l3', 3), change('l5', 5)], 'rpg:l3')!
  assert.deepEqual(strip.slots.map((slot) => slot?.item ?? null), ['l1', null, 'l3', null, 'l5'])
  assert.equal(strip.under?.item, 'l1')
  assert.equal(strip.over?.item, 'l5')
  const alone = stackStrip([change('l3', 3)], 'rpg:l3')!
  assert.equal(alone.of, 5)
  assert.deepEqual([alone.under, alone.over], [null, null])
})

const HEAD = 'c'.repeat(40)
/** Layer 1 opened a pull request, and layer 2 is at the commit another pull request is at. */
const pulled = [{ ...five[0]!, pr: 'https://github.com/acme/shop/pull/12' }, { ...five[1]!, head: HEAD }, ...five.slice(2)]

test('a review finds its change: by its own id, as the review of the pull request the change opened, or as a pull request at its commit', () => {
  assert.equal(openKeyOf(five, 'change:rpg:l4'), 'rpg:l4')
  assert.equal(openKeyOf(five, 'change:rpg:zz'), null)
  assert.equal(openKeyOf(five, 'sample'), null)

  assert.equal(openKeyOf(pulled, 'pr:acme/shop/12'), 'rpg:l1')
  assert.equal(openKeyOf(pulled, 'pr:acme/shop/13', HEAD), 'rpg:l2')
  assert.equal(openKeyOf(pulled, 'pr:acme/shop/14', 'd'.repeat(40)), null)
  assert.equal(openKeyOf(pulled, 'change:rpg:zz', HEAD), null, 'a change is found by its own id, never by a commit it shares')
})

test('a row in the AI Reviews list is told its layer as "2 of 5", and a change in no stack as nothing', () => {
  assert.equal(layerPlaceOf([...five, change('solo', null)], 'change:rpg:l2'), '2 of 5')
  assert.equal(layerPlaceOf([...five, change('solo', null)], 'change:rpg:solo'), null)
  assert.equal(layerPlaceOf(five, 'pr:acme/shop/12'), null)
  assert.equal(layerPlaceOf(pulled, 'pr:acme/shop/12'), '1 of 5', 'a layer that became a pull request is still a layer')
  assert.equal(layerPlaceOf(pulled, 'pr:acme/shop/13', HEAD), '2 of 5')
})

test("each layer's step says its review as the rest of the window does: reviewing while it is built again, queued only while it waits", () => {
  const review = (over: Partial<ReviewListItem>): ReviewListItem => ({ id: 'change:rpg:l2', kind: 'change', title: 'Title l2', project: 'rpsleague', head: 'h', state: 'ready', phase: null, error: null, updatedAt: '2026-11-24T12:00:00Z', ...over })
  const behindGraph = { state: 'queued' as const, head: 'h' }

  assert.deepEqual(layerStateOf(review({ phase: 'reading', assessment: behindGraph })), { tone: 'quiet', label: 'Reviewing', reviewing: true })
  assert.deepEqual(layerStateOf(review({ assessment: behindGraph })), { tone: 'quiet', label: 'Review queued', reviewing: true })
  assert.deepEqual(layerStateOf(undefined), { tone: 'quiet', label: 'Not reviewed yet', reviewing: false })
})
