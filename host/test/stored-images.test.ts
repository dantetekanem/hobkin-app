import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { History } from '../src/history.ts'
import { mainImage, rasterImage } from '../src/message-images.ts'
import { checkArguments } from '#shared/commands/registry.ts'

const image = { type: 'image', mimeType: 'image/png', data: 'eA==' }
test('image commands admit only bounded identities and ordinals, never paths or bytes', () => {
  assert.equal(checkArguments('history.image', { id: 'main.jsonl', messageId: 'entry', ordinal: 0 }).ok, true)
  assert.equal(checkArguments('history.image', { id: '../main.jsonl', messageId: 'entry', ordinal: 0 }).ok, false)
  for (const args of [{ messageId: 'entry', ordinal: -1 }, { messageId: 'entry', ordinal: 100 }, { messageId: 'entry', ordinal: 0, data: 'eA==' }]) assert.equal(checkArguments('conversation.image', args).ok, false)
})
test('request-only raster boundary rejects malformed, oversized and unsupported bytes', () => {
  assert.deepEqual(rasterImage(image), { mimeType: 'image/png', data: 'eA==' })
  assert.equal(rasterImage({ ...image, data: Buffer.alloc(5242880).toString('base64') })?.data.length, 6990508)
  for (const bad of [{ ...image, mimeType: 'image/svg+xml' }, { ...image, data: 'eB==' }, { ...image, data: '' }, { ...image, data: Buffer.alloc(5242881).toString('base64') }]) assert.equal(rasterImage(bad), null)
})
test('main retrieval pins the application and current session and checks displayed identities', () => {
  const main = { sessionId: 'current' }
  const app = { runtime: { main }, messageImage: (args: unknown) => { assert.deepEqual(args, { sessionId: 'current', messageId: 'visible', ordinal: 0 }); return image } }
  assert.deepEqual(mainImage(() => app, ['visible'], 'visible', 0), { mimeType: 'image/png', data: 'eA==' })
  assert.equal(mainImage(() => app, [], 'hidden', 0), null)
  assert.equal(mainImage(() => app, ['visible'], 'visible', -1), null)
  assert.equal(mainImage(() => app, ['visible'], 'visible', 0.5), null)
  app.messageImage = () => { app.runtime.main = { sessionId: 'current' }; return image }
  assert.equal(mainImage(() => app, ['visible'], 'visible', 0), null)
})
test('History resolves only displayed entries on the selected bounded branch', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-stored-image-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'sessions'))
  const file = 'main.jsonl'
  const entry = (id: string, parentId: string | null, content: unknown, display = true) => ({ type: 'message', id, parentId, message: { role: 'user', content, display } })
  writeFileSync(join(root, 'sessions', file), [{ type: 'session', id: 's' }, entry('old', null, [image]), entry('sibling', 'old', [image]), entry('chosen', 'old', [{ type: 'text', text: 'words' }, image]), entry('hidden', 'chosen', [image], false)].map((line) => JSON.stringify(line)).join('\n'))
  const history = new History(root, () => null, { files: 10, bytes: 100000, messages: 1 })
  const opened = await history.open(file)
  assert.equal(opened.messages[0]?.id, 'chosen')
  assert.equal(JSON.stringify(opened).includes('eA=='), false)
  assert.deepEqual(await history.image(file, 'chosen', 0), { mimeType: 'image/png', data: 'eA==' })
  for (const id of ['old', 'sibling', 'hidden', 'missing']) assert.equal(await history.image(file, id, 0), null)
  assert.equal(await history.image(file, 'chosen', 1), null)
  assert.equal(await history.image('../main.jsonl', 'chosen', 0), null)
})
