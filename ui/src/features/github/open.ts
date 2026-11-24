import type { MouseEvent } from 'react'
import { reviewIdOf, targetOfReviewId } from '#shared/review/ids.ts'
import { useView } from '@/app/view-store.ts'
import { openAddress, openLink } from '@/lib/open-link.ts'
import type { GitHubPull } from '@/lib/host/index.ts'

/** A row is a link to its page on github.com (the window opens it through the core's `system.open`). Until the switch, Work and the spotlight still call it by this name. */
export function openOnGitHub(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  openLink(event, url)
}

/** Opens a page on github.com without a link to follow. */
export function openGitHubPage(url: string): void {
  openAddress(url)
}

/** Opens this pull request in shared Review, from its row or the spotlight. */
export function openPullRequestReview(pull: GitHubPull): void {
  const target = targetOfReviewId(pull.url)
  if (target?.kind === 'pull') useView.getState().openReviewFor(reviewIdOf(target))
}
