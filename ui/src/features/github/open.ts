import type { MouseEvent } from 'react'
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

/**
 * Opens a pull request, from its row or from the spotlight. A pull request belongs in Change Review, and this is the
 * one place that hands it over: until Change Review can open a pull request, it opens on github.com.
 */
export function openPullRequestReview(pull: GitHubPull): void {
  openGitHubPage(pull.url)
}
