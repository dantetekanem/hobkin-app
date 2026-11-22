import assert from 'node:assert/strict'
import { test } from 'node:test'
import { menuLayout } from '../src/app/menu-rows.ts'

const ONE_ROW = ['home', 'reports', 'routines', 'actions', 'work', 'github', 'world', 'yolo', 'project', 'proof', 'review', 'mind', 'settings', 'integrations', 'skills', 'extensions'] as const

test('on a page with one menu row the main canvas pill sits at the end of the trail, and the menu grows no row for it', () => {
  for (const screen of ONE_ROW) {
    assert.deepEqual(menuLayout({ screen, canvasOpen: true, pill: true }), { second: null, pillOn: 'trail' }, `${screen}, canvas open`)
    assert.deepEqual(menuLayout({ screen, canvasOpen: false, pill: false }), { second: null, pillOn: null }, `${screen}, canvas closed`)
  }
})

test("an agent's page and the canvas place keep their second row, an agent's with the pill at its end", () => {
  assert.deepEqual(menuLayout({ screen: 'agent', canvasOpen: true, pill: true }), { second: 'agents', pillOn: 'second' })
  assert.deepEqual(menuLayout({ screen: 'agent', canvasOpen: false, pill: false }), { second: 'agents', pillOn: null })
  assert.deepEqual(menuLayout({ screen: 'canvas', canvasOpen: true, pill: false }), { second: 'canvas', pillOn: null })
  assert.deepEqual(menuLayout({ screen: 'canvas', canvasOpen: false, pill: false }), { second: null, pillOn: null })
})
