import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { transientLine } from '../src/features/chat/transient-line.ts'

test('a transient line is dismissed after its time, and showing another restarts the time', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  let dismissed = 0
  const line = transientLine(() => dismissed++, 7000)
  line.show()
  mock.timers.tick(5000)
  line.show()
  mock.timers.tick(5000)
  assert.equal(dismissed, 0)
  mock.timers.tick(2000)
  assert.equal(dismissed, 1)
  mock.timers.reset()
})

test('holding the line pauses its time, and releasing it gives back what was left', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  let dismissed = 0
  const line = transientLine(() => dismissed++, 7000)
  line.show()
  mock.timers.tick(4000)
  line.hold()
  mock.timers.tick(60000)
  assert.equal(dismissed, 0)
  line.release()
  mock.timers.tick(2900)
  assert.equal(dismissed, 0)
  mock.timers.tick(100)
  assert.equal(dismissed, 1)
  line.release()
  mock.timers.tick(10000)
  assert.equal(dismissed, 1, 'a released line that is gone does not come back')
  mock.timers.reset()
})

test('clearing the line cancels its time', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  let dismissed = 0
  const line = transientLine(() => dismissed++, 7000)
  line.show()
  line.clear()
  mock.timers.tick(10000)
  assert.equal(dismissed, 0)
  mock.timers.reset()
})
