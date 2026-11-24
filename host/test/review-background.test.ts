import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkState } from '#shared/protocol/work.ts'
import { toPrepare } from '../src/review/seat.ts'

test('the background prepares finished changes only: a pull request waits for Start AI review', () => {
  const work = { finished: [{ changes: [{ slug: 'shop', item: '4c9e21', head: 'a'.repeat(40) }] }] } as unknown as WorkState
  const pull = { url: 'https://github.com/acme/shop/pull/12', updatedAt: '2026-11-12T10:00:00Z' }

  const watched = toPrepare(work, { mine: [], waiting: [pull as never], sample: false })

  assert.deepEqual(watched.map((entry) => entry.id), ['change:shop:4c9e21'])
})
