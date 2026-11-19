import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPeopleCache } from '../src/features/review/people.ts'

test("a review's people are asked of the host once, shared by the list and the panel, and asked again after a question the host could not answer", async () => {
  const asked: string[] = []
  let fail = true
  const cache = createPeopleCache(async (id) => {
    asked.push(id)
    if (fail) throw new Error('the host is starting')
    return { author: { name: 'dev', url: 'https://github.com/dev' } }
  })
  await assert.rejects(cache.of('pr:acme/shop/1'), /starting/)
  fail = false
  const [list, panel] = await Promise.all([cache.of('pr:acme/shop/1'), cache.of('pr:acme/shop/1')])
  assert.deepEqual([list, panel], [{ author: { name: 'dev', url: 'https://github.com/dev' } }, { author: { name: 'dev', url: 'https://github.com/dev' } }])
  await cache.of('pr:acme/shop/1')
  assert.deepEqual(asked, ['pr:acme/shop/1', 'pr:acme/shop/1'], 'once after the failure, then kept')
})
