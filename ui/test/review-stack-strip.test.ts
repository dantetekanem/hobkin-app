import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinishedChange, StackPlace } from '#shared/protocol/work.ts'
import { layerPlaceOf, openKeyOf, stackStrip } from '../src/features/review/stack-strip.ts'

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

test('a review id finds its change', () => {
  assert.equal(openKeyOf(five, 'change:rpg:l4'), 'rpg:l4')
  assert.equal(openKeyOf(five, 'change:rpg:zz'), null)
  assert.equal(openKeyOf(five, 'sample'), null)
})

test('a row in the AI Reviews list is told its layer as "2 of 5", and a change in no stack as nothing', () => {
  assert.equal(layerPlaceOf([...five, change('solo', null)], 'change:rpg:l2'), '2 of 5')
  assert.equal(layerPlaceOf([...five, change('solo', null)], 'change:rpg:solo'), null)
  assert.equal(layerPlaceOf(five, 'pr:acme/shop/12'), null)
})
