import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { CANVAS_CLOSED } from '#shared/protocol/canvas.ts'
import { Canvases, canvasHandlers } from '../src/canvases.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'
import { listen } from '../src/server.ts'
import * as store from 'hobkin/src/cli/canvas.mjs'
import { afterTest, temporaryDirectory } from './support.ts'

const DURABLE = 'a1b2c3d4'

function setup(t: Parameters<typeof temporaryDirectory>[0], port = 4000) {
  const root = temporaryDirectory(t)
  const downloads = join(temporaryDirectory(t), 'Downloads')
  mkdirSync(downloads)
  const changes: number[] = []
  const canvases = new Canvases({ store, root: () => root, port: () => port, onChange: () => changes.push(Date.now()), downloads, home: root })
  afterTest(t, () => canvases.stop())
  return { root, downloads, changes, canvases }
}

async function until(check: () => boolean, what: string) {
  for (let waited = 0; waited < 3000; waited += 25) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(`timed out waiting for ${what}`)
}

test('the window is told each canvas, and a change on disk reaches it', async (t) => {
  const { root, changes, canvases } = setup(t)
  assert.deepEqual(canvases.main, CANVAS_CLOSED)
  assert.deepEqual(canvases.others(), {})
  canvases.watch()

  // The shell command is another process writing the same files.
  store.showPage(root, 'main', { url: 'http://localhost:3000/app', title: 'App' })
  await until(() => changes.length === 1, 'the page to reach the window')
  assert.deepEqual(canvases.main, { open: true, url: 'http://localhost:3000/app', title: 'App', kind: 'page', revision: 1 })

  const entry = store.drawCanvas(root, DURABLE, { html: '<p>hi</p>', title: 'Sketch' })
  await until(() => changes.length === 2, 'the drawing to reach the window')
  assert.deepEqual(canvases.others(), { [DURABLE]: { open: true, url: `http://127.0.0.1:4000/canvas/${entry.key}?r=1`, title: 'Sketch', kind: 'drawing', revision: 1 } })
  assert.deepEqual(canvases.main.url, 'http://localhost:3000/app')

  // Nothing new on disk means nothing to tell.
  canvases.refresh()
  assert.equal(changes.length, 2)

  // A page that is not http or https never reaches the window, even when the file on disk names one: the store
  // refuses to write it, so this is a state file someone else changed.
  assert.throws(() => store.showPage(root, 'main', { url: 'file:///etc/passwd' }))
  const stateFile = join(root, 'canvas', 'state.json')
  const onDisk = JSON.parse(readFileSync(stateFile, 'utf8'))
  onDisk.canvases.main.url = 'file:///etc/passwd'
  writeFileSync(stateFile, JSON.stringify(onDisk))
  canvases.refresh()
  assert.deepEqual(canvases.main, CANVAS_CLOSED)

  store.closeCanvas(root, DURABLE)
  canvases.refresh()
  assert.deepEqual(canvases.others(), { [DURABLE]: CANVAS_CLOSED })
})

test('a drawing is served only at its keyed address, sandboxed and uncached', async (t) => {
  const { root, canvases } = setup(t)
  const server = await listen({ port: 0, token: 'x', origins: [], dev: false, onConnection: () => {}, serve: (request, response) => canvases.serve(request, response) })
  afterTest(t, () => server.close())
  const html = '<!doctype html><title>t</title><p>drawn</p>'
  const entry = store.drawCanvas(root, 'main', { html, title: 'Drawn' })
  const base = `http://127.0.0.1:${server.port}`

  const ok = await fetch(`${base}/canvas/${entry.key}?r=1`)
  assert.equal(ok.status, 200)
  assert.equal(await ok.text(), html)
  assert.equal(ok.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.equal(ok.headers.get('cache-control'), 'no-store')
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(ok.headers.get('referrer-policy'), 'no-referrer')
  const policy = ok.headers.get('content-security-policy') ?? ''
  assert.match(policy, /^sandbox /)
  assert.doesNotMatch(policy, /allow-same-origin/)

  for (const path of [`/canvas/${'0'.repeat(32)}`, `/canvas/${entry.key}/x`, '/canvas/../state.json', '/canvas/main', `/${entry.key}`, '/canvas/']) {
    assert.equal((await fetch(base + path)).status, 404, path)
  }
  assert.equal((await fetch(`${base}/canvas/${entry.key}`, { method: 'POST', body: 'x' })).status, 404)

  // A closed canvas no longer serves its drawing.
  store.closeCanvas(root, 'main')
  assert.equal((await fetch(`${base}/canvas/${entry.key}`)).status, 404)
})

test('hobkin draws, reads, saves and closes through the client tool', async (t) => {
  const { root, downloads, changes, canvases } = setup(t)
  const tool = createClientTool({ run: (name, args) => runCommand(canvasHandlers(canvases), name, args) })
  const run = async (name: string, args: Record<string, unknown> = {}) => JSON.parse((await tool.execute('1', { action: 'run', name, args })).content[0]!.text)

  const listed = JSON.parse((await tool.execute('1', { action: 'list' })).content[0]!.text) as { name: string }[]
  for (const name of ['canvas.show', 'canvas.draw', 'canvas.read', 'canvas.save', 'canvas.close']) assert.ok(listed.some((command) => command.name === name), name)

  const drawn = await run('canvas.draw', { html: '<p>one</p>', title: 'My Plan' })
  assert.equal(drawn.open, true)
  assert.equal(drawn.kind, 'drawing')
  assert.equal(drawn.revision, 1)
  assert.equal(changes.length, 1)
  assert.equal((await run('canvas.draw', { html: '<p>two</p>', title: 'My Plan' })).revision, 2)

  const read = await run('canvas.read')
  assert.equal(read.state.kind, 'drawing')
  assert.equal(readFileSync(read.file, 'utf8'), '<p>two</p>')

  const saved = await run('canvas.save')
  assert.equal(saved.path, join(downloads, 'my-plan.html'))
  assert.equal(readFileSync(saved.path, 'utf8'), '<p>two</p>')
  // Saving never replaces a file: the next one in Downloads takes another name, and a path that is taken is refused.
  assert.equal((await run('canvas.save')).path, join(downloads, 'my-plan-2.html'))
  await assert.rejects(tool.execute('1', { action: 'run', name: 'canvas.save', args: { path: saved.path } }), /already exists/)

  // Another hobkin's canvas is its own.
  await run('canvas.show', { url: 'http://localhost:3000/', hobkin: DURABLE })
  assert.equal(canvases.main.kind, 'drawing')
  assert.equal(canvases.others()[DURABLE]?.kind, 'page')

  const closed = await run('canvas.close')
  assert.deepEqual(closed, { open: false, url: null, title: null })
  assert.equal(existsSync(store.drawingFile(root, 'main')), true)
  await assert.rejects(tool.execute('1', { action: 'run', name: 'canvas.draw', args: { html: '<p/>', hobkin: 'zz' } }), Error)
})
