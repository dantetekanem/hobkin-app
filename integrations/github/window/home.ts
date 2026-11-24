import type { GitHubConnection, GitHubPull, GitHubState } from '#shared/protocol/github.ts'
import type { HomeAction, HomeCardFields, HomeContribution, HomeRow, HomeTarget, HomeTone } from '@/features/home/types.ts'

/**
 * What GitHub adds to Home (_specs/064-integration-drops): the pull requests waiting for the user's review among what
 * needs them, the user's own pull requests whose checks fail as cards, its tile first among the connections, and a
 * count of the failing ones that lifts the Connections widget.
 */

const open = (target: HomeTarget, label: string): HomeAction => ({ label, target })
const idOf = (pull: GitHubPull) => `github:${pull.repo}#${pull.number}`

/** `unknown` has no tile: the host has not said anything about gh yet. */
const STANDING: Partial<Record<GitHubConnection, { status: string; tone: HomeTone }>> = {
  connected: { status: 'Connected', tone: 'ok' },
  'signed-out': { status: 'Sign in', tone: 'warn' },
  missing: { status: 'Not installed', tone: 'quiet' },
}

function reviewRequest(pull: GitHubPull): { row: HomeRow; card: HomeCardFields } {
  const target: HomeTarget = { to: 'pull', url: pull.url }
  const row: HomeRow = { id: idOf(pull), title: pull.title, detail: `${pull.repo} #${pull.number}`, tone: 'info', aside: null, action: open(target, 'Review') }
  const labels = pull.labels.slice(0, 2).map((label) => ({ label: 'Label', value: label, tone: 'quiet' as const }))
  return {
    row,
    card: {
      id: row.id,
      label: `Review request · ${pull.repo}`,
      reason: 'Waiting for your review',
      tone: row.tone,
      title: row.title,
      detail: pull.author ? `Opened by @${pull.author}` : null,
      facts: [{ label: 'Pull request', value: `#${pull.number}`, tone: 'quiet' }, ...labels],
      primary: open(target, 'Review'),
      secondary: open({ to: 'url', url: pull.url }, 'Open on GitHub'),
    },
  }
}

function checksFailing(pull: GitHubPull): HomeCardFields {
  return {
    id: idOf(pull),
    label: `Checks failing · ${pull.repo}`,
    reason: 'Checks failing',
    tone: 'bad',
    title: pull.title,
    detail: `Your pull request #${pull.number}`,
    primary: open({ to: 'url', url: pull.url }, 'Open on GitHub'),
  }
}

export function githubHome(github: GitHubState): HomeContribution {
  const standing = STANDING[github.connection]
  const contribution: HomeContribution = { known: github.connection !== 'unknown' }
  if (standing) {
    contribution.tile = {
      key: 'gh',
      name: 'GitHub',
      ...standing,
      note: github.login ? `@${github.login}` : null,
      target: { to: 'screen', screen: 'github' },
    }
  }
  if (github.connection !== 'connected') return contribution

  const failing = github.pulls.filter((pull) => pull.checks === 'failing')
  return {
    ...contribution,
    needs: github.reviews.filter((pull) => pull.review === 'waiting').map(reviewRequest),
    cards: failing.map(checksFailing),
    lift: failing.length,
    more: github.more.reviews,
  }
}
