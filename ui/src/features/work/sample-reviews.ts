import type { AssessmentRequest, AssessmentStatus, AssessmentSummary } from '#shared/review/assessment.ts'
import type { ReviewNeeds } from '#shared/review/needs.ts'
import type { ReviewList, ReviewListItem } from '#shared/review/status.ts'

/**
 * AI reviews for a window with no host, in the shape the host's `review.list` sends. They are the Work sample's
 * finished changes and the GitHub sample's pull requests, so the AI Reviews tab, a Work card's badge and a GitHub row
 * agree, and between them show every state: running, waiting its turn, ready at each level, failed, and none at all.
 * Times count back from when the window opened. Nothing here came from a review.
 */

const MINUTE_MS = 60_000
const sha = (seed: string) => seed.padEnd(40, '0')

function sampleReviews(now: number): ReviewList {
  const ago = (minutes: number) => new Date(now - minutes * MINUTE_MS).toISOString()
  const summary = (level: AssessmentSummary['level'], counts: Pick<AssessmentSummary, 'needsYou' | 'worthALook' | 'safe'>, minutes: number, critical = false): AssessmentSummary => ({
    level,
    critical,
    ...counts,
    storyBy: 'model',
    at: ago(minutes),
  })
  const change = (slug: string, item: string, title: string, head: string, assessment: AssessmentStatus, minutes: number): ReviewListItem => ({
    id: `change:${slug}:${item}`,
    kind: 'change',
    title,
    project: slug,
    head: sha(head),
    state: 'ready',
    phase: null,
    error: null,
    assessment: { ...assessment, head: sha(head) },
    updatedAt: ago(minutes),
  })
  const pull = (repo: string, number: number, title: string, size: Pick<AssessmentRequest, 'files' | 'added' | 'removed'>, assessment: Omit<AssessmentStatus, 'head'>, minutes: number): ReviewListItem => {
    const head = sha(`${number}`)
    return {
      id: `pr:hobkin-sample/${repo}/${number}`,
      kind: 'pull',
      title,
      project: `hobkin-sample/${repo}`,
      head,
      state: assessment.state === 'failed' ? 'failed' : 'ready',
      phase: null,
      error: assessment.state === 'failed' ? (assessment.error ?? null) : null,
      assessment: { ...assessment, head, request: { kind: 'pull', project: `hobkin-sample/${repo}`, number, title, base: sha('ba5e'), head, ...size } },
      updatedAt: ago(minutes),
    }
  }

  /** The review's own answers to the user's five questions (spec 058), at its commit; none for visibility without monitoring. */
  const rated = (row: ReviewListItem, numbers: [number, number, number, number | null, number], rate: number | null): ReviewListItem => {
    const [coverage, proof, safety, visibility, rollback] = numbers
    const scores: NonNullable<ReviewNeeds['scores']> = {
      coverage: { score: coverage, evidence: 'Tests reach every changed definition.' },
      proof: { score: proof, evidence: 'Tests were added with the change.' },
      safety: { score: safety, evidence: 'Nothing is written that a revert leaves behind.' },
      ...(visibility == null ? {} : { visibility: { score: visibility, evidence: 'Errors reach the error tracker.' } }),
      rollback: { score: rollback, evidence: 'One revert takes it back.' },
    }
    return { ...row, needs: [{ kind: 'bug-fix', scores, ...(rate == null ? {} : { rate }), head: row.head ?? sha('0'), by: 'change-review', at: row.updatedAt }] }
  }

  return {
    reviews: [
      pull('storefront', 482, 'Keep the cart total between page loads', { files: 6, added: 120, removed: 14 }, { state: 'running', percent: 35, now: 'Reading the six files the change touches', startedAt: ago(2) }, 0),
      change('storefront', '4c9e21', 'Remember the shipping address', '9b04d2aa', { state: 'running', head: null, percent: 62, now: 'Running the checkout tests in the review tree', startedAt: ago(4) }, 0),
      change('docs-site', 'a7f3b9', 'Document the export command', '77c1e9f0', { state: 'queued', head: null }, 1),
      change('storefront', '8d2f60', 'Fix the login redirect after a password reset', '2e6b0c41', { state: 'ready', head: null, summary: summary('mid', { needsYou: 0, worthALook: 2, safe: 3 }, 50) }, 50),
      // A pull request's repository has no monitoring known: four numbers and no general rate.
      rated(pull('storefront', 479, 'Fix the login redirect after a password reset', { files: 2, added: 18, removed: 4 }, { state: 'ready', summary: summary('mid', { needsYou: 0, worthALook: 1, safe: 2 }, 90) }, 90), [7, 5, 6, null, 8], null),
      rated(change('billing-api', '5e7c21', 'Patch the webhook retry', 'f3a9c1e7', { state: 'ready', head: null, summary: summary('safe', { needsYou: 0, worthALook: 0, safe: 4 }, 120) }, 120), [8, 7, 9, 6, 9], 8.2),
      change('storefront', 'd2c4e8', 'Move the cart into one module', 'c0ffee12', { state: 'ready', head: null, summary: summary('high', { needsYou: 2, worthALook: 3, safe: 5 }, 180, true) }, 180),
      pull('api', 1185, 'Move rate limits into the gateway', { files: 9, added: 310, removed: 120 }, { state: 'ready', summary: summary('high', { needsYou: 1, worthALook: 2, safe: 4 }, 240) }, 240),
      change('billing-api', '0f6a3b', 'Round invoices once', '51d8a3be', { state: 'failed', head: null, error: 'The tests would not start in the review tree: its packages are not installed.' }, 300),
      pull('docs', 71, 'Document the export command', { files: 3, added: 140, removed: 0 }, { state: 'failed', error: 'gh could not read the pull request, so the review stopped.' }, 400),
      pull('docs', 77, 'Explain the new sign-in steps', { files: 2, added: 48, removed: 6 }, { state: 'ready', summary: summary('safe', { needsYou: 0, worthALook: 0, safe: 3 }, 1200) }, 1200),
      // Two that left GitHub's lists, merged since: only "Recently reviewed by AI" shows them.
      pull('api', 1160, 'Cache the session lookups', { files: 3, added: 64, removed: 12 }, { state: 'ready', summary: summary('safe', { needsYou: 0, worthALook: 0, safe: 5 }, 2900) }, 2900),
      pull('storefront', 466, 'Split the product page bundle', { files: 7, added: 210, removed: 160 }, { state: 'ready', summary: summary('mid', { needsYou: 0, worthALook: 2, safe: 4 }, 4400) }, 4400),
    ],
  }
}

/** The sample, as of when the window opened. */
export const SAMPLE_REVIEW_LIST: ReviewList = sampleReviews(Date.now())

/** A sample finished change's change review, for its Work card. A change with none here says it is not reviewed yet. */
export function sampleAssessmentOf({ slug, item }: { slug: string; item: string }): AssessmentStatus | undefined {
  return SAMPLE_REVIEW_LIST.reviews.find(({ id }) => id === `change:${slug}:${item}`)?.assessment
}
