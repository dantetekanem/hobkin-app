import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CANCEL_CONFIRM_MS, createScheduleActions, type ScheduleSend } from '../src/features/schedules/actions.ts'
import { scheduleListKey } from '../src/features/schedules/schedule-keys.ts'

function recorder(answer: (name: string) => Promise<unknown> = async () => ({ ok: true })) {
  const sent: [string, unknown][] = []
  const send: ScheduleSend = (name, args) => {
    sent.push([name, args])
    return answer(name)
  }
  return { sent, send }
}

test('Cancel asks first, and only a second press within ten seconds cancels', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sent, send } = recorder()
  const actions = createScheduleActions({ id: 's1', send })
  await actions.press('cancel')
  assert.equal(actions.getState().armed, true, 'the first press asks')
  assert.deepEqual(sent, [], 'and sends nothing')
  t.mock.timers.tick(CANCEL_CONFIRM_MS - 1)
  await actions.press('cancel')
  assert.deepEqual(sent, [['schedule.cancel', { id: 's1' }]])
  assert.equal(actions.getState().armed, false)
})

test('Cancel goes back by itself ten seconds after the first press', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sent, send } = recorder()
  const actions = createScheduleActions({ id: 's1', send })
  await actions.press('cancel')
  t.mock.timers.tick(CANCEL_CONFIRM_MS)
  assert.equal(actions.getState().armed, false, 'it asks no more')
  await actions.press('cancel')
  assert.deepEqual(sent, [], 'a press after that asks again instead of cancelling')
  assert.equal(actions.getState().armed, true)
  actions.dispose()
  assert.equal(actions.getState().armed, false, 'a row that leaves forgets the question')
})

test('Run now, Pause and Resume each send their command at once, and another press takes the question back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sent, send } = recorder()
  const actions = createScheduleActions({ id: 's2', send })
  await actions.press('cancel')
  await actions.press('run')
  assert.equal(actions.getState().armed, false)
  await actions.press('pause')
  await actions.press('resume')
  assert.deepEqual(sent, [
    ['schedule.run', { id: 's2' }],
    ['schedule.pause', { id: 's2', paused: true }],
    ['schedule.pause', { id: 's2', paused: false }],
  ])
})

test('a refusal from the host stays on the row until the next press, and a press while one is on its way is ignored', async () => {
  let release: () => void = () => {}
  const { sent, send } = recorder((name) =>
    name === 'schedule.run' ? new Promise<void>((resolve) => (release = resolve)) : Promise.reject(new Error('That schedule has ended.')),
  )
  const actions = createScheduleActions({ id: 's3', send })
  await actions.press('pause')
  assert.equal(actions.getState().refused, 'That schedule has ended.')
  const running = actions.press('run')
  assert.equal(actions.getState().refused, null, 'a new press clears the old refusal')
  assert.equal(actions.getState().busy, 'run')
  await actions.press('pause')
  assert.equal(sent.length, 2, 'nothing more is sent while the run is on its way')
  release()
  await running
  assert.equal(actions.getState().busy, null)
})

test('Control+Option+W opens and closes the schedules, whatever character Option makes W type', () => {
  const closed = { open: false, inList: false }
  assert.equal(scheduleListKey({ key: '∑', code: 'KeyW', ctrl: true, alt: true }, closed), 'toggle')
  assert.equal(scheduleListKey({ key: 'w', code: 'KeyW', ctrl: true, alt: true }, { open: true, inList: true }), 'toggle')
  assert.equal(scheduleListKey({ key: 'w', code: 'KeyW', ctrl: true }, closed), null)
  assert.equal(scheduleListKey({ key: 'w', code: 'KeyW', ctrl: true, alt: true, meta: true }, closed), null)
  assert.equal(scheduleListKey({ key: 'W', code: 'KeyW', ctrl: true, alt: true, shift: true }, closed), null)
})

test('Escape closes the open list only while the keyboard is in it or on its line', () => {
  assert.equal(scheduleListKey({ key: 'Escape' }, { open: true, inList: true }), 'close')
  assert.equal(scheduleListKey({ key: 'Escape' }, { open: true, inList: false }), null, 'from the input it stays the input’s, which stops a turn with it')
  assert.equal(scheduleListKey({ key: 'Escape' }, { open: false, inList: true }), null)
  assert.equal(scheduleListKey({ key: 'Escape', shift: true }, { open: true, inList: true }), null)
})
