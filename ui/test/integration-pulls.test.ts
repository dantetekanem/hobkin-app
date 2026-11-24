import assert from 'node:assert/strict'
import test from 'node:test'
import type { PullRequest } from '../../shared/protocol/pulls.ts'
import type { WindowPart } from '../src/integration/contract.ts'
import { pullRequestsOf } from '../src/integration/pulls.ts'

const pull = (number: number): PullRequest => ({
  repo: 'org/app', number, title: `PR ${number}`, labels: [], updatedAt: '', url: `https://example.invalid/${number}`,
  draft: false, author: null, review: 'none', checks: 'none',
})
const part = (id: string, pulls?: WindowPart<number[]>['pulls']): WindowPart =>
  ({ manifest: { id, name: id, line: '', commands: {}, screens: [] }, unknown: [], sample: () => [], pulls }) as WindowPart

test('the pull requests are those of each part that has some, in the parts order, and a part with none gives none', () => {
  const some = part('a', (numbers) => numbers.map(pull))
  const parts = [some, part('b'), part('c', (numbers) => numbers.map(pull))]
  assert.deepEqual(pullRequestsOf(parts, [[1, 2], 'unread', [3]]).map(({ number }) => number), [1, 2, 3])
  assert.deepEqual(pullRequestsOf([], []), [])
})
