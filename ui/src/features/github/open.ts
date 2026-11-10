import type { MouseEvent } from 'react'
import { reviewIdOf, targetOfReviewId } from '#shared/review/ids.ts'
import { useView } from '@/app/view-store.ts'
import { runCommand, type GitHubPull } from '@/lib/host/index.ts'

/** The Mac window. Its web view opens no window of its own for a link, and the shell has no opener for one. */
const inMacWindow = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * A row is a link to its page on github.com. In a browser tab the link opens it, as any link does. In the Mac
 * window the host opens it in the system browser instead (`github.open`).
 */
export function openOnGitHub(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  if (!inMacWindow) return
  event.preventDefault()
  void runCommand('github.open', { url }).catch(() => {})
}

/** Opens a page on github.com without a link to follow, as the spotlight does: in the system browser from the Mac window, in a new tab from a browser tab. */
export function openGitHubPage(url: string): void {
  if (inMacWindow) void runCommand('github.open', { url }).catch(() => {})
  else window.open(url, '_blank', 'noopener,noreferrer')
}

/** Opens this pull request in shared Review, from its row or the spotlight. */
export function openPullRequestReview(pull: GitHubPull): void {
  const target = targetOfReviewId(pull.url)
  if (target?.kind === 'pull') useView.getState().openReviewFor(reviewIdOf(target))
}
