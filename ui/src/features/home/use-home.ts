import { useEffect, useMemo, useState } from 'react'
import { useActionItems } from '@/features/actions/store.ts'
import { useReports } from '@/features/reports/store.ts'
import { useRoutines } from '@/features/routines/store.ts'
import { useHost } from '@/lib/host/hooks.ts'
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

/** Everything Home draws, from what the app already holds. */
export function useHomeModel(): HomeModel {
  const now = useMinute()
  const host = useHost((state) => state)
  const reports = useReports()
  const actions = useActionItems()
  const routines = useRoutines()
  const dismissed = useDismissals((state) => state.ids)
  return useMemo(
    () => homeModel(gatherHomeInput(now, host, reports, actions, routines, dismissed)),
    [now, host, reports, actions, routines, dismissed],
  )
}
