import { useMemo, useRef } from 'react'
import { shallow } from 'zustand/vanilla/shallow'
import type { WorkState } from '#shared/protocol/work.ts'
import { useActionItems } from '@/features/actions/store.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { useReports } from '@/features/reports/store.ts'
import { useRoutines } from '@/features/routines/store.ts'
import { useAgents, useHostKept } from '@/lib/host/hooks.ts'
import { keepSame } from '@/lib/host/keep-same.ts'
import { initialHostState, type HostState } from '@/lib/host/state.ts'
import { useDismissals } from './dismissals.ts'
import { gatherHomeInput } from './input.ts'
import { homeParts, withAgents } from './model.ts'
import type { HomeInput, HomeModel } from './types.ts'

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

/**
 * The parts of work mode Home's model reads (`model.ts`). Today's token count, which comes about once a second while
 * agents write, is not one of them. The host's state keeps a part that did not change as the same object.
 */
export const HOME_WORK = ['held', 'agents', 'queue', 'queued', 'projects', 'finished', 'yolo'] as const satisfies readonly (keyof WorkState)[]

type HomeFields = ReturnType<typeof homeHostFields>

const sameForHome = (held: WorkState | null, next: WorkState | null) =>
  held === next || (held !== null && next !== null && HOME_WORK.every((key) => held[key] === next[key]))

/** The fields held while they say the same, with work mode held while each part of it Home reads is the one held. */
function keepHomeFields(held: HomeFields, next: HomeFields): HomeFields {
  const fields = sameForHome(held.work, next.work) ? { ...next, work: held.work } : next
  return shallow(held, fields) ? held : fields
}

const NO_AGENTS: HomeInput['agents'] = []

/**
 * Everything Home draws, from what the app already holds. A change of the agents at work makes only their parts again,
 * and each part of the model that says the same as before stays the object it was, so a section draws again only for
 * its own part.
 */
export function useHomeModel(): HomeModel {
  // The time, once a minute, so "12 min ago" and the day strip stay true while Home is open.
  const now = useNow(true, MINUTE_MS)
  const fields = useHostKept(homeHostFields, keepHomeFields)
  const agents = useAgents()
  const reports = useReports()
  const actions = useActionItems()
  const routines = useRoutines()
  const dismissed = useDismissals((state) => state.ids)
  const parts = useMemo(
    () => homeParts(gatherHomeInput(now, homeHost(fields), reports, actions, routines, dismissed, NO_AGENTS)),
    [now, fields, reports, actions, routines, dismissed],
  )
  const held = useRef<HomeModel | null>(null)
  return useMemo(() => (held.current = keepSame(held.current, withAgents(parts, agents))), [parts, agents])
}
