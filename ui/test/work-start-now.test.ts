import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commandFor } from '../src/features/work/actions.ts'
import { applySample } from '../src/features/work/sample-actions.ts'
import { sampleWork } from '../src/features/work/sample.ts'

test("Start now on a queue row is hobkin's own now action on that row", () => {
  assert.deepEqual(commandFor({ do: 'queue', key: 'item:storefront:3fa9c1', action: 'now' }), {
    name: 'work.queue',
    args: { row: 'item:storefront:3fa9c1', action: 'now' },
  })
})

test('with no host, Start now says nothing starts here and leaves the queue as it was', () => {
  const work = sampleWork()
  const row = work.queue.find(({ skipped }) => !skipped)!

  const outcome = applySample(work, { do: 'queue', key: row.key, action: 'now' })

  assert.ok('refused' in outcome)
  assert.match(outcome.refused, /^This is sample data, so nothing starts here\./)
  assert.match(outcome.refused, /one extra worker/)
})
