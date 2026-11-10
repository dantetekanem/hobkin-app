import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { crc32, deflateSync } from 'node:zlib'
import type { OwnerState } from '#shared/protocol/messages.ts'
import type { ScriptedCall } from '../src/scripted.ts'
import { afterTest, Client, hostFor } from './support.ts'

/** A small real PNG: 8-bit RGBA, one flat color. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type), body])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length)
    const check = Buffer.alloc(4)
    check.writeUInt32BE(crc32(typed))
    return Buffer.concat([length, typed, check])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, 180)])
  const rows = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const sizeOf = (image: Buffer) => [image.readUInt32BE(16), image.readUInt32BE(20)]

interface Attached {
  id: string
  name: string
  mimeType: string
}

async function imageHost(t: TestContext) {
  const calls: ScriptedCall[] = []
  const host = await hostFor(t, {
    scripted: {
      reply: (call) => {
        calls.push(call)
        return { text: `I see ${call.images.length}.` }
      },
    },
  })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  const view = await client.live()
  const attach = (name: string, bytes: Buffer) => client.command('conversation.attach', { name, data: bytes.toString('base64') })
  const replied = (count: number) => client.until((now) => now.snapshot.busy === false && now.messages.filter(({ role }) => role === 'assistant').length === count, `reply ${count}`)
  // hobkin's limits come with the live state, once hobkin is open to say them.
  const live = view.owner as Extract<OwnerState, { state: 'live' }>
  return { client, calls, attach, replied, limits: live.limits }
}

test('passes image bytes to the model and refuses oversize files', async (t) => {
  const { client, calls, attach, replied, limits } = await imageHost(t)
  assert.deepEqual(limits, { images: 4, imageBytes: 64 * 1024 * 1024 }, "hobkin's own limits, told to the UI so it can refuse a file before sending it")

  const picture = png(40, 30)
  const attached = await attach('chart.png', picture)
  assert.equal(attached.ok, true)
  const image = (attached.ok ? attached.value : null) as Attached
  assert.deepEqual({ name: image.name, mimeType: image.mimeType }, { name: 'chart.png', mimeType: 'image/png' })

  await client.run('conversation.send', { text: 'What is in this chart?', images: [image.id] })
  const view = await replied(1)

  // The model got the picture itself, as an image, with the user's words.
  assert.equal(calls.length, 1)
  assert.ok(calls[0]!.prompt.endsWith('What is in this chart?'))
  assert.equal(calls[0]!.images.length, 1)
  assert.equal(calls[0]!.images[0]!.mimeType, 'image/png')
  assert.deepEqual(sizeOf(Buffer.from(calls[0]!.images[0]!.data, 'base64')), [40, 30])
  assert.deepEqual(view.messages.map(({ role, content, images }) => [role, content, images ?? 0]), [
    ['user', 'What is in this chart?', 1],
    ['assistant', 'I see 1.', 0],
  ])

  // Once sent it is gone from the draft: the same picture cannot ride along a second time.
  const again = await client.command('conversation.send', { text: 'And again?', images: [image.id] })
  assert.equal(again.ok, false)
  assert.equal(calls.length, 1)

  // What is not a picture hobkin can send is refused, in hobkin's own words.
  const notes = await attach('notes.txt', Buffer.from('These are words, not a picture.'))
  assert.match(!notes.ok ? notes.error.message : '', /PNG, JPEG, GIF and WebP/)

  // A file over hobkin's limit is refused, and the message names the limit.
  const huge = await attach('huge.png', Buffer.concat([picture, Buffer.alloc(limits.imageBytes)]))
  assert.equal(huge.ok, false)
  assert.match(!huge.ok ? huge.error.message : '', /64 MB/)

  // Nothing of the refused files is left over for the next message.
  await client.run('conversation.send', { text: 'Just words now' })
  await replied(2)
  assert.equal(calls[1]!.images.length, 0)
})

test('an attachment picked with the button reaches the model', async (t) => {
  const { client, calls, attach, replied } = await imageHost(t)

  // Several pictures, however they were chosen, are one command each.
  const added: Attached[] = []
  for (const [name, width] of [['one.png', 10], ['two.png', 20], ['three.png', 30], ['four.png', 40]] as const) {
    const result = await attach(name, png(width, 8))
    assert.equal(result.ok, true)
    added.push((result.ok ? result.value : null) as Attached)
  }
  assert.equal(new Set(added.map(({ id }) => id)).size, 4)

  // hobkin holds four to a message. The fifth is refused with that number.
  const fifth = await attach('five.png', png(50, 8))
  assert.match(!fifth.ok ? fifth.error.message : '', /4 images/)

  // One is removed before sending, which makes room again.
  assert.deepEqual(await client.run('conversation.detach', { id: added[1]!.id }), { ok: true })
  const gone = await client.command('conversation.detach', { id: added[1]!.id })
  assert.equal(gone.ok, false)
  const replacement = await attach('five.png', png(50, 8))
  assert.equal(replacement.ok, true)

  // A message can be pictures alone. hobkin gives it words, because a turn needs some.
  const ids = [added[0]!.id, added[2]!.id, added[3]!.id, (replacement.ok ? (replacement.value as Attached) : added[0]!).id]
  await client.run('conversation.send', { images: ids })
  const view = await replied(1)
  assert.deepEqual(calls[0]!.images.map(({ data }) => sizeOf(Buffer.from(data, 'base64'))[0]), [10, 30, 40, 50], 'in the order they were attached, without the one removed')
  assert.equal(view.messages[0]?.images, 4)
  assert.equal(view.messages[0]?.content, 'Look at what I pasted.')

  // With neither words nor a picture there is nothing to send.
  const empty = await client.command('conversation.send', {})
  assert.equal(empty.ok, false)
  assert.equal(calls.length, 1)
})
