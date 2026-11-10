import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { StateMessage } from '#shared/protocol/messages.ts'
import { canvasUrl, isLocalPage } from '#shared/protocol/canvas.ts'
import { Canvas } from '../src/canvas.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'
import { afterTest, Client, hostFor } from './support.ts'

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

test('hobkin opens and closes the canvas through the client tool', async () => {
  let changes = 0
  const canvas = new Canvas({ onChange: () => (changes += 1) })
  const handlers = { 'canvas.show': ({ url, title }: { url: string; title?: string }) => canvas.show(url, title), 'canvas.close': () => canvas.close() }
  const tool = createClientTool({ run: (name, args) => runCommand(handlers as never, name, args) })

  const listed = JSON.parse((await tool.execute('1', { action: 'list' })).content[0]!.text) as { name: string }[]
  assert.ok(listed.some(({ name }) => name === 'canvas.show') && listed.some(({ name }) => name === 'canvas.close'))

  await tool.execute('2', { action: 'run', name: 'canvas.show', args: { url: 'http://localhost:3000/app', title: 'My app' } })
  assert.deepEqual(canvas.state, { open: true, url: 'http://localhost:3000/app', title: 'My app' })

  // Showing the same page again changes nothing, so the window is not told twice.
  await tool.execute('3', { action: 'run', name: 'canvas.show', args: { url: 'http://localhost:3000/app', title: 'My app' } })
  assert.equal(changes, 1)

  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://u:p@example.com']) {
    await assert.rejects(tool.execute('4', { action: 'run', name: 'canvas.show', args: { url } }), Error, url)
  }
  assert.equal(canvas.state.url, 'http://localhost:3000/app')

  await tool.execute('5', { action: 'run', name: 'canvas.close' })
  assert.deepEqual(canvas.state, { open: false, url: null, title: null })
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
  assert.deepEqual(canvases().at(-1), { open: true, url: 'http://127.0.0.1:4000/', title: 'Preview' })

  const refused = await client.command('canvas.show', { url: 'file:///etc/passwd' })
  assert.equal(!refused.ok && refused.error.code, 'invalid-arguments')

  await client.run('canvas.close')
  await client.until(() => canvases().at(-1)?.open === false, 'the canvas to close')
})
