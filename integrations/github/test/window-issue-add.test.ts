import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addedWords, SAMPLE_ADDED } from '../window/issue-add.ts'

test('with no host, Add to queue answers in sample words and nothing reaches hobkin', async () => {
  let sent = 0
  const words = await addedWords({ repo: 'hobkin-sample/storefront', number: 455 }, { live: false, add: async () => { sent += 1; return { message: 'x' } } })
  assert.equal(words, SAMPLE_ADDED)
  assert.match(words, /^This is sample data, so nothing reached hobkin\./)
  assert.equal(sent, 0)
})

test("with a host, Add to queue sends github.issue.add by repository and number and says what hobkin said", async () => {
  const seen: unknown[] = []
  const words = await addedWords({ repo: 'acme/web', number: 12 }, { live: true, add: async (args) => { seen.push(args); return { message: 'Added.' } } })
  assert.equal(words, 'Added.')
  assert.deepEqual(seen, [{ repo: 'acme/web', number: 12 }])
})

test("a refusal from hobkin rejects with its reason", async () => {
  await assert.rejects(addedWords({ repo: 'acme/web', number: 12 }, { live: true, add: async () => { throw new Error('No project is that repository.') } }), /No project/)
})
