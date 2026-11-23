import { useEffect, useMemo, useState } from 'react'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { AgentSchedule } from '#shared/protocol/schedules.ts'
import { hasHost, keepEachEqual, sameFields } from '@/lib/host/frame.ts'
import { hostStore, runCommand, useHasHost, useHostKept } from '@/lib/host/index.ts'
import type { ScheduleSend } from './actions.ts'
import { nextSampleDue, rollSample, SAMPLE_HOBKIN, sampleSchedules } from './sample.ts'
import { schedulesIn, type SchedulePlace } from './schedules.ts'

const NONE: readonly AgentSchedule[] = []

/** A schedule says the same while its fields do, its owner and last run included. */
const sameSchedule = (a: AgentSchedule, b: AgentSchedule) => sameFields(a, b)

/**
 * The schedules a place shows, in the host's order: every one in the home for the main chat, an agent's own for its
 * page. Drawn again only when one of them changes. With no host, the sample's (`sample.ts`).
 */
export function useSchedules(place: SchedulePlace): readonly AgentSchedule[] {
  const live = useHasHost()
  const fromHost = useHostKept(
    (state) => (live ? schedulesIn(state.snapshot.agentSchedules ?? NONE, place) : NONE),
    (held, next) => keepEachEqual(held, next, sameSchedule),
  )
  const sample = useSampleSchedules(!live, place)
  return live ? fromHost : sample
}

// One start for the sample, kept on the page, so every place and every hot update counts down from the same moment.
const slot = globalThis as { __hobkinScheduleSample?: number }
const sampleStart = () => (slot.__hobkinScheduleSample ??= Date.now())

/** The sample, moved on each time one of its repeating schedules comes due, and the sample hobkin's given to this page's hobkin. */
function useSampleSchedules(on: boolean, place: SchedulePlace): readonly AgentSchedule[] {
  const [list, setList] = useState(() => rollSample(sampleSchedules(sampleStart()), Date.now()))
  const due = on ? nextSampleDue(list) : null
  useEffect(() => {
    if (due === null) return
    const timer = setTimeout(() => setList((held) => rollSample(held, Date.now())), Math.max(0, due - Date.now()) + 1)
    return () => clearTimeout(timer)
  }, [due])
  const kind = place.kind
  const id = place.kind === 'main' ? null : place.id
  return useMemo(() => {
    if (!on) return NONE
    const owned = kind === 'hobkin' && id ? list.map((schedule) => (schedule.owner?.id === SAMPLE_HOBKIN ? { ...schedule, owner: { kind: 'hobkin' as const, id } } : schedule)) : list
    return schedulesIn(owned, kind === 'main' || !id ? { kind: 'main' } : { kind, id })
  }, [on, list, kind, id])
}

/** Sends the window's schedule commands, as `agent.stop` goes. Sample schedules have no host to send to, and say so. */
export const sendSchedule: ScheduleSend = (name, args) => {
  if (!hasHost(hostStore.getState())) return Promise.reject(new Error('These are sample schedules. With no hobkin running, nothing is sent.'))
  return runCommand(name, args as never)
}

interface ScheduleListState {
  /** The place whose list is open (`placeKey`), one at a time. */
  open: string | null
  setOpen: (key: string, open: boolean) => void
}

// Kept on the page, so a hot update of this file keeps the list that is open instead of starting a second store.
const held = globalThis as { __hobkinScheduleList?: UseBoundStore<StoreApi<ScheduleListState>> }

/** Which schedules list is open: the main chat's or one page's. Opening one closes the other. */
export const useScheduleList = (held.__hobkinScheduleList ??= create<ScheduleListState>((set) => ({
  open: null,
  setOpen: (key, open) => set((state) => ({ open: open ? key : state.open === key ? null : state.open })),
})))
