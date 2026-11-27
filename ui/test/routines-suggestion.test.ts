import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'

// The chat store reaches other features through the `@/` alias, which node does not know on its own.
const aliasHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context)
    return nextResolve(pathToFileURL(resolve(import.meta.dirname, '../src', specifier.slice(2))).href, context)
  },
})
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } } })
after(() => {
  Reflect.deleteProperty(globalThis, 'window')
  aliasHooks.deregister()
})
const { useChat } = await import('../src/features/chat/chat-store.ts')
const { askForNewRoutine, suggestMessage, useRoutineSuggestion, watchRoutineSuggestion } = await import('../src/features/routines/ask.ts')

test('a suggested message goes into the input and the input takes the keyboard, and nothing is sent', (t) => {
  let focused = 0
  const stop = watchRoutineSuggestion(useChat, () => (focused += 1))
  t.after(stop)

  askForNewRoutine()

  assert.match(useChat.getState().draft.text, /^Help me set up a new routine\./)
  assert.equal(focused, 1)
  assert.equal(useChat.getState().outbox.entries.length, 0, 'sending stays the user\'s')
})

test('the same text suggested twice is put back the second time', (t) => {
  let focused = 0
  const stop = watchRoutineSuggestion(useChat, () => (focused += 1))
  t.after(stop)

  suggestMessage('Fix the inbox routine.')
  useChat.getState().change({ type: 'typed', text: 'something else' })
  suggestMessage('Fix the inbox routine.')

  assert.equal(useChat.getState().draft.text, 'Fix the inbox routine.')
  assert.equal(focused, 2)
})

test('a suggestion is taken once: one made before the input is there waits for it, and a later input never takes it again', () => {
  useChat.getState().change({ type: 'typed', text: '' })
  suggestMessage('Help me set up my first routine.')

  const first = watchRoutineSuggestion(useChat, () => {})
  first()
  assert.equal(useChat.getState().draft.text, 'Help me set up my first routine.')
  assert.equal(useRoutineSuggestion.getState().suggestion, null)

  useChat.getState().change({ type: 'typed', text: 'my own words' })
  const again = watchRoutineSuggestion(useChat, () => {})
  again()
  assert.equal(useChat.getState().draft.text, 'my own words', 'an input drawn again, as after a reload of its code, finds nothing to take')
})
