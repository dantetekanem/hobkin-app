import { useCallback, useMemo } from 'react'
import { MAIN_ACTIVITY, type ActivityEntry, type JobActivity } from '#shared/protocol/activity.ts'
import { SAMPLE_ACTIVITY } from '@/app/running-agents.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { hostStore, useHasHost, useHost } from '@/lib/host/index.ts'
import { sampleAt, sampleLength } from './sample.ts'

/** When this window first saw an entry and, for a tool call it saw start, when the call began and when it ended. */
export interface EntryTime {
  seen: number
  started?: number
  ended?: number
}

/** By job, then by entry id. hobkin's activity carries no times, so these are the window's own. */
const timings = new Map<string, Map<string, EntryTime>>()

function timeEntries(job: string, entries: readonly ActivityEntry[], now: number): void {
  let known = timings.get(job)
  if (!known) timings.set(job, (known = new Map()))
  for (const entry of entries) {
    const time = known.get(entry.id)
    const running = entry.kind === 'tool' && entry.state === 'running'
    if (!time) known.set(entry.id, running ? { seen: now, started: now } : { seen: now })
    else if (!running && time.started !== undefined && time.ended === undefined) time.ended = now
  }
}

// Steps are timed as the host sends them, also for agents whose canvas is not open, so their times are right once it
// is. The main agent's are timed the same way under its own key, whether hobkin's mind is open or not.
const stopTiming = hostStore.subscribe((state, previous) => {
  const now = Date.now()
  const main = state.snapshot.mainActivity
  if (Array.isArray(main) && main !== previous.snapshot.mainActivity) timeEntries(MAIN_ACTIVITY, main, now)
  const next = state.snapshot.jobActivity as JobActivity | undefined
  if (!next || next === previous.snapshot.jobActivity) return
  const before = previous.snapshot.jobActivity as JobActivity | undefined
  for (const [job, entries] of Object.entries(next)) {
    if (entries !== before?.[job] && Array.isArray(entries)) timeEntries(job, entries, now)
  }
})

/** When the window first saw each of the main agent's steps, and when a call it saw start ended. */
export const mainTimeOf = (id: string): EntryTime | undefined => timings.get(MAIN_ACTIVITY)?.get(id)
import.meta.hot?.dispose(stopTiming)

/** When each sample agent's canvas first opened, so its sample plays from there. */
const sampleStarts = new Map<string, number>()

function sampleStart(agentId: string): number {
  let start = sampleStarts.get(agentId)
  if (start === undefined) sampleStarts.set(agentId, (start = Date.now()))
  return start
}

export interface AgentActivity {
  entries: readonly ActivityEntry[]
  /** The agent's folder, when the host says. Paths inside it are shown from there. */
  cwd?: string
  /** The job has ended, so nothing in it runs any more. */
  ended: boolean
  timeOf: (id: string) => EntryTime | undefined
  /** Made-up activity, drawn while no host is connected. */
  sample: boolean
}

/**
 * What one agent has done so far: hobkin's job activity for its run while a host is connected, which the host keeps
 * for a while after the job ends (011 A3), and with no host the sample activity some sample agents have, playing on
 * from when their canvas first opened. Null when there is none.
 */
export function useAgentActivity(agentId: string | null): AgentActivity | null {
  const live = useHasHost()
  const hosted = useHost((state) => (agentId ? (state.snapshot.jobActivity as JobActivity | undefined)?.[agentId] : undefined))
  const run = useHost((state) => (agentId ? state.snapshot.runs?.find((summary) => summary.id === agentId) : undefined))
  const sample = !live && agentId ? SAMPLE_ACTIVITY[agentId] : undefined
  const start = sample && agentId ? sampleStart(agentId) : 0
  const now = useNow(sample !== undefined && Date.now() - start <= sampleLength(sample), 500)
  const entries = live ? (Array.isArray(hosted) ? hosted : undefined) : sample ? sampleAt(sample, now - start) : undefined
  const job = live ? agentId : agentId && `sample:${agentId}`
  const cwd = live ? run?.cwd : sample?.cwd
  const ended = live && run?.state !== 'running'
  const timeOf = useCallback((id: string) => (job ? timings.get(job)?.get(id) : undefined), [job])

  return useMemo(() => {
    if (!job || !entries) return null
    // The host's are timed as they arrive. A sample's are timed as its frames appear.
    if (!live) timeEntries(job, entries, Date.now())
    return { entries, ...(cwd ? { cwd } : {}), ended, timeOf, sample: !live }
  }, [job, entries, live, cwd, ended, timeOf])
}
