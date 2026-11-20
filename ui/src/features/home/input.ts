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

const NONE: ReadonlySet<string> = new Set()

/** Read-only Home inputs; source stores keep their own sample behavior for other screens. */
export function gatherHomeInput(now: number, host: HostState, reports: Reports, actions: Actions, routines: Routines, dismissed: ReadonlySet<string> = NONE): HomeInput {
  // Reports clears ready on a new-home hello and accepts only its following publication.
  // Unlike link status, this preserves accepted same-home facts through a disconnect.
  const live = host.home !== null && reports.ready && !reports.sample
  if (!live) return {
    now, live: false, reports: [], read: new Set(), attention: null, waiting: [], question: null,
    work: null, github: GITHUB_UNKNOWN, routines: [], agents: [], wins: null, integrations: null, dismissed, layout: null, custom: null, thoughts: null,
  }
  return {
    now,
    live,
    dismissed,
    // Where a future hourly hobkin job would feed its own widget ordering. Absent today, so the client orders itself.
    layout: (host.snapshot as { homeLayout?: unknown }).homeLayout ?? null,
    // The custom widgets hobkin authored and keeps. Empty until hobkin's tool writes them into the snapshot.
    custom: (host.snapshot as { homeCustom?: unknown }).homeCustom ?? null,
    // Proactive thoughts hobkin surfaces in the tip strip. Empty until hobkin's tool writes them into the snapshot.
    thoughts: (host.snapshot as { homeThoughts?: unknown }).homeThoughts ?? null,
    reports: newestFirst(reports.inbox.reports),
    read: reports.inbox.read,
    attention: host.snapshot.reportAttention,
    reminders: host.snapshot.reminderOccurrences,
    waiting: actions.sample ? [] : actions.rows.filter(({ id }) => !actions.answering.includes(id)),
    question: host.question,
    work: host.work,
    github: host.github && !host.github.sample ? host.github : GITHUB_UNKNOWN,
    routines: routines.sample === null ? routines.prepared.facts : [],
    agents: agentsFrom(host.snapshot),
    wins: host.snapshot.wins,
    integrations: host.integrations,
    proofs: host.proofs ?? null,
  }
}
