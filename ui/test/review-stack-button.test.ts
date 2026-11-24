import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { StackPlan } from '#shared/review/stack-plan.ts'
import { stackPlan } from '#shared/review/stack-plan.ts'
import type { Review } from '#shared/review/types.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'
import { stackBox, stackBoxOpen, stackButton, type StackButtonInput } from '../src/features/review/panel/stack-button.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const effects = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, proofKey: () => {} }
const ready: StackButtonInput = { merged: false, ready: true, sample: false, outdated: false, readLines: 120 }

test('the button ends the size row from the first paint, disabled until the review is ready, emphasized past 300 lines a reviewer reads, and absent once merged', () => {
  const waiting = stackButton({ ...ready, ready: false })
  assert.deepEqual([waiting.shown, waiting.disabled, waiting.emphasized], [true, true, false], 'there from the first paint, so nothing moves when the review arrives')
  assert.equal(waiting.tooltip, 'The plan is made from the review, once it is ready.')

  const small = stackButton(ready)
  assert.deepEqual([small.shown, small.disabled, small.emphasized], [true, false, false])

  const atLine = stackButton({ ...ready, readLines: 300 })
  assert.equal(atLine.emphasized, false, '300 is where a layer stops, not past it')

  const big = stackButton({ ...ready, readLines: 1586 })
  assert.deepEqual([big.shown, big.disabled, big.emphasized], [true, false, true])
  assert.equal(big.tooltip, '1,586 changed lines to read, past the 300 a reviewer takes in at a sitting.')
  assert.doesNotMatch(big.tooltip, /risk/i, 'the emphasis is about size, never risk')

  // Not ready stays plain even for a big change: there is no plan to point at yet.
  assert.equal(stackButton({ ...ready, ready: false, readLines: 1586 }).emphasized, false)

  assert.equal(stackButton({ ...ready, merged: true }).shown, false)
  assert.equal(stackButton({ ...ready, ready: false, merged: true }).shown, false)
})

test('a press or ⇧S opens the plan, Escape closes it, and each case that cannot be done says why', () => {
  // ⇧S is the stack's key, and S alone is still the panel's.
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  const log: string[] = []
  const heard = { ...effects, toggleSteps: () => log.push('steps'), toggleStack: () => log.push('stack') }
  assert.equal(pressKey(session.getState(), { key: 'S', shift: true, alt: false }, heard), true)
  assert.equal(pressKey(session.getState(), { key: 's', shift: false, alt: false }, heard), true)
  assert.deepEqual(log, ['stack', 'steps'])
  // `{` and `}` belong to the layers of a built stack, a later step: nothing here takes them.
  for (const key of ['{', '}']) assert.equal(pressKey(session.getState(), { key, shift: true, alt: false }, heard), false)
  // Without a window that can show the box, ⇧S stays a key nobody uses.
  assert.equal(pressKey(session.getState(), { key: 'S', shift: true, alt: false }, effects), false)

  const enabled = stackButton(ready)
  const disabled = stackButton({ ...ready, ready: false })
  assert.equal(stackBoxOpen(false, 'toggle', enabled), true)
  assert.equal(stackBoxOpen(true, 'toggle', enabled), false)
  assert.equal(stackBoxOpen(true, 'escape', enabled), false)
  assert.equal(stackBoxOpen(false, 'escape', enabled), false)
  assert.equal(stackBoxOpen(false, 'toggle', disabled), false, 'a button that is disabled opens nothing, by key or press')
  assert.equal(stackBoxOpen(true, 'toggle', stackButton({ ...ready, merged: true })), false, 'a change that merged while it was open closes the box')

  const plan: StackPlan = {
    layers: [
      { number: 1, kind: 'mechanical', title: 'Lockfile and renames', files: ['a', 'b', 'c'], additions: 40, deletions: 12, lines: 52, needsYou: 0, splitFurther: false },
      { number: 2, kind: 'behaviour', title: 'Models · Sessions', files: ['d'], additions: 300, deletions: 50, lines: 350, needsYou: 2, splitFurther: true },
    ],
  }
  const open = stackBox(ready, plan)
  assert.equal(open.heading, 'A stack of 2, bottom first')
  assert.deepEqual(open.rows.map((row) => row.text), [
    '1 · Mechanical · Lockfile and renames · 3 files · +40 −12',
    '2 · Behaviour · Models · Sessions · 1 file · +300 −50 · 2 need you',
  ])
  assert.equal(open.rows[1]!.note, 'This zone is over 300 lines, so the agent splits it further, or says why not.')
  assert.equal(open.note, null)
  assert.equal(open.footer, 'hobkin cannot build a stack yet.', 'nothing can be built from here yet, so no Build')

  const older = stackBox({ ...ready, outdated: true }, plan)
  assert.equal(older.footer, 'This review is of an older commit. Rebuild it first: a stack is made from the commit its review read.')
  assert.equal(stackBox({ ...ready, sample: true }, plan).footer, 'Sample review: nothing is made from here.')

  const one = stackBox(ready, { layers: [plan.layers[0]!] })
  assert.equal(one.heading, 'One layer')
  assert.equal(one.note, "The review's facts give one layer. The agent can still split it inside its files.")
  assert.equal(one.footer, 'hobkin cannot build a stack yet.')
  const none = stackBox(ready, { layers: [] })
  assert.deepEqual([none.heading, none.rows, none.footer], ['No layers', [], 'The review lists no changed files.'])
})

test('the sample reviews give a plan with every changed file in one layer', () => {
  const plan = stackPlan(sample)
  const changed = sample.files.filter((file) => file.status !== 'unchanged').map((file) => file.path)
  assert.deepEqual(plan.layers.flatMap((layer) => layer.files).sort(), changed.sort())
})
