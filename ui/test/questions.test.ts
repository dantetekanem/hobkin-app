import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WAIT_MS, advance, answer, current, defer, emptyQueue, raise, timeLeft, type Question } from '../src/features/questions/queue.ts'

const question = (id: string): Question => ({
  id,
  from: 'hobkin',
  question: `Question ${id}?`,
  choices: [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ],
})

test('questions show one at a time, in order', () => {
  let queue = raise(raise(emptyQueue, question('a')), question('b'))

  assert.equal(current(queue)?.id, 'a')
  assert.deepEqual(current(queue) && { at: queue.waiting.indexOf(current(queue)!) + 1, of: queue.waiting.length }, { at: 1, of: 2 })

  queue = answer(queue, 'a', { value: 'yes' })
  assert.equal(current(queue)?.id, 'b')

  queue = answer(queue, 'b', { value: 'no' })
  assert.equal(current(queue), null)
})

test('a question raised twice waits once', () => {
  const queue = raise(raise(emptyQueue, question('a')), question('a'))
  assert.equal(queue.waiting.length, 1)
})

test('a number, a click or Enter answers with the choice', () => {
  const queue = answer(raise(emptyQueue, question('a')), 'a', { value: 'no' })

  assert.equal(queue.waiting.length, 0)
  assert.deepEqual(queue.answered, [{ id: 'a', answer: { value: 'no' } }])
})

test('a choice the question does not offer answers nothing', () => {
  const before = raise(emptyQueue, question('a'))
  assert.equal(answer(before, 'a', { value: 'maybe' }), before)
})

test('typed text answers, and an empty field does not', () => {
  const before = raise(emptyQueue, question('a'))

  assert.equal(answer(before, 'a', { typed: '   ' }), before, 'only spaces is empty')
  assert.deepEqual(answer(before, 'a', { typed: '  ask me tomorrow ' }).answered, [{ id: 'a', answer: { typed: 'ask me tomorrow' } }])
})

test('putting a question off sends it to action items', () => {
  const queue = defer(raise(raise(emptyQueue, question('a')), question('b')), 'a')

  assert.equal(current(queue)?.id, 'b', 'the next one comes up')
  assert.deepEqual(queue.deferred.map((item) => item.id), ['a'])
  assert.deepEqual(queue.deferred[0]!.choices, question('a').choices, 'with the same choices')
  assert.deepEqual(queue.answered, [])
})

test('the time runs only while the user is idle', () => {
  let queue = raise(emptyQueue, question('a'))
  assert.equal(timeLeft(queue), WAIT_MS)

  queue = advance(queue, 10_000, false)
  assert.equal(timeLeft(queue), WAIT_MS - 10_000)

  queue = advance(queue, 60_000, true)
  assert.equal(timeLeft(queue), WAIT_MS - 10_000, 'choosing or typing holds the clock')
  assert.equal(current(queue)?.id, 'a')
})

test('left alone for the whole wait, the question moves to action items', () => {
  const queue = advance(raise(raise(emptyQueue, question('a')), question('b')), WAIT_MS, false)

  assert.deepEqual(queue.deferred.map((item) => item.id), ['a'])
  assert.equal(current(queue)?.id, 'b')
  assert.equal(timeLeft(queue), WAIT_MS, 'the next question gets its own full wait')
})
