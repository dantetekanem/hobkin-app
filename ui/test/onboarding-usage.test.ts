import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asksUsage, keepUsage, USAGE_CHOICES, usageAnswer } from '../src/features/onboarding/usage-ask.ts'

test('the usage question is two bubbles, and only yes sends anything', () => {
  assert.deepEqual(
    USAGE_CHOICES.map(({ value }) => value).toSorted(),
    ['no', 'yes'],
  )

  assert.equal(usageAnswer('yes'), true)
  assert.equal(usageAnswer('no'), false)
  assert.equal(usageAnswer(''), false, 'nothing picked is no')
})

test('only a story with a host asks it, since only a host can keep the answer', () => {
  assert.equal(asksUsage({ host: true }), true)
  assert.equal(asksUsage({ host: false }), false)
  assert.equal(asksUsage({}), false, 'a browser tab on sample data')
})

test('the answer is kept through the host, and a refusal is said while the story goes on', async () => {
  const asked: { upload: boolean }[] = []
  const host = async (_name: 'setup.telemetry', args: { upload: boolean }) => {
    asked.push(args)
    return { upload: args.upload }
  }

  assert.equal(await keepUsage(true, host), null)
  assert.equal(await keepUsage(false, host), null)
  assert.deepEqual(asked, [{ upload: true }, { upload: false }])

  const refusing = async () => {
    throw Error('The host is gone.')
  }
  const said = await keepUsage(true, refusing)
  assert.match(said ?? '', /could not keep your answer about usage counts/)
  assert.match(said ?? '', /The host is gone\./)
})
