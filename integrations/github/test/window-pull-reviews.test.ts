import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sampleGitHub, type GitHubPull } from '../protocol.ts'
import type { ReviewList, ReviewListItem } from '#shared/review/status.ts'
import { aiOf, pullReviewId, pullSections, startAiReview } from '../window/pull-reviews.ts'
import { rowsOf } from '../../../ui/src/features/work/ai-reviews.ts'
import { followReviewList } from '../../../ui/src/features/work/review-list-follow.ts'
import { SAMPLE_REVIEW_LIST } from '../../../ui/src/features/work/sample-reviews.ts'

const HEAD = 'f3a9c1e7'.padEnd(40, '0')
const NOW = Date.parse('2026-11-12T12:00:00Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const pull = (repo: string, number: number): GitHubPull => ({
  repo,
  number,
  title: `${repo} #${number}`,
  labels: [],
  updatedAt: ago(5),
  url: `https://github.com/${repo}/pull/${number}`,
  draft: false,
  author: 'mira',
  review: 'waiting',
  checks: 'passing',
})

const review = (id: string, over: Partial<ReviewListItem>): ReviewListItem => ({ id, kind: 'pull', title: id, project: 'acme/web', head: HEAD, state: 'ready', phase: null, error: null, updatedAt: ago(1), ...over })

test("a pull request's review is named from its page, however the page writes its case, and an issue names none", () => {
  assert.equal(pullReviewId('https://github.com/Hobkin-Sample/Storefront/pull/482'), 'pr:hobkin-sample/storefront/482')
  assert.equal(pullReviewId('https://github.com/hobkin-sample/storefront/issues/468'), null)
})

test('a row says its AI review: none yet, running with its percent and what it does now, ready with its level, or failed with why', () => {
  const [running, ready, failed] = rowsOf({
    reviews: [
      review('pr:acme/web/1', { assessment: { state: 'running', head: HEAD, percent: 40, now: 'Reading the six files', startedAt: ago(2) } }),
      review('pr:acme/web/2', { assessment: { state: 'ready', head: HEAD, summary: { level: 'high', critical: false, needsYou: 1, worthALook: 0, safe: 2, storyBy: 'model', at: ago(3) } } }),
      review('pr:acme/web/3', { state: 'failed', error: 'gh is not signed in', updatedAt: ago(4) }),
    ],
  })
  assert.deepEqual(aiOf(undefined), { state: 'none' })
  assert.deepEqual(aiOf(running), { state: 'running', percent: 40, line: 'Reading the six files', startedAt: Date.parse(ago(2)) })
  assert.deepEqual(aiOf(ready), { state: 'ready', row: ready })
  assert.deepEqual(aiOf(failed), { state: 'failed', line: 'gh is not signed in' })
})

test('a review that only waits its turn says so, with how many are ahead, and is never called running', () => {
  const [waiting, queued] = rowsOf({
    reviews: [
      review('pr:acme/web/4', { state: 'preparing', phase: 'queued', turn: { ahead: 2, why: 'Waits its turn: 2 ahead in acme/web.' } }),
      review('pr:acme/web/5', { assessment: { state: 'queued', head: HEAD } }),
    ],
  })
  assert.deepEqual(aiOf(waiting), { state: 'waits', ahead: 2 })
  assert.deepEqual(aiOf(queued), { state: 'waits', ahead: null })
})

test('review requested, your pull requests, and the others reviewed by AI, each pull request once', () => {
  const both = pull('acme/web', 7)
  const rows = rowsOf({
    reviews: [
      review('pr:acme/web/7', { updatedAt: ago(1) }),
      review('pr:acme/web/9', { title: 'Cache the session lookups', updatedAt: ago(2), assessment: { state: 'ready', head: HEAD, request: { kind: 'pull', project: 'acme/web', number: 9, title: 'Cache the session lookups', base: HEAD, head: HEAD, files: 3, added: 64, removed: 12 } } }),
      review('change:storefront:4c9e21', { kind: 'change', project: 'storefront', updatedAt: ago(3) }),
      review('pr:acme/web/10', { updatedAt: ago(30) }),
      review('pr:acme/web/11', { updatedAt: ago(40) }),
    ],
  })
  const sections = pullSections({ reviews: [both, pull('acme/web', 8)], pulls: [both, pull('acme/api', 3)] }, rows, { most: 2 })

  assert.deepEqual(sections.requested.map(({ id }) => id), ['pr:acme/web/7', 'pr:acme/web/8'], "in GitHub's order")
  assert.deepEqual(sections.mine.map(({ id }) => id), ['pr:acme/api/3'], 'one already asked of the user is not listed again')
  assert.deepEqual(sections.reviewed.map(({ id }) => id), ['pr:acme/web/9', 'pr:acme/web/10'], 'newest first, as many as asked, and never a finished change')
  const [cached] = sections.reviewed
  assert.deepEqual([cached!.title, cached!.repo, cached!.number, cached!.pull], ['Cache the session lookups', 'acme/web', 9, null])
  assert.deepEqual(cached!.size, { added: 64, removed: 12, files: 3 }, 'what the review read: lines added and removed, and files')
  assert.equal(sections.requested[1]!.size, null, 'a pull request that neither GitHub nor a review has counted has no size')
})

test("a pull request GitHub lists shows GitHub's own count of its lines and files, newer than what its review read", () => {
  const request = { kind: 'pull' as const, project: 'acme/web', number: 9, title: 'Cache the session lookups', base: HEAD, head: HEAD, files: 3, added: 64, removed: 12 }
  const rows = rowsOf({ reviews: [review('pr:acme/web/9', { assessment: { state: 'ready', head: HEAD, request } })] })
  const counted = { ...pull('acme/web', 9), additions: 70, deletions: 15, changedFiles: 4 }

  const sections = pullSections({ reviews: [counted], pulls: [{ ...pull('acme/api', 3), additions: 2, deletions: 0, changedFiles: 1 }] }, rows)

  assert.deepEqual(sections.requested[0]!.size, { added: 70, removed: 15, files: 4 })
  assert.deepEqual(sections.mine[0]!.size, { added: 2, removed: 0, files: 1 }, 'before any review has read it')
  assert.deepEqual(pullSections({ reviews: [pull('acme/web', 9)], pulls: [] }, rows).requested[0]!.size, { added: 64, removed: 12, files: 3 }, 'from a host that does not send the count, the review says it')
})

test('a failed review-list refresh hides previous AI reviews until a successful refresh', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const github = { reviews: [pull('acme/web', 7)], pulls: [] }
  const first = { reviews: [review('pr:acme/web/7', {}), review('pr:acme/web/9', {})] }
  const recovered = { reviews: [review('pr:acme/web/7', { state: 'failed', error: 'Review stopped' })] }
  const replies = [first, new Error('Host disconnected'), recovered]
  let list: ReviewList | null = null
  let reviewError: string | null = null
  const sections = () => pullSections(github, rowsOf(list), { reviewError })
  const follow = followReviewList({
    run: async () => {
      const reply = replies.shift()
      if (!reply) throw new Error('Unexpected review.list request')
      if (reply instanceof Error) throw reply
      return reply
    },
    onList: (next) => {
      list = next
      reviewError = null
    },
    onError: (message) => { reviewError = message },
  })
  t.after(() => follow.stop())

  await Promise.resolve()
  assert.equal(sections().requested[0]?.ai.state, 'ready')
  assert.deepEqual(sections().reviewed.map(({ number }) => number), [9])

  follow.askNow()
  await Promise.resolve()
  assert.equal(reviewError, 'Host disconnected')
  assert.equal(sections().requested[0]?.ai.state, 'unavailable', 'the GitHub PR stays but no AI badge or start action is shown')
  assert.deepEqual(sections().reviewed, [], 'PRs from the stale review list alone are hidden')

  follow.askNow()
  await Promise.resolve()
  assert.equal(reviewError, null)
  assert.equal(sections().requested[0]?.ai.state, 'failed', 'the latest review status is visible again')
})

test('the sample shows every state the page has: running, none, ready, failed, and two that left the lists', () => {
  const sections = pullSections(sampleGitHub(NOW), rowsOf(SAMPLE_REVIEW_LIST))
  assert.deepEqual(sections.requested.map(({ ai }) => ai.state), ['none', 'running', 'none', 'ready'])
  assert.deepEqual(sections.mine.map(({ ai }) => ai.state), ['none', 'ready', 'none', 'ready', 'none', 'failed'])
  assert.deepEqual(sections.reviewed.map(({ number }) => number), [1160, 466])
})

test('Start AI review asks the host to prepare the review and then opens it; a refusal opens nothing and says why; without a host it only opens', async () => {
  const calls: string[] = []
  const prepare = async (id: string) => void calls.push(`prepare ${id}`)
  const open = (id: string) => void calls.push(`open ${id}`)

  assert.equal(await startAiReview('pr:acme/web/7', { live: true, prepare, open }), null)
  assert.deepEqual(calls, ['prepare pr:acme/web/7', 'open pr:acme/web/7'])

  calls.length = 0
  const refuse = async () => {
    throw new Error('gh is not signed in, so the pull request cannot be read.')
  }
  assert.equal(await startAiReview('pr:acme/web/7', { live: true, prepare: refuse, open }), 'gh is not signed in, so the pull request cannot be read.')
  assert.deepEqual(calls, [])

  assert.equal(await startAiReview('pr:acme/web/7', { live: false, prepare, open }), null)
  assert.deepEqual(calls, ['open pr:acme/web/7'])
})

test("a pull request's card follows every review of its change: one started again on the finished change behind it, or the only one the host lists", () => {
  const graded = { state: 'ready' as const, head: HEAD, summary: { level: 'mid' as const, critical: false, needsYou: 0, worthALook: 1, safe: 2, storyBy: 'model' as const, at: ago(30) } }
  const change = (id: string, over: Partial<ReviewListItem>) => review(id, { kind: 'change', project: 'web', ...over })
  const lists = { reviews: [], pulls: [pull('acme/web', 7), pull('acme/web', 8), pull('acme/web', 9)] }
  const sections = pullSections(
    lists,
    rowsOf({
      reviews: [
        // #7 has a review of its own, ready, and the finished change at its commit is reviewed again.
        review('pr:acme/web/7', {}),
        change('change:web:a1', { phase: 'reading', startedAt: ago(1), assessment: { state: 'queued', head: HEAD } }),
        // #8 was opened by a finished change, so the host lists only the change's review, which runs.
        change('change:web:b2', { head: 'b2'.padEnd(40, '0'), pr: 'https://github.com/acme/web/pull/8', assessment: { state: 'running', head: 'b2'.padEnd(40, '0'), percent: 30, now: 'Running the tests', startedAt: ago(2) } }),
        // #9 is ready, and a change at another commit runs: it is another change.
        review('pr:acme/web/9', { head: 'c3'.padEnd(40, '0'), assessment: { ...graded, head: 'c3'.padEnd(40, '0') } }),
        change('change:web:d4', { head: 'd4'.padEnd(40, '0'), assessment: { state: 'running', head: 'd4'.padEnd(40, '0'), percent: 80 } }),
      ],
    }),
  )

  assert.deepEqual(
    sections.mine.map(({ number, ai }) => [number, ai.state === 'running' ? [ai.state, ai.percent, ai.line, ai.startedAt] : ai.state]),
    [
      [7, ['running', null, 'Reading the change', Date.parse(ago(1))]],
      [8, ['running', 30, 'Running the tests', Date.parse(ago(2))]],
      [9, 'ready'],
    ],
  )
})
