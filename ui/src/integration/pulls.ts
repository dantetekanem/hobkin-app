import type { PullRequest } from '#shared/protocol/pulls.ts'
import type { WindowPart } from './contract.ts'

/** The pull requests each part's state holds, parts in order. A part with none to give gives none. */
export function pullRequestsOf(parts: readonly WindowPart[], states: readonly unknown[]): PullRequest[] {
  return parts.flatMap((part, at) => part.pulls?.(states[at] as never) ?? [])
}
