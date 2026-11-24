import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONFIRM_MS, createTwoClicks } from '../src/lib/two-clicks.ts'

type Way = 'completed' | 'not-planned'

// The two clicks: the first arms the button for ten seconds and the second does the thing, with the way chosen.

/** The button over a stand-in for what it does that answers as told, and every way it was asked to act with. */
function button(answer: (way: Way) => Promise<string> = async (reason) => `Closed as ${reason}.`) {
  const asked: Way[] = []
  const flow = createTwoClicks<Way>({
    initial: 'completed',
    run: (reason) => {
      asked.push(reason)
      return answer(reason)
    },
  })
  return { flow, asked }
}

test('one click only arms the button; a second within ten seconds does it, with the first way unless the user chose another', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { flow, asked } = button()

  await flow.press()
  assert.deepEqual([flow.getState().armed, asked], [true, []])
  t.mock.timers.tick(CONFIRM_MS - 1)
  await flow.press()

  assert.equal(CONFIRM_MS, 10_000)
  assert.deepEqual(asked, ['completed'])
  assert.deepEqual(flow.getState(), { armed: false, choice: 'completed', busy: false, said: { tone: 'done', text: 'Closed as completed.' } })
})

test('left alone it goes back after ten seconds, and the next click only arms it again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { flow, asked } = button()

  await flow.press()
  t.mock.timers.tick(CONFIRM_MS)
  assert.equal(flow.getState().armed, false)
  await flow.press()

  assert.deepEqual([flow.getState().armed, asked], [true, []])
})

test('choosing Not planned while it waits gives it ten seconds again, and closes it as not planned', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { flow, asked } = button()

  await flow.press()
  t.mock.timers.tick(CONFIRM_MS - 1000)
  flow.choose('not-planned')
  t.mock.timers.tick(CONFIRM_MS - 1000)
  assert.equal(flow.getState().armed, true, 'the choice started the ten seconds again')
  await flow.press()

  assert.deepEqual(asked, ['not-planned'])
})

test('Escape or leaving the button takes the first click back, so the next click only arms it again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { flow, asked } = button()

  await flow.press()
  flow.cancel()
  const afterCancel = flow.getState().armed
  await flow.press()

  assert.equal(afterCancel, false)
  assert.deepEqual([flow.getState().armed, asked], [true, []])
})

test('a click while it is being done does nothing, so it is done once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let finish: (text: string) => void = () => {}
  const { flow, asked } = button(() => new Promise((resolve) => (finish = resolve)))

  await flow.press()
  const closing = flow.press()
  const busyWhileClosing = flow.getState().busy
  await flow.press()
  finish('Closed.')
  await closing

  assert.equal(busyWhileClosing, true)
  assert.deepEqual(asked, ['completed'])
})

test('a refusal says why, and the button is ready to arm again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const why = 'gh said: GraphQL: Resource not accessible by integration (closeIssue)'
  const { flow } = button(async () => {
    throw new Error(why)
  })

  await flow.press()
  await flow.press()

  assert.deepEqual(flow.getState(), { armed: false, choice: 'completed', busy: false, said: { tone: 'refused', text: why } })
})
