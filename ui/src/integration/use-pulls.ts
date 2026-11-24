import { useMemo } from 'react'
import type { PullRequest } from '#shared/protocol/pulls.ts'
import { pullRequestsOf } from './pulls.ts'
import { windowParts } from './registry.ts'
import { useSlice } from './use-slice.ts'

/**
 * Every pull request the integrations hold, for Work's rows and the trail's titles. The parts are fixed once the
 * window has started, so the hooks below run the same number of times on every draw.
 */
export function usePullRequests(): PullRequest[] {
  const parts = windowParts()
  const states = parts.map((part) => useSlice<unknown>(part.manifest.id))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => pullRequestsOf(parts, states), states)
}
