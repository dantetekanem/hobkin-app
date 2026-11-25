import { useEffect, useState } from 'react'
import type { AgentSchedule } from '#shared/protocol/schedules.ts'
import { hasHost } from '@/lib/host/frame.ts'
import { runCommand, useHost } from '@/lib/host/index.ts'
import { placedRuns, runsKey, type PlacedRun } from './runs.ts'
import { placeKey, type SchedulePlace } from './schedules.ts'

const NONE: readonly AgentSchedule[] = []
const NO_RUNS: readonly PlacedRun[] = []

/**
 * Every run of a place's own schedules, in the order they ended, for its conversation (`runs.ts`): read from hobkin
 * with `schedule.runs` when the page opens and again each time one of them runs, so a reload has them all. A schedule
 * that ended long ago and left the snapshot's list keeps its runs here while hobkin keeps them. None with no host,
 * before the first read, and from a host that keeps none. An answer for a key that has changed since is dropped.
 */
export function useScheduleRuns(place: SchedulePlace): readonly PlacedRun[] {
  const connected = useHost((state) => hasHost(state) && state.link === 'open')
  const key = useHost((state) => (connected ? runsKey(state.snapshot.agentSchedules ?? NONE, place) : null))
  const where = placeKey(place)
  const [read, setRead] = useState<{ where: string; runs: readonly PlacedRun[] } | null>(null)

  useEffect(() => {
    if (key === null) return
    let current = true
    const [kind, id] = [place.kind, place.kind === 'main' ? undefined : place.id]
    runCommand('schedule.runs', id === undefined ? { kind } : { kind, id }).then(
      (answer) => {
        if (current) setRead({ where, runs: placedRuns(answer.schedules) })
      },
      // A host from before has no such command, and a refusal leaves the rows as they were.
      () => {},
    )
    return () => {
      current = false
    }
    // `where` names the place, so the place itself is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, where])

  return read?.where === where ? read.runs : NO_RUNS
}
