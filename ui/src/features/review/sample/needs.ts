/**
 * The user's five questions answered for the samples (spec 058), so "Your questions" shows with no host: the sample
 * finished change is rated with its monitoring known and has hobkin's own scored run beside it, within a point of the
 * review's; the sample pull request is rated with no monitoring known, so it has four numbers and no general rate. The
 * large and the stress samples have none, and read as not rated. Made up, in the shape a host sends.
 */
import type { ChangeScores } from '#shared/protocol/work.ts'
import type { ReviewNeeds } from '#shared/review/needs.ts'

const RATED_AT = '2026-11-23T20:10:00.000Z'

/** The sample finished change, which says what hobkin's main agent is doing above the input. */
export function sampleChangeNeeds(head: string): ReviewNeeds {
  return {
    kind: 'feature',
    scores: {
      coverage: { score: 8, evidence: 'Four tests of doingAfter and toolDoing reach every changed definition, and three fail with the change undone.' },
      proof: { score: 6, evidence: 'Three tests were added for the working line. Capped at 6: no test renders the row above the input.' },
      safety: { score: 9, evidence: 'Only words on the screen change. Nothing is written and nothing runs at load.' },
      visibility: { score: 6, evidence: 'A render error reaches the window log, and nothing counts a row that stays empty.' },
      rollback: { score: 9, evidence: 'One revert takes it back, with no data to undo.' },
    },
    missing: 'A test that renders the row above the input while a turn runs.',
    rate: 7.8,
    floors: [],
    head,
    by: 'change-review',
    at: RATED_AT,
  }
}

/** hobkin's own scored run of the same change, as the card sends its scores: within a point of the review's. */
export const SAMPLE_HOBKIN_SCORES: ChangeScores = {
  kind: 'Feature',
  rate: 8.1,
  scores: [
    { name: 'coverage', score: 8, evidence: 'The working-line tests pass and reach the new code.' },
    { name: 'proof', score: 7, evidence: 'Three tests added with the change.' },
    { name: 'deploy and data', score: 9, evidence: 'Display only.' },
    { name: 'visibility', score: 6, evidence: 'Errors reach the window log.' },
    { name: 'rollback', score: 9, evidence: 'A revert.' },
  ],
  floors: [],
  stale: false,
}

/** A sample pull request, which links user tags with dots and dashes: no monitoring is known for its repository. */
export function samplePullNeeds(head: string): ReviewNeeds {
  return {
    kind: 'bug-fix',
    scores: {
      coverage: { score: 7, evidence: 'Five helper tests call link_user_tags, and three of them fail with the change undone.' },
      proof: { score: 4, evidence: 'The tests call the helper alone. Capped at 4: no request test renders a post with tags.' },
      safety: { score: 5, evidence: 'Every post page and the feed render through it. Capped at 5: a part of it can break.' },
      rollback: { score: 6, evidence: 'A revert of the merge, with no flag and no data to undo.' },
    },
    missing: 'A request test that renders a post with tags in its text and inside code.',
    floors: [{ name: 'proof', score: 4, needs: 6 }],
    head,
    by: 'change-review',
    at: RATED_AT,
  }
}
