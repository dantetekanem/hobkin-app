import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canSave, canvasOwner, clampWidth, frameKey, labelFor, PANEL_WIDTH, sandboxFor } from '../src/features/canvas-panel/rules.ts'
import { useCanvasPanel } from '../src/features/canvas-panel/store.ts'

/** The panel's state as it is now. One store serves every test below, in order. */
const panel = () => useCanvasPanel.getState()

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
  panel().apply({ open: true, url: 'http://localhost:3000/', title: 'App' })
  assert.deepEqual([panel().open, panel().url, panel().title], [true, 'http://localhost:3000/', 'App'])

  panel().apply({ open: false, url: null, title: null })
  assert.equal(panel().open, false)
  assert.equal(panel().url, 'http://localhost:3000/')

  panel().reload()
  assert.equal(panel().reloads, 1)
})

test('a drawing runs scripts without an origin and reloads on a new revision', () => {
  const sandbox = sandboxFor('http://127.0.0.1:5000/drawing', 'drawing')
  assert.match(sandbox, /allow-scripts/)
  assert.doesNotMatch(sandbox, /allow-same-origin/)
  assert.match(sandboxFor('http://127.0.0.1:5000/', 'page'), /allow-same-origin/)
  assert.equal(labelFor('http://127.0.0.1:5000/d', null, 'drawing'), 'Drawing')
  assert.equal(labelFor('http://127.0.0.1:5000/d', 'Plan', 'drawing'), 'Plan')
  assert.notEqual(frameKey('http://127.0.0.1:5000/d', 1, 0), frameKey('http://127.0.0.1:5000/d', 2, 0))
  assert.notEqual(frameKey('http://127.0.0.1:5000/d', 1, 0), frameKey('http://127.0.0.1:5000/d', 1, 1))
  panel().apply({ open: true, url: 'http://127.0.0.1:5000/d', title: null, kind: 'drawing', revision: 3 })
  assert.equal(panel().revision, 3)
})

test("each hobkin's panel follows its own canvas", () => {
  assert.equal(canvasOwner({ screen: 'agent', openAgent: 'hobkin:0123abcd' }), '0123abcd')
  const elsewhere = [
    { screen: 'agent', openAgent: 'job-1' },
    { screen: 'agent', openAgent: null },
    { screen: 'work', openAgent: 'hobkin:0123abcd' },
    { screen: 'home', openAgent: null },
  ]
  for (const view of elsewhere) {
    assert.equal(canvasOwner(view), 'main', JSON.stringify(view))
  }

  const main = { open: true, url: 'http://localhost:3000/', title: 'App' }
  const mine = { open: true, url: 'http://127.0.0.1:9/d', title: null, kind: 'drawing' as const, revision: 1 }
  panel().sync('main', main)
  panel().resize(0.7)
  panel().sync('0123abcd', mine)
  assert.equal(panel().url, mine.url)
  assert.equal(panel().width, PANEL_WIDTH.initial)
  panel().sync('0123abcd', { open: false, url: null, title: null })
  assert.equal(panel().open, false)
  panel().sync('main', main)
  assert.equal(panel().url, main.url)
  assert.equal(panel().width, 0.7)
  // Switching to a hobkin with no canvas shows nothing of the other owner's page.
  panel().sync('0123abcd', undefined)
  assert.equal(panel().open, false)
  assert.equal(panel().url, null)
})

test('Save shows for a drawing only and says where the file went', async () => {
  assert.equal(canSave('drawing'), true)
  assert.equal(canSave('page'), false)
  assert.equal(canSave(undefined), false)

  const drawing = { open: true, url: 'http://127.0.0.1:9/d', title: 'Plan', kind: 'drawing' as const, revision: 1 }
  panel().sync('main', drawing)
  const owners: string[] = []
  await panel().save(async (owner) => {
    owners.push(owner)
    return { path: '/Users/me/Downloads/plan.html' }
  })
  assert.deepEqual(owners, ['main'])
  assert.deepEqual(panel().saved, { path: '/Users/me/Downloads/plan.html' })

  // The same canvas said again keeps the note; a new revision clears it.
  panel().apply(drawing)
  assert.ok(panel().saved)
  panel().apply({ ...drawing, revision: 2 })
  assert.equal(panel().saved, null)

  await panel().save(async () => Promise.reject(Error('A file is already there.')))
  assert.deepEqual(panel().saved, { error: 'A file is already there.' })
  panel().close()
  assert.equal(panel().saved, null)
})
