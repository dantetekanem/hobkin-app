import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addedWords, SAMPLE_ADDED, SAMPLE_AGAIN } from '../window/issue-add.ts'

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

test('Work on it again sends the same command with again: true, and with no host says in sample words what hobkin would do', async () => {
  const seen: unknown[] = []
  const add = async (args: unknown) => {
    seen.push(args)
    return { message: 'Added a follow-up.' }
  }
  const issue = { repo: 'acme/web', number: 12 }

  const live = await addedWords(issue, { live: true, again: true, add })
  const sample = await addedWords(issue, { live: false, again: true, add })

  assert.equal(live, 'Added a follow-up.')
  assert.deepEqual(seen, [{ repo: 'acme/web', number: 12, again: true }], 'only the live press reaches the host')
  assert.equal(sample, SAMPLE_AGAIN)
  assert.match(SAMPLE_AGAIN, /^This is sample data, so nothing reached hobkin\./)
})

test("a refusal from hobkin rejects with its reason", async () => {
  await assert.rejects(addedWords({ repo: 'acme/web', number: 12 }, { live: true, add: async () => { throw new Error('No project is that repository.') } }), /No project/)
})
