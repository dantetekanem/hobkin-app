import { useEffect, useMemo, useState } from 'react'
import { useWaitingRows } from '@/features/actions/store.ts'
import { newestFirst } from '@/features/reports/inbox.ts'
import { useReports } from '@/features/reports/store.ts'
import { useRoutines } from '@/features/routines/store.ts'
import { useAgents, useGitHub, useHasHost, useHost, usePendingQuestion, useWork } from '@/lib/host/hooks.ts'
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

/** Everything Home draws, from what the app already holds. */
export function useHomeModel(): HomeModel {
  const now = useMinute()
  const inbox = useReports((state) => state.inbox)
  const reports = useMemo(() => newestFirst(inbox.reports), [inbox.reports])
  const attention = useHost((state) => state.snapshot.reportAttention)
  const wins = useHost((state) => state.snapshot.wins)
  const waiting = useWaitingRows()
  const question = usePendingQuestion()
  const work = useWork()
  const live = useHasHost()
  const github = useGitHub()
  const agents = useAgents()
  const routines = useRoutines((state) => state.prepared.facts)
  const read = inbox.read
  return useMemo(
    () => homeModel({ now, reports, read, attention, waiting, question, work, live, github, routines, agents, wins }),
    [now, reports, read, attention, waiting, question, work, live, github, routines, agents, wins],
  )
}
