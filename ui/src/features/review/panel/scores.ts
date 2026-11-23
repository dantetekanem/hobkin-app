import type { ChangeScores } from '#shared/protocol/work.ts'

/** What the panel's Scores part says: the lines for a change that was scored, or the one line for a change that was not. */
export interface ScoresView {
  /** The kind and the general rate. Null with no scores. */
  heading: string | null
  rows: { name: string; number: string; evidence: string }[]
  /** One line for each floor that holds the change. */
  floors: string[]
  /** Set when the scores are for an older commit. */
  older: string | null
  /** Set with no scores: that the change was not scored, and what starts a scored review. */
  none: string | null
}

const NOT_SCORED =
  "This change was not scored. Review on the change's Work card starts a scored review, and so does scoring finished changes in the workload."

/** Every finished change has the part, so nothing under it moves when its scores arrive. A pull request has none. */
export const scoresWanted = (reviewId: string): boolean => reviewId.startsWith('change:')

/** A score says how well a question is answered. It is never the review's level, which is the risk of a break. */
export function scoresView(scores: ChangeScores | null | undefined): ScoresView {
  if (!scores) return { heading: null, rows: [], floors: [], older: null, none: NOT_SCORED }
  return {
    heading: `${scores.kind}, general rate ${scores.rate}`,
    rows: scores.scores.map(({ name, score, evidence }) => ({ name, number: score == null ? '?' : String(score), evidence })),
    floors: scores.floors.map(({ name, score, needs }) => `Held whatever the rate: ${name} is ${score}, under the ${needs} it needs.`),
    older: scores.stale ? 'Scored on an older commit, not this one.' : null,
    none: null,
  }
}
