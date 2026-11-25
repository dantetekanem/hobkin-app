import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatBack } from '../src/app/chat-back.ts'

test("a durable hobkin's split takes the chat away under its page, and a review dims the strip of chat it leaves", () => {
  assert.equal(chatBack({ reviewing: false, split: true, needsModel: false }), 'gone', 'the page lies over all of the chat')
  assert.equal(chatBack({ reviewing: true, split: false, needsModel: false }), 'dim', 'a strip of the chat stays in view')
  assert.equal(chatBack({ reviewing: false, split: false, needsModel: false }), null, 'every other screen leaves the chat as it is')
})

test('the model setup, which draws no split, leaves the chat in view', () => {
  assert.equal(chatBack({ reviewing: false, split: true, needsModel: true }), null)
})
