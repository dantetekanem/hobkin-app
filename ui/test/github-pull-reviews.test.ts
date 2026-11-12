import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sampleGitHub, type GitHubPull } from '#shared/protocol/github.ts'
import type { ReviewListItem } from '#shared/review/status.ts'
import { aiOf, pullReviewId, pullSections, startAiReview } from '../src/features/github/pull-reviews.ts'
import { rowsOf } from '../src/features/work/ai-reviews.ts'
import { SAMPLE_REVIEW_LIST } from '../src/features/work/sample-reviews.ts'

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
  const sections = pullSections({ reviews: [both, pull('acme/web', 8)], pulls: [both, pull('acme/api', 3)] }, rows, 2)

  assert.deepEqual(sections.requested.map(({ id }) => id), ['pr:acme/web/7', 'pr:acme/web/8'], "in GitHub's order")
  assert.deepEqual(sections.mine.map(({ id }) => id), ['pr:acme/api/3'], 'one already asked of the user is not listed again')
  assert.deepEqual(sections.reviewed.map(({ id }) => id), ['pr:acme/web/9', 'pr:acme/web/10'], 'newest first, as many as asked, and never a finished change')
  const [cached] = sections.reviewed
  assert.deepEqual([cached!.title, cached!.repo, cached!.number, cached!.pull], ['Cache the session lookups', 'acme/web', 9, null])
  assert.deepEqual(cached!.size, { added: 64, removed: 12, files: 3 }, 'what the review read: lines added and removed, and files')
  assert.equal(sections.requested[1]!.size, null, 'a pull request no review has read has no size yet')
})

test('the sample shows every state the page has: running, none, ready, failed, and two that left the lists', () => {
  const sections = pullSections(sampleGitHub(NOW), rowsOf(SAMPLE_REVIEW_LIST))
  assert.deepEqual(sections.requested.map(({ ai }) => ai.state), ['running', 'none', 'ready'])
  assert.deepEqual(sections.mine.map(({ ai }) => ai.state), ['ready', 'ready', 'none', 'failed'])
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
