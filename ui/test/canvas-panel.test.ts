import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampWidth, labelFor, PANEL_WIDTH, sandboxFor } from '../src/features/canvas-panel/rules.ts'
import { useCanvasPanel } from '../src/features/canvas-panel/store.ts'

test('a page on this Mac runs with its own origin, any other page without it', () => {
  assert.match(sandboxFor('http://localhost:3000/'), /allow-scripts allow-same-origin/)
  assert.match(sandboxFor('http://127.0.0.1:3000/'), /allow-same-origin/)
  for (const other of ['https://example.com', 'http://example.com', 'https://localhost:3000', 'http://localhost.evil.com']) {
    assert.doesNotMatch(sandboxFor(other), /allow-same-origin/, other)
  }
  assert.doesNotMatch(sandboxFor('https://example.com'), /top-navigation/)
})

test('the bar names the page by its title, or by its host', () => {
  assert.equal(labelFor('http://localhost:3000/x', ' My app '), 'My app')
  assert.equal(labelFor('http://localhost:3000/x', null), 'localhost:3000')
})

test('the panel keeps between a third and four fifths of the area', () => {
  assert.equal(clampWidth(0.05), PANEL_WIDTH.min)
  assert.equal(clampWidth(0.95), PANEL_WIDTH.max)
  assert.equal(clampWidth(0.5), 0.5)
})

test('the host opens and closes the panel, and the page stays while it slides away', () => {
  const panel = useCanvasPanel
  panel.getState().apply({ open: true, url: 'http://localhost:3000/', title: 'App' })
  assert.deepEqual([panel.getState().open, panel.getState().url, panel.getState().title], [true, 'http://localhost:3000/', 'App'])
  panel.getState().apply({ open: false, url: null, title: null })
  assert.equal(panel.getState().open, false)
  assert.equal(panel.getState().url, 'http://localhost:3000/')
  panel.getState().reload()
  assert.equal(panel.getState().reloads, 1)
})
