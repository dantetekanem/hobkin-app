import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useActionItems } from '@/features/actions/store.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { useReports } from '@/features/reports/store.ts'
import { useRoutines } from '@/features/routines/store.ts'
import { useAgents, useHost } from '@/lib/host/hooks.ts'
import { initialHostState, type HostState } from '@/lib/host/state.ts'
import { useDismissals } from './dismissals.ts'
import { gatherHomeInput } from './input.ts'
import { homeModel } from './model.ts'
import type { HomeModel } from './types.ts'

const MINUTE_MS = 60_000

/**
 * What `gatherHomeInput` reads of the host's state, and nothing more, so a message that changes none of it, such as
 * the `turn` message for each word of a reply, does not draw Home again. `ui/test/home-host-fields.test.ts` fails when
 * `gatherHomeInput` reads a field this leaves out. The agents at work come from `useAgents` instead of the runs and
 * their activity, which change with every step an agent streams.
 */
export const homeHostFields = (state: HostState) => ({
  home: state.home,
  question: state.question,
  work: state.work,
  github: state.github,
  integrations: state.integrations,
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
  // The time, once a minute, so "12 min ago" and the day strip stay true while Home is open.
  const now = useNow(true, MINUTE_MS)
  const fields = useHost(useShallow(homeHostFields))
  const agents = useAgents()
  const reports = useReports()
  const actions = useActionItems()
  const routines = useRoutines()
  const dismissed = useDismissals((state) => state.ids)
  return useMemo(
    () => homeModel(gatherHomeInput(now, homeHost(fields), reports, actions, routines, dismissed, agents)),
    [now, fields, reports, actions, routines, dismissed, agents],
  )
}
