import { GITHUB_UNKNOWN } from '#shared/protocol/github.ts'
import { agentsFrom } from '@/lib/host/frame.ts'
import type { HostState } from '@/lib/host/state.ts'
import type { useActionItems } from '@/features/actions/store.ts'
import { newestFirst } from '@/features/reports/inbox.ts'
import type { useReports } from '@/features/reports/store.ts'
import type { useRoutines } from '@/features/routines/store.ts'
import type { HomeInput } from './types.ts'

type Reports = ReturnType<typeof useReports.getState>
type Actions = ReturnType<typeof useActionItems.getState>
type Routines = ReturnType<typeof useRoutines.getState>

/** Read-only Home inputs; source stores keep their own sample behavior for other screens. */
export function gatherHomeInput(now: number, host: HostState, reports: Reports, actions: Actions, routines: Routines): HomeInput {
  // Reports clears ready on a new-home hello and accepts only its following publication.
  // Unlike link status, this preserves accepted same-home facts through a disconnect.
  const live = host.home !== null && reports.ready && !reports.sample
  if (!live) return {
    now, live: false, reports: [], read: new Set(), attention: null, waiting: [], question: null,
    work: null, github: GITHUB_UNKNOWN, routines: [], agents: [], wins: null,
  }
  return {
    now,
    live,
    reports: newestFirst(reports.inbox.reports),
    read: reports.inbox.read,
    attention: host.snapshot.reportAttention,
    waiting: actions.sample ? [] : actions.rows.filter(({ id }) => !actions.answering.includes(id)),
    question: host.question,
    work: host.work,
    github: host.github && !host.github.sample ? host.github : GITHUB_UNKNOWN,
    routines: routines.sample === null ? routines.prepared.facts : [],
    agents: agentsFrom(host.snapshot),
    wins: host.snapshot.wins,
  }
}
