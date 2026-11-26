import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openingFocus, startTakesKeyboard } from '../src/features/hobkins/sheet-keyboard.ts'

/** A stand-in for an element: the elements it holds, and whether it is a disabled button. */
function fakeElement(name: string, { holds = [], disabled = false }: { holds?: readonly Element[]; disabled?: boolean } = {}): HTMLButtonElement {
  const element = {
    name,
    disabled,
    contains: (other: unknown): boolean => other === element || holds.some((held) => held.contains(other as Node)),
  }
  return element as unknown as HTMLButtonElement
}

const start = fakeElement('Start')
const folderField = fakeElement('Folder')
const form = fakeElement('form', { holds: [folderField, start] })
const sheet = fakeElement('sheet', { holds: [form] })
const pageBehind = fakeElement('talk box behind the sheet')

test('the sheet opens with the keyboard on Start when Start can be pressed', () => {
  assert.equal(openingFocus(start, sheet), start)
})

test('while Start waits for the model settings, the sheet itself takes the keyboard, never the page behind', () => {
  const waitingStart = fakeElement('Start', { disabled: true })

  assert.equal(openingFocus(waitingStart, sheet), sheet)
  assert.equal(openingFocus(null, sheet), sheet)
})

test('once Start can be pressed it takes the keyboard from the sheet or from the page behind', () => {
  assert.equal(startTakesKeyboard(sheet, form), true)
  assert.equal(startTakesKeyboard(pageBehind, form), true)
  assert.equal(startTakesKeyboard(null, form), true)
})

test('Start leaves the keyboard where the user moved it inside the form', () => {
  assert.equal(startTakesKeyboard(folderField, form), false)
  assert.equal(startTakesKeyboard(start, form), false)
})
