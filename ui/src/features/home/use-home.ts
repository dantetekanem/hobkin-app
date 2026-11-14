import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useActionItems } from '@/features/actions/store.ts'
import { useReports } from '@/features/reports/store.ts'
import { useRoutines } from '@/features/routines/store.ts'
import { useHost } from '@/lib/host/hooks.ts'
import { initialHostState, type HostState } from '@/lib/host/state.ts'
import { useDismissals } from './dismissals.ts'
import { gatherHomeInput } from './input.ts'
import { homeModel } from './model.ts'
import type { HomeModel } from './types.ts'

const MINUTE_MS = 60_000

/** The time, once a minute, so "12 min ago" and the day strip stay true while Home is open. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}

/**
 * What `gatherHomeInput` reads of the host's state, and nothing more, so a message that changes none of it, such as
 * the `turn` message for each word of a reply, does not draw Home again. `ui/test/home-host-fields.test.ts` fails when
 * `gatherHomeInput` reads a field this leaves out.
 */
export const homeHostFields = (state: HostState) => ({
  home: state.home,
  question: state.question,
  work: state.work,
  github: state.github,
  integrations: state.integrations,
  // `agentsFrom` reads these two.
  runs: state.snapshot.runs,
  jobActivity: state.snapshot.jobActivity,
  reportAttention: state.snapshot.reportAttention,
  reminderOccurrences: state.snapshot.reminderOccurrences,
  wins: state.snapshot.wins,
  homeLayout: state.snapshot.homeLayout,
  homeCustom: state.snapshot.homeCustom,
  homeThoughts: state.snapshot.homeThoughts,
})

/** The whole host state `gatherHomeInput` takes, built from those fields. What Home does not read keeps its initial value. */
export function homeHost({ home, question, work, github, integrations, ...snapshot }: ReturnType<typeof homeHostFields>): HostState {
  return { ...initialHostState, home, question, work, github, integrations, snapshot }
}

/** Everything Home draws, from what the app already holds. */
export function useHomeModel(): HomeModel {
  const now = useMinute()
  const fields = useHost(useShallow(homeHostFields))
  const reports = useReports()
  const actions = useActionItems()
  const routines = useRoutines()
  const dismissed = useDismissals((state) => state.ids)
  return useMemo(
    () => homeModel(gatherHomeInput(now, homeHost(fields), reports, actions, routines, dismissed)),
    [now, fields, reports, actions, routines, dismissed],
  )
}
