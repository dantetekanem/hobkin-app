import { useRef } from 'react'
import { MAIN_ACTIVITY, type ActivityEntry, type JobActivity } from '#shared/protocol/activity.ts'
import { SAMPLE_ACTIVITY } from '@/app/running-agents.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { doingOf, hasHost } from '@/lib/host/frame.ts'
import { hostStore, useHasHost, useHost, useWatchJob, type HostState } from '@/lib/host/index.ts'
import { sampleAt, sampleLength } from './sample.ts'

/** When this window first saw an entry and, for a tool call it saw start, when the call began and when it ended. */
export interface EntryTime {
  seen: number
  started?: number
  ended?: number
}

/** By job, then by entry id. hobkin says when it first saw an entry (`at`); when a call began and ended is the window's own. */
const timings = new Map<string, Map<string, EntryTime>>()

const isRunning = (entry: ActivityEntry) => entry.kind === 'tool' && entry.state === 'running'

/**
 * Whether `before` held the entry as a running call. With no list before, as for a sample's frames, it is taken to.
 * A window that held a job only as its tail may never have seen a call end, and its end time is then not known.
 */
function heldRunning(before: readonly ActivityEntry[] | undefined, index: number, id: string): boolean {
  if (!before) return true
  const held = before[index]?.id === id ? before[index] : before.find((entry) => entry.id === id)
  return held !== undefined && isRunning(held)
}

/**
 * Times the entries of `entries` that are not the same object at the same place in `before`: the ones the host's
 * steps added or changed. An entry no step touched was timed when it came, so it is passed over. hobkin says when it
 * first saw an entry (`at`), so a step that reaches the window late, as when its page opens, keeps when it happened.
 */
function timeEntries(job: string, entries: readonly ActivityEntry[], now: number, before?: readonly ActivityEntry[]): void {
  let known = timings.get(job)
  if (!known) timings.set(job, (known = new Map()))
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!
    if (entry === before?.[index]) continue
    const time = known.get(entry.id)
    const running = isRunning(entry)
    const seen = entry.at ?? now
    if (!time) {
      known.set(entry.id, running ? { seen, started: seen } : { seen })
      continue
    }
    const sawItEnd = !running && time.started !== undefined && time.ended === undefined && heldRunning(before, index, entry.id)
    if (sawItEnd) time.ended = now
  }
}

/** The runs running as the host last listed them. A start-over that lists none yet, as when hobkin opens again, changes nothing here. */
let listed: { runs: unknown; running: ReadonlySet<string> } = { runs: undefined, running: new Set() }

function runningNow(runs: unknown): ReadonlySet<string> {
  if (!Array.isArray(runs)) return listed.running
  if (runs !== listed.runs) {
    const running = runs.filter((run) => run?.state === 'running').map((run) => run.id)
    listed = { runs, running: new Set(running) }
  }
  return listed.running
}

/** How many jobs the host held steps of at the last message, so one that lets go of a job is told without a look at each. */
let heldJobs = 0

// Steps are timed as the host sends them, also for agents whose canvas is not open, so their times are right once it
// is. The main agent's are timed the same way under its own key, whether hobkin's mind is open or not. A job takes its
// times with it once the host holds none of its steps and does not list it as running: not when a start-over lists
// nothing for a moment, nor while an agent the window does not watch comes as its tail. The times are looked through
// for that only when the runs changed or the host let go of a job, not for each message of steps.
const stopTiming = hostStore.subscribe((state, previous) => {
  const now = Date.now()
  const main = state.snapshot.mainActivity
  const mainBefore = previous.snapshot.mainActivity
  if (Array.isArray(main) && main !== mainBefore) timeEntries(MAIN_ACTIVITY, main, now, Array.isArray(mainBefore) ? mainBefore : undefined)
  const next = state.snapshot.jobActivity as JobActivity | undefined
  const before = previous.snapshot.jobActivity as JobActivity | undefined
  const runsChanged = state.snapshot.runs !== previous.snapshot.runs
  if (next === before && !runsChanged) return

  let held = 0
  for (const job in next) {
    held += 1
    const entries = next[job]
    if (entries !== before?.[job] && Array.isArray(entries)) timeEntries(job, entries, now, before?.[job])
  }
  const letGo = held < heldJobs
  heldJobs = held
  if (!runsChanged && !letGo) return

  const running = runningNow(state.snapshot.runs)
  for (const job of timings.keys()) {
    const kept = job === MAIN_ACTIVITY || job.startsWith('sample:') || (next !== undefined && Object.hasOwn(next, job)) || running.has(job)
    if (!kept) {
      timings.delete(job)
      timeReaders.delete(job)
    }
  }
})

/** When the window first saw one of a job's steps and, for a call it saw start, when it began and ended. */
export const entryTimeOf = (job: string, id: string): EntryTime | undefined => timings.get(job)?.get(id)

/** When the window first saw each of the main agent's steps, and when a call it saw start ended. */
export const mainTimeOf = (id: string): EntryTime | undefined => entryTimeOf(MAIN_ACTIVITY, id)
import.meta.hot?.dispose(stopTiming)

const lastTimes = new WeakMap<readonly ActivityEntry[], { timeOf: (id: string) => EntryTime | undefined; last: number | undefined }>()

/**
 * When the agent's last step happened: the latest end of a call, or the latest step first seen. Undefined with none
 * timed. Worked out once for each list of steps: a step's times are set before the list that holds it is read, and a
 * call that ends comes as a new list.
 */
export function lastStepTime(entries: readonly ActivityEntry[], timeOf: (id: string) => EntryTime | undefined): number | undefined {
  const known = lastTimes.get(entries)
  if (known?.timeOf === timeOf) return known.last
  let last: number | undefined
  for (const entry of entries) {
    const time = timeOf(entry.id)
    if (time) last = Math.max(last ?? -Infinity, time.ended ?? time.seen)
  }
  lastTimes.set(entries, { timeOf, last })
  return last
}

/** When each sample agent's canvas first opened, so its sample plays from there. */
const sampleStarts = new Map<string, number>()

/** When a sample agent's sample first played, the main agent's under MAIN_ACTIVITY, so every part of its page plays it from there. */
export function sampleStart(agentId: string): number {
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

/** Each job's one way of reading its times, so a step drawn with it can tell by reference that it reads them the same. */
const timeReaders = new Map<string, (id: string) => EntryTime | undefined>()

function timeReaderOf(job: string): (id: string) => EntryTime | undefined {
  let read = timeReaders.get(job)
  if (!read) timeReaders.set(job, (read = (id) => entryTimeOf(job, id)))
  return read
}

const made = new WeakMap<readonly ActivityEntry[], AgentActivity>()

/** The one activity for these entries read this way, so whatever reads it can tell by reference that nothing changed. */
function activityOf(job: string, entries: readonly ActivityEntry[], cwd: string | undefined, ended: boolean, sample: boolean): AgentActivity {
  const timeOf = timeReaderOf(job)
  const known = made.get(entries)
  if (known && known.timeOf === timeOf && known.cwd === cwd && known.ended === ended && known.sample === sample) return known
  // The host's are timed as they arrive. A sample's are timed as its frames appear.
  if (sample) timeEntries(job, entries, Date.now())
  const activity: AgentActivity = { entries, ...(cwd ? { cwd } : {}), ended, timeOf, sample }
  made.set(entries, activity)
  return activity
}

/** An agent's activity as the host's state holds it, or with no host its sample as far as it has played. */
function readActivity(state: HostState, agentId: string | null, sampled: { entries: readonly ActivityEntry[]; cwd?: string } | undefined): AgentActivity | null {
  if (!agentId) return null
  if (!hasHost(state)) return sampled ? activityOf(`sample:${agentId}`, sampled.entries, sampled.cwd || undefined, false, true) : null
  const entries = (state.snapshot.jobActivity as JobActivity | undefined)?.[agentId]
  if (!Array.isArray(entries)) return null
  const run = state.snapshot.runs?.find((summary) => summary.id === agentId)
  return activityOf(agentId, entries, run?.cwd || undefined, run?.state !== 'running', false)
}

interface Reading<Shown> {
  /** Whether two things shown say the same, so the part need not draw again. */
  same?: (held: Shown, next: Shown) => boolean
  /** The part is out of sight: it keeps what it showed and reads nothing new until it is in sight again. */
  paused?: boolean
}

/**
 * What one part of an agent's page shows of its activity (`select`). The part draws again only when that says something
 * new by `same`, not for every step the agent takes, and while `paused` not at all. The activity is hobkin's job
 * activity for the run while a host is connected, which the host keeps for a while after the job ends (011 A3), and with
 * no host the sample activity some sample agents have, playing on from when their canvas first opened. Null when there
 * is none.
 */
export function useAgentActivityOf<Shown>(agentId: string | null, select: (activity: AgentActivity | null) => Shown, { same = Object.is, paused = false }: Reading<Shown> = {}): Shown {
  // While this agent's steps are on screen, the host sends them whole. Every other agent comes as its tail.
  useWatchJob(agentId)
  const live = useHasHost()
  const sample = !live && agentId ? SAMPLE_ACTIVITY[agentId] : undefined
  const start = sample && agentId ? sampleStart(agentId) : 0
  const now = useNow(!paused && sample !== undefined && Date.now() - start <= sampleLength(sample), 500)
  const sampled = sample ? { entries: sampleAt(sample, now - start), cwd: sample.cwd } : undefined
  const held = useRef<{ activity: AgentActivity | null; select: typeof select; shown: Shown } | null>(null)
  return useHost((state) => {
    const before = held.current
    if (paused && before) return before.shown

    const activity = readActivity(state, agentId, sampled)
    if (before && before.activity === activity && before.select === select) return before.shown

    // Something that says the same as what is shown stays the very value shown, so the part does not draw again.
    const next = select(activity)
    const shown = before && same(before.shown, next) ? before.shown : next
    held.current = { activity, select, shown }
    return shown
  })
}

const whole = (activity: AgentActivity | null) => activity

/** What one agent has done so far, for the part of its page that draws its steps: it draws again for every step. */
export function useAgentActivity(agentId: string | null): AgentActivity | null {
  return useAgentActivityOf(agentId, whole)
}

type Mood = ReturnType<typeof doingOf>['mood']

/** How a face looks while its run works, by the run's newest step. */
const moodOfSteps = (activity: AgentActivity | null): Mood => doingOf(activity ? activity.entries.slice(-1) : undefined).mood

/** The mood a run's steps give its face, which changes when a tool starts or ends, not for what a tool prints. */
export function useStepsMood(agentId: string | null): Mood {
  return useAgentActivityOf(agentId, moodOfSteps)
}

