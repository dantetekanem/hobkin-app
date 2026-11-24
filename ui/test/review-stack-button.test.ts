import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'
import { createStackStart, focusStackButton, rowOffersStack, SAMPLE_STACK, stackButton, type StackStarted } from '../src/features/review/stack-start.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const effects = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, proofKey: () => {} }
const input = { merged: false, busy: false, lines: 120 }

test('the button is there only on a change above 300 changed lines that has not merged, and never about risk', () => {
  assert.equal(stackButton(input).shown, false, '120 lines: no button')
  assert.equal(stackButton({ ...input, lines: 300 }).shown, false, '300 is where a reviewer stops, not past it')
  assert.equal(stackButton({ ...input, lines: 301 }).shown, true)

  const big = stackButton({ ...input, lines: 1586 })
  assert.deepEqual([big.shown, big.busy], [true, false])
  assert.match(big.tooltip, /^1,586 changed lines/)
  assert.match(big.tooltip, /agent splits/)
  assert.doesNotMatch(big.tooltip, /risk/i)

  assert.equal(stackButton({ ...input, lines: 1586, busy: true }).busy, true)
  assert.equal(stackButton({ ...input, lines: 1586, merged: true }).shown, false)
  assert.equal(stackButton({ ...input, lines: 1586, merged: true, busy: true }).busy, false)
})

test('a row offers the stack only when it knows the change is above 300 lines', () => {
  assert.equal(rowOffersStack({}), false, 'a row with no size offers none')
  assert.equal(rowOffersStack({ lines: 300 }), false)
  assert.equal(rowOffersStack({ lines: 301 }), true)
})

function start({ live = true, answer = { hobkin: 'h1', run: 'r1', already: false } as StackStarted | Error } = {}) {
  const calls: string[] = []
  const opened: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const command = async (id: string) => {
    calls.push(id)
    await gate
    if (answer instanceof Error) throw answer
    return answer
  }
  const flow = createStackStart({ id: 'pr:acme/shop/9', live, command, opened: (hobkin) => opened.push(hobkin) })
  return { flow, calls, opened, release }
}

test('a press asks the host once with the review, a second press while it is on its way does nothing, and the answer opens the hobkin page', async () => {
  const { flow, calls, opened, release } = start()
  const first = flow.press()
  assert.equal(flow.getState().busy, true)
  await flow.press()
  assert.deepEqual(calls, ['pr:acme/shop/9'], 'one call, not two')
  release()
  await first
  assert.deepEqual(opened, ['h1'])
  assert.deepEqual(flow.getState(), { busy: false, error: null })
})

test('an agent that was already there is opened the same, and a refusal stays as one line until the next press', async () => {
  const there = start({ answer: { hobkin: 'h7', run: null, already: true } })
  there.release()
  await there.flow.press()
  assert.deepEqual(there.opened, ['h7'])

  const refused = start({ answer: new Error('That change merged.') })
  refused.release()
  await refused.flow.press()
  assert.deepEqual(refused.opened, [])
  assert.deepEqual(refused.flow.getState(), { busy: false, error: 'That change merged.' })
  await refused.flow.press()
  assert.equal(refused.calls.length, 2, 'it can be asked again, and the old line is cleared while it is')
})

test('with no host a press says a sample review starts nothing, and asks nobody', async () => {
  const { flow, calls, opened } = start({ live: false })
  await flow.press()
  assert.deepEqual(calls, [])
  assert.deepEqual(opened, [])
  assert.deepEqual(flow.getState(), { busy: false, error: SAMPLE_STACK })
})

test('Shift+S in the review puts the keyboard on the button, and S alone still hides the panel', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  const log: string[] = []
  const heard = { ...effects, toggleSteps: () => log.push('steps'), focusStack: () => log.push('stack') }
  assert.equal(pressKey(session.getState(), { key: 'S', shift: true, alt: false }, heard), true)
  assert.equal(pressKey(session.getState(), { key: 's', shift: false, alt: false }, heard), true)
  assert.deepEqual(log, ['stack', 'steps'])
  assert.equal(pressKey(session.getState(), { key: 'S', shift: true, alt: false }, effects), false, 'a window with no button leaves the key unused')
})

test('the key puts the keyboard on the button wherever it stands, and does nothing when the review has none', () => {
  const focused: unknown[] = []
  const button = { focus: (options?: unknown) => focused.push(options) }
  assert.equal(focusStackButton({ querySelector: (selector) => (selector === '[data-rv-stack]' ? button : null) }), true)
  assert.deepEqual(focused, [{ preventScroll: true }])
  assert.equal(focusStackButton({ querySelector: () => null }), false)
  assert.equal(focusStackButton(null), false)
  assert.equal(focused.length, 1)
})
