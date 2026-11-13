import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { StateMessage } from '#shared/protocol/messages.ts'
import { canvasUrl, isLocalPage } from '#shared/protocol/canvas.ts'
import * as store from 'hobkin/src/cli/canvas.mjs'
import { Canvases, canvasHandlers } from '../src/canvases.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

test('only http and https pages with a host and no sign-in open', () => {
  assert.equal(canvasUrl('http://localhost:3000/a?b=1').href, 'http://localhost:3000/a?b=1')
  assert.equal(canvasUrl('https://example.com').href, 'https://example.com/')
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'mailto:a@b.c', 'ftp://example.com', 'nonsense', 'https://user:pw@example.com', 'http://']) {
    assert.throws(() => canvasUrl(bad), Error, bad)
  }
  assert.equal(isLocalPage('http://localhost:5173/x'), true)
  assert.equal(isLocalPage('http://127.0.0.1:8080'), true)
  assert.equal(isLocalPage('https://localhost'), false)
  assert.equal(isLocalPage('http://example.com'), false)
  assert.equal(isLocalPage('http://localhost.evil.com'), false)
})

test('hobkin opens and closes the canvas through the client tool', async (t) => {
  let changes = 0
  const root = temporaryDirectory(t)
  const canvases = new Canvases({ store, root: () => root, port: () => 4000, onChange: () => (changes += 1) })
  const tool = createClientTool({ run: (name, args) => runCommand(canvasHandlers(canvases), name, args) })

  const listed = JSON.parse((await tool.execute('1', { action: 'list' })).content[0]!.text) as { name: string }[]
  const listsCommand = (command: string) => listed.some(({ name }) => name === command)
  assert.ok(listsCommand('canvas.show'))
  assert.ok(listsCommand('canvas.close'))

  await tool.execute('2', { action: 'run', name: 'canvas.show', args: { url: 'http://localhost:3000/app', title: 'My app' } })
  assert.deepEqual(canvases.main, { open: true, url: 'http://localhost:3000/app', title: 'My app', kind: 'page', revision: 1 })

  // Showing the same page again loads it again, which is how hobkin shows a page it has just changed.
  await tool.execute('3', { action: 'run', name: 'canvas.show', args: { url: 'http://localhost:3000/app', title: 'My app' } })
  assert.equal(canvases.main.revision, 2)
  assert.equal(changes, 2)

  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://u:p@example.com']) {
    await assert.rejects(tool.execute('4', { action: 'run', name: 'canvas.show', args: { url } }), Error, url)
  }
  assert.equal(canvases.main.url, 'http://localhost:3000/app')

  await tool.execute('5', { action: 'run', name: 'canvas.close' })
  assert.deepEqual(canvases.main, { open: false, url: null, title: null })
})

test('the host tells the window when the canvas opens and closes', async (t) => {
  const host = await hostFor(t)
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()
  const canvases = () => client.received.filter((message): message is StateMessage => message.type === 'state' && message.canvas !== undefined).map((message) => message.canvas)

  assert.deepEqual(canvases().at(-1), { open: false, url: null, title: null })
  await client.run('canvas.show', { url: 'http://127.0.0.1:4000/', title: 'Preview' })
  await client.until(() => canvases().at(-1)?.open === true, 'the canvas to open')
  assert.deepEqual(canvases().at(-1), { open: true, url: 'http://127.0.0.1:4000/', title: 'Preview', kind: 'page', revision: 1 })

  const refused = await client.command('canvas.show', { url: 'file:///etc/passwd' })
  assert.equal(!refused.ok && refused.error.code, 'invalid-arguments')

  await client.run('canvas.close')
  await client.until(() => canvases().at(-1)?.open === false, 'the canvas to close')
})
