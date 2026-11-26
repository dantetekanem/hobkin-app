import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openingFocus, startTakesKeyboard } from '../src/features/hobkins/sheet-keyboard.ts'

/** A stand-in for an element: what it holds, and whether it is a disabled button. */
function node(name: string, children: readonly object[] = [], disabled = false) {
  const inside = (other: unknown): boolean => other === self || children.some((child) => (child as { contains(o: unknown): boolean }).contains(other))
  const self = { name, disabled, contains: inside }
  return self as unknown as HTMLButtonElement
}

const start = node('start')
const folder = node('folder')
const form = node('form', [folder, start])
const popup = node('popup', [form])
const behind = node('talk box behind the sheet')

test('the sheet opens with the keyboard on Start when Start can be pressed', () => {
  assert.equal(openingFocus(start, popup), start)
})

test('while Start waits for the model settings, the sheet itself takes the keyboard, never the page behind', () => {
  assert.equal(openingFocus(node('start', [], true), popup), popup)
  assert.equal(openingFocus(null, popup), popup)
})

test('once Start can be pressed it takes the keyboard from the sheet or from the page behind', () => {
  assert.equal(startTakesKeyboard(popup, form), true)
  assert.equal(startTakesKeyboard(behind, form), true)
  assert.equal(startTakesKeyboard(null, form), true)
})

test('Start leaves the keyboard where the user moved it inside the form', () => {
  assert.equal(startTakesKeyboard(folder, form), false)
  assert.equal(startTakesKeyboard(start, form), false)
})
