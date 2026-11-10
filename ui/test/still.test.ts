import assert from 'node:assert/strict'
import { test } from 'node:test'
import { holdStill, isStill, stillVariants } from '../src/app/still-rule.ts'

test('still holds when the setting says still, whatever the Mac says', () => {
  assert.equal(isStill('still', false), true)
  assert.equal(isStill('still', true), true)
})

test('following the Mac holds still only when the Mac asks for less movement', () => {
  assert.equal(isStill('system', true), true)
  assert.equal(isStill('system', false), false)
})

test('lively moves even when the Mac asks for less', () => {
  assert.equal(isStill('lively', true), false)
  assert.equal(isStill('lively', false), false)
})

test('held still, a target keeps its fade and loses its travel; moving, it is left as it is', () => {
  const target = { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { duration: 0.2 } }
  assert.deepEqual(holdStill(target, true), { opacity: 1, transition: { duration: 0.2 } })
  assert.equal(holdStill(target, false), target)
  assert.deepEqual(holdStill({ opacity: 0 }, true), { opacity: 0 })
})

test('held still, every variant loses its travel, including variants that take a custom value', () => {
  const variants = {
    enter: { opacity: 0, transform: 'translateY(18px)' },
    center: (order: number) => ({ opacity: 1, transform: 'translateY(0px)', transition: { delay: order } }),
  }
  const held = stillVariants(variants, true)
  assert.deepEqual(held.enter, { opacity: 0 })
  assert.deepEqual((held.center as (order: number) => object)(2), { opacity: 1, transition: { delay: 2 } })
  assert.equal(stillVariants(variants, false), variants)
})
