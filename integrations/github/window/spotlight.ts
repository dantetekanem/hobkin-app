import { CircleDot, GitPullRequest } from 'lucide-react'
import type { GitHubPull, GitHubState } from '../protocol.ts'
import type { SpotlightTarget } from '@/app/spotlight-entries.ts'
import { openAddress } from '@/lib/open-link.ts'
import { openPullRequestReview } from './review.ts'

/** What the spotlight finds of GitHub: the pull requests waiting on the user, their own, and their issues, once gh is connected (or the state is the sample). */
export function githubSpotlight(github: GitHubState): readonly SpotlightTarget[] {
  if (!github.sample && github.connection !== 'connected') return []
  const pull = (waits: boolean) => (pull: GitHubPull): SpotlightTarget => ({
    id: `${waits ? 'review' : 'pull'}:${pull.url}`,
    kind: 'pull',
    title: pull.title,
    detail: `${pull.repo}#${pull.number} · ${waits ? 'waits for your review' : 'yours'}`,
    keywords: [...pull.labels, ...(pull.author ? [pull.author] : [])],
    mark: { icon: GitPullRequest },
    go: () => openPullRequestReview(pull),
  })
  return [
    ...github.reviews.map(pull(true)),
    ...github.pulls.map(pull(false)),
    ...github.issues.map((issue): SpotlightTarget => ({
      id: `issue:${issue.url}`,
      kind: 'issue',
      title: issue.title,
      detail: `${issue.repo}#${issue.number}`,
      keywords: issue.labels,
      mark: { icon: CircleDot },
      go: () => openAddress(issue.url),
    })),
  ]
}
