/**
 * hobkin's own scored run has its part, under the review's own ratings, on every finished change, so nothing under it
 * moves when its scores arrive. A pull request is never scored by hobkin, so it has none.
 */
export const scoresWanted = (reviewId: string): boolean => reviewId.startsWith('change:')
