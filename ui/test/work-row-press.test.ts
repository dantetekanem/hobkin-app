import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pressesRow } from '../src/features/work/row-press.ts'

/** A piece of a page: its parent, and whether it is a control of its own (a button, a link, a field, a choice). */
interface Fake {
  parent: Fake | null
  control: boolean
  closest: (selectors: string) => Fake | null
  contains: (other: Fake | null) => boolean
}

function piece(parent: Fake | null, control = false): Fake {
  const made: Fake = {
    parent,
    control,
    closest: () => {
      for (let at: Fake | null = made; at; at = at.parent) if (at.control) return at
      return null
    },
    contains: (other) => {
      for (let at = other; at; at = at.parent) if (at === made) return true
      return false
    },
  }
  return made
}

test('a click on a row presses the row, but not one on its own controls, outside it, or at the end of a text selection', () => {
  const page = piece(null)
  const row = piece(page)
  const words = piece(piece(row))
  const button = piece(row, true)
  const icon = piece(button)
  const elsewhere = piece(page)

  assert.equal(pressesRow(row, row, ''), true, 'the row itself')
  assert.equal(pressesRow(words, row, ''), true, 'its words')
  assert.equal(pressesRow(button, row, ''), false, 'its own button')
  assert.equal(pressesRow(icon, row, ''), false, "the icon inside its button")
  assert.equal(pressesRow(elsewhere, row, ''), false, 'another part of the page')
  assert.equal(pressesRow(null, row, ''), false)
  assert.equal(pressesRow(words, row, 'Round invoices'), false, 'the user was selecting its words')
  assert.equal(pressesRow(words, row, '  '), true)

  // A row that is itself a control, inside a page region that is one too, still presses.
  const tab = piece(null, true)
  const rowInTab = piece(tab, true)
  assert.equal(pressesRow(piece(rowInTab), rowInTab, ''), true)
})
