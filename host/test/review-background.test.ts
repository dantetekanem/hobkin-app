import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NO_GITHUB_LISTS, type GitHubState } from '#shared/protocol/github.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import { toPrepare } from '../src/review/seat.ts'

test('the background prepares finished changes only: a pull request waits for Start AI review', () => {
  const work = { finished: [{ changes: [{ slug: 'shop', item: '4c9e21', head: 'a'.repeat(40) }] }] } as unknown as WorkState
  const pull = { url: 'https://github.com/acme/shop/pull/12', updatedAt: '2026-11-12T10:00:00Z' }
  const github = { ...NO_GITHUB_LISTS, sample: false, reviews: [pull] } as unknown as GitHubState

  const watched = toPrepare(work, github)

  assert.deepEqual(watched.map((entry) => entry.id), ['change:shop:4c9e21'])
})
