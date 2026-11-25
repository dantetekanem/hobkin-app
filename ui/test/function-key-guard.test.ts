import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installFunctionKeyGuard, typesFunctionKey } from '../src/app/function-key-guard.ts'

test('an arrow or another function key typed as text is caught, and real text is not', () => {
  assert.equal(typesFunctionKey({ inputType: 'insertText', data: '' }), true, 'Left')
  assert.equal(typesFunctionKey({ inputType: 'insertText', data: '' }), true, 'Right')
  assert.equal(typesFunctionKey({ inputType: 'insertCompositionText', data: '' }), true, 'Up, while composing')
  assert.equal(typesFunctionKey({ inputType: 'insertText', data: '' }), true, 'the last of them')
  assert.equal(typesFunctionKey({ inputType: 'insertText', data: 'a' }), false)
  assert.equal(typesFunctionKey({ inputType: 'insertText', data: 'é' }), false)
  assert.equal(typesFunctionKey({ inputType: 'insertText', data: '' }), false, 'past the function keys')
  assert.equal(typesFunctionKey({ inputType: 'insertText', data: null }), false)
  assert.equal(typesFunctionKey({ inputType: 'insertFromPaste', data: '' }), false, 'a paste is the user’s own')
  assert.equal(typesFunctionKey({ inputType: 'deleteContentBackward', data: null }), false)
})

test('the guard stops what it catches before any text box takes it, and installs once however often it loads', () => {
  const listeners = new Set<(event: Event) => void>()
  const target = {
    addEventListener: (_name: string, listener: (event: Event) => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: (event: Event) => void) => listeners.delete(listener),
  }
  installFunctionKeyGuard(target)
  installFunctionKeyGuard(target)
  assert.equal(listeners.size, 1, 'a hot update replaces the listener rather than adding one')

  const fire = (inputType: string, data: string | null) => {
    let prevented = false
    const event = { inputType, data, preventDefault: () => (prevented = true) } as unknown as Event
    for (const listener of listeners) listener(event)
    return prevented
  }
  assert.equal(fire('insertText', ''), true)
  assert.equal(fire('insertText', 'x'), false)
})
