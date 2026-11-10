import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setupWanted } from '../src/features/onboarding/first-run.ts'
import { STEPS, startFlow, stepFlow, type Flow, type FlowEvent } from '../src/features/onboarding/flow.ts'
import { resolveSetupKey, type SetupKeyContext, type SetupPress } from '../src/features/onboarding/keys.ts'

const run = (events: FlowEvent[], from: Flow = startFlow()) => events.reduce(stepFlow, from)

const TO_READY: FlowEvent[] = ['next', 'next', 'next', 'next']

test('the steps come in order, and going on from the last one ends the setup as done', () => {
  const atReady = run(TO_READY)
  const pastReady = stepFlow(atReady, 'next')

  assert.deepEqual(STEPS, ['welcome', 'about', 'connect', 'settings', 'ready'])
  assert.deepEqual(startFlow(), { step: 'welcome', direction: 1, ended: null })
  assert.equal(run(['next']).step, 'about')
  assert.equal(atReady.step, 'ready')
  assert.equal(atReady.ended, null)
  assert.deepEqual(pastReady, { step: 'ready', direction: 1, ended: 'done' })
})

test('back goes one step back, and the first step has nothing behind it', () => {
  const back = run(['next', 'next', 'back'])
  const onAgain = run(['next', 'back', 'next'])

  assert.equal(back.step, 'about')
  assert.equal(back.direction, -1, 'the steps travel the other way')
  assert.equal(onAgain.direction, 1)
  assert.deepEqual(run(['back']), startFlow())
})

test('skip ends the setup from any step, as skipped', () => {
  for (const [index, step] of STEPS.entries()) {
    const skipped = run([...Array<FlowEvent>(index).fill('next'), 'skip'])

    assert.equal(skipped.ended, 'skipped')
    assert.equal(skipped.step, step, 'it ends where it was')
  }
})

test('nothing moves once the setup has ended', () => {
  const done = run([...TO_READY, 'next'])
  const skipped = run(['next', 'skip'])

  for (const event of ['next', 'back', 'skip'] as const) {
    assert.deepEqual(stepFlow(done, event), done)
  }
  assert.deepEqual(stepFlow(skipped, 'next'), skipped)
})

/** The keyboard on something that uses no keys itself, such as the setup's own background. */
const at: SetupKeyContext = { typing: false, pressable: false, sideways: false, walks: false, signingIn: false }
const press = (key: string, more: Partial<SetupPress> = {}): SetupPress => ({ key, ...more })

test('Enter goes on, except in a field or on a button, which use it themselves', () => {
  assert.deepEqual(resolveSetupKey(press('Enter'), at), { do: 'next' })
  assert.deepEqual(resolveSetupKey(press('Enter'), { ...at, sideways: true }), { do: 'next' }, 'a choice does not use Enter')
  assert.equal(resolveSetupKey(press('Enter'), { ...at, pressable: true }), null)
  assert.equal(resolveSetupKey(press('Enter'), { ...at, typing: true }), null)
  assert.equal(resolveSetupKey(press('Enter', { shift: true }), at), null)
})

test('Escape goes back, and cancels a sign-in that is under way first', () => {
  assert.deepEqual(resolveSetupKey(press('Escape'), at), { do: 'back' })
  assert.deepEqual(resolveSetupKey(press('Escape'), { ...at, typing: true }), { do: 'back' })
  assert.deepEqual(resolveSetupKey(press('Escape'), { ...at, signingIn: true }), { do: 'cancel-signin' })
})

test('Left goes back unless the control uses Left and Right itself', () => {
  assert.deepEqual(resolveSetupKey(press('ArrowLeft'), at), { do: 'back' })
  assert.deepEqual(resolveSetupKey(press('ArrowLeft'), { ...at, pressable: true }), { do: 'back' })
  assert.equal(resolveSetupKey(press('ArrowLeft'), { ...at, sideways: true }), null, 'a choice changes')
  assert.equal(resolveSetupKey(press('ArrowLeft'), { ...at, typing: true }), null, 'the caret moves')
  assert.equal(resolveSetupKey(press('ArrowRight'), at), null, 'Right is never the setup\'s')
})

test('Up and Down move between the controls, except in a list that walks itself', () => {
  assert.deepEqual(resolveSetupKey(press('ArrowDown'), at), { do: 'move', delta: 1 })
  assert.deepEqual(resolveSetupKey(press('ArrowUp'), { ...at, sideways: true }), { do: 'move', delta: -1 })
  assert.deepEqual(resolveSetupKey(press('ArrowDown'), { ...at, typing: true }), { do: 'move', delta: 1 }, 'a one-line field has no lines to walk')
  assert.equal(resolveSetupKey(press('ArrowDown'), { ...at, walks: true }), null)
})

test('keys held with Command, Control or Option are left alone', () => {
  for (const key of ['Enter', 'Escape', 'ArrowLeft', 'ArrowDown']) {
    assert.equal(resolveSetupKey(press(key, { meta: true }), at), null)
    assert.equal(resolveSetupKey(press(key, { ctrl: true }), at), null)
    assert.equal(resolveSetupKey(press(key, { alt: true }), at), null)
  }
  assert.equal(resolveSetupKey(press('Tab'), at), null, 'Tab keeps its usual meaning inside the setup')
})

test('the setup shows on the first run, and not once it has been seen', () => {
  assert.equal(setupWanted(null, ''), true)
  assert.equal(setupWanted('seen', ''), false)
  assert.equal(setupWanted('something else', ''), true, 'only the setup\'s own mark counts')
})

test('?setup=1 in the address shows it whatever was saved', () => {
  assert.equal(setupWanted('seen', '?setup=1'), true)
  assert.equal(setupWanted('seen', '?theme=dark&setup=1'), true)
  assert.equal(setupWanted('seen', '?setup=0'), false)
  assert.equal(setupWanted('seen', '?other=1'), false)
})
