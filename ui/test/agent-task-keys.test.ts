import assert from 'node:assert/strict'
import { test } from 'node:test'
import { taskListKey } from '../src/features/agent-activity/task-keys.ts'

const closed = { open: false, inList: false }

test('Control+Option+T opens and closes the task list, whatever character Option makes T type', () => {
  assert.equal(taskListKey({ key: '†', code: 'KeyT', ctrl: true, alt: true }, closed), 'toggle')
  assert.equal(taskListKey({ key: 't', code: 'KeyT', ctrl: true, alt: true }, { open: true, inList: true }), 'toggle')
})

test('T with other modifiers is not the task list’s', () => {
  assert.equal(taskListKey({ key: 't', code: 'KeyT', ctrl: true }, closed), null)
  assert.equal(taskListKey({ key: '†', code: 'KeyT', alt: true }, closed), null)
  assert.equal(taskListKey({ key: 't', code: 'KeyT', ctrl: true, alt: true, meta: true }, closed), null)
  assert.equal(taskListKey({ key: 'T', code: 'KeyT', ctrl: true, alt: true, shift: true }, closed), null)
})

test('Escape closes the open list only while the keyboard is in it', () => {
  assert.equal(taskListKey({ key: 'Escape' }, { open: true, inList: true }), 'close')
  assert.equal(taskListKey({ key: 'Escape' }, { open: true, inList: false }), null, 'from the input it stays the frame’s')
  assert.equal(taskListKey({ key: 'Escape' }, { open: false, inList: true }), null, 'a closed list leaves it to the frame')
  assert.equal(taskListKey({ key: 'Escape', shift: true }, { open: true, inList: true }), null)
})
