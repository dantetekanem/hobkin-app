import assert from 'node:assert/strict'
import { test } from 'node:test'
import { watchAskTyping } from '../src/features/questions/typing.ts'

test('Ask gives two seconds after the last edit, including after composing text', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = new EventTarget()
  let typing = false
  const stop = watchAskTyping(page, (busy) => { typing = busy })
  const edit = () => page.dispatchEvent(Object.assign(new Event('input'), { inputType: 'insertText' }))

  edit()
  t.mock.timers.tick(1500)
  edit()
  t.mock.timers.tick(1999)
  assert.equal(typing, true)
  t.mock.timers.tick(1)
  assert.equal(typing, false)

  page.dispatchEvent(new Event('compositionstart'))
  edit()
  t.mock.timers.tick(3000)
  assert.equal(typing, true)
  page.dispatchEvent(new Event('compositionend'))
  t.mock.timers.tick(2000)
  assert.equal(typing, false)
  stop()
  edit()
  assert.equal(typing, false)
})
