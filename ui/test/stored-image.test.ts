import assert from 'node:assert/strict'
import { test } from 'node:test'
import { StoredImageCache } from '../src/features/chat/stored-image.ts'
const image = { mimeType: 'image/png', data: 'eA==' }
test('lazy images reject late generations, deduplicate and evict bounded cached bytes', async () => {
  const cache = new StoredImageCache()
  let resolve!: (value: typeof image) => void
  let current = true
  const pending = cache.load('old', () => new Promise((done) => { resolve = done }), () => current)
  current = false
  resolve(image)
  await pending
  assert.equal(cache.get('old'), undefined)
  for (const key of ['a', 'b', 'c']) await cache.load(key, async () => image, () => true)
  await cache.load('c', async () => { throw Error('already loaded') }, () => true)
  assert.equal(cache.get('a'), undefined)
  assert.match(cache.get('c')!, /^data:image\/png;base64,eA==$/)
  await cache.load('svg', async () => ({ ...image, mimeType: 'image/svg+xml' }), () => true)
  assert.equal(cache.get('svg'), undefined)
  const stale = cache.load('stale', () => new Promise((done) => { resolve = done }), () => true)
  cache.clear()
  resolve(image)
  await stale
  assert.equal(cache.get('stale'), undefined)
  assert.equal(cache.get('c'), undefined)
})
