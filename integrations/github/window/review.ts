import type { GitHubPull } from '#shared/protocol/github.ts'
import { reviewIdOf, targetOfReviewId } from '#shared/review/ids.ts'
import { useView } from '@/app/view-store.ts'

/** Opens this pull request in shared Review, from its row or the spotlight. */
export function openPullRequestReview(pull: GitHubPull): void {
  const target = targetOfReviewId(pull.url)
  if (target?.kind === 'pull') useView.getState().openReviewFor(reviewIdOf(target))
}
