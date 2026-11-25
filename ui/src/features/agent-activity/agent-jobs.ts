import { useEffect, useMemo, useRef } from 'react'
import { MAIN_ACTIVITY, type ActivityEntry, type JobActivity } from '#shared/protocol/activity.ts'
import { hobkinOfAgent } from '#shared/protocol/hobkins.ts'
import type { RunChild, WireSnapshot } from '#shared/protocol/snapshot.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { SAMPLE_MAIN } from '@/features/main-agent/sample.ts'
import { sampleChildren, sampleMainChildren } from '@/features/work/children.ts'
import { watchJob } from '@/lib/host/client.ts'
import { childrenFrom, keepEachEqual, mainChildrenFrom, sameFields } from '@/lib/host/frame.ts'
import { useHasHost, useHost, useHostKept, type HostState } from '@/lib/host/index.ts'
import { SAMPLE_ACTIVITY, sampleAt, sampleLength, type SampleActivity } from './sample.ts'
import { sameSkills, skillsOf } from './skills.ts'
import { sameTasks, tasksOf, type AgentTask } from './tasks.ts'
import { sampleStart } from './use-agent-activity.ts'

/**
 * What one agent's lines read (`AgentLines.tsx`), the same for every agent: the jobs its steps, helpers and teams agents
 * are kept under. A run has one, its own id. hobkin's main agent has one too, `MAIN_ACTIVITY`. A durable hobkin has a run
 * for each of its turns, `hobkin:<id>:<n>`, and its lines read every one the host still holds anything of, so what it
 * did in a turn that ended stays on its page. Its schedules belong to the hobkin itself and are read as its own (056).
 */

const TURN = /^hobkin:([0-9a-f]{8}):(\d+)$/

/** The turn's number when `job` is one of this hobkin's turns, else null. */
function turnOf(job: string, hobkin: string): number | null {
  const match = TURN.exec(job)
  return match?.[1] === hobkin ? Number(match[2]) : null
}

/** This hobkin's turns the host holds steps, helpers or teams agents of, each with its number. */
function heldTurns(snapshot: WireSnapshot, hobkin: string): Map<string, number> {
  const turns = new Map<string, number>()
  const held = [snapshot.jobActivity as JobActivity | undefined, snapshot.jobChildren, snapshot.teamsAgents]
  for (const jobs of held) {
    for (const job of Object.keys(jobs ?? {})) {
      const n = turnOf(job, hobkin)
      if (n !== null) turns.set(job, n)
    }
  }
  return turns
}

/** The jobs of an agent, by its id as the window names it: the turn in flight first, then the newest. */
export function agentJobs(snapshot: WireSnapshot, agentId: string): readonly string[] {
  const hobkin = hobkinOfAgent(agentId)
  if (hobkin === null) return [agentId]

  const newest = [...heldTurns(snapshot, hobkin)].sort(([, a], [, b]) => b - a).map(([job]) => job)
  const live = snapshot.hobkins?.find((summary) => summary.id === hobkin)?.run
  if (!live) return newest

  return [live, ...newest.filter((job) => job !== live)]
}

const sameJobs = (held: readonly string[], next: readonly string[]) => keepEachEqual(held, next, Object.is)

/** An agent's jobs, kept as they are until one comes or goes. */
export function useAgentJobs(agentId: string): readonly string[] {
  return useHostKept((state) => agentJobs(state.snapshot, agentId), sameJobs)
}

/** Holds every job watched while the part is mounted, so a host that takes watching sends their whole steps. */
function useWatchJobs(jobs: readonly string[]): void {
  const key = jobs.join('\n')
  useEffect(() => {
    if (!key) return
    const letGo = key.split('\n').map((job) => watchJob(job))
    return () => {
      for (const stop of letGo) stop()
    }
  }, [key])
}

/** The steps of each job, oldest job first. */
type Lists = readonly (readonly ActivityEntry[])[]

/** A job's steps as the host holds them: the main agent's under `MAIN_ACTIVITY`, a run's under its id. */
function heldSteps(state: HostState, job: string): readonly ActivityEntry[] | undefined {
  const jobs = state.snapshot.jobActivity as JobActivity | undefined
  const steps = job === MAIN_ACTIVITY ? state.snapshot.mainActivity : jobs?.[job]
  return Array.isArray(steps) ? steps : undefined
}

/** The steps the host holds of each job, oldest job first. A job it holds none of is left out. */
function heldLists(state: HostState, jobs: readonly string[]): Lists {
  const lists: (readonly ActivityEntry[])[] = []
  for (const job of jobs) {
    const steps = heldSteps(state, job)
    if (steps) lists.unshift(steps)
  }
  return lists
}

const sampleOf = (job: string): SampleActivity | undefined => (job === MAIN_ACTIVITY ? SAMPLE_MAIN : SAMPLE_ACTIVITY[job])

const sameLists = (left: Lists, right: Lists) => left.length === right.length && left.every((steps, index) => steps === right[index])

/** A job's sample and when it first played. */
interface Played {
  sample: SampleActivity
  start: number
}

/** The samples of the jobs that have one, newest job first. */
function samplesOf(jobs: readonly string[]): Played[] {
  const played: Played[] = []
  for (const job of jobs) {
    const sample = sampleOf(job)
    if (sample) played.push({ sample, start: sampleStart(job) })
  }
  return played
}

/** The sample's steps of each job, as far as each has played, for a window with no host. Oldest job first. */
function useSampledSteps(on: boolean, jobs: readonly string[]): Lists {
  const samples = on ? samplesOf(jobs) : []
  const playing = samples.some(({ sample, start }) => Date.now() - start <= sampleLength(sample))
  const now = useNow(playing, 500)

  return samples.map(({ sample, start }) => sampleAt(sample, now - start)).reverse()
}

/**
 * What one line shows of the steps of all an agent's jobs (`select`). It draws again only when that says something new
 * by `same`, not for every step.
 */
function useJobsOf<Shown>(jobs: readonly string[], select: (lists: Lists) => Shown, same: (held: Shown, next: Shown) => boolean): Shown {
  useWatchJobs(jobs)
  const live = useHasHost()
  const sampled = useSampledSteps(!live, jobs)
  const held = useRef<{ lists: Lists; select: typeof select; shown: Shown } | null>(null)
  return useHost((state) => {
    const lists = live ? heldLists(state, jobs) : sampled
    const before = held.current
    if (before && before.select === select && sameLists(before.lists, lists)) return before.shown

    const next = select(lists)
    const shown = before && same(before.shown, next) ? before.shown : next
    held.current = { lists, select, shown }
    return shown
  })
}

/** Every job's steps as one list, oldest first, as the agent took them. A single job's list is given as it is. */
function together(lists: Lists): readonly ActivityEntry[] {
  const [first, ...rest] = lists
  if (first && rest.length === 0) return first
  return lists.flat()
}

const tasksAcross = (lists: Lists): readonly AgentTask[] => tasksOf(together(lists))
const skillsAcross = (lists: Lists): readonly string[] => skillsOf(together(lists))

/**
 * The agent's tasks, read from all its jobs in the order it took them: a durable hobkin keeps one conversation, so a task
 * made in one turn and done in a later one reads as done. Kept as they are until a task changes.
 */
export function useJobsTasks(jobs: readonly string[]): readonly AgentTask[] {
  return useJobsOf(jobs, tasksAcross, sameTasks)
}

/** The skills the agent loaded in any of its jobs, each once, in the order it first loaded them. Kept until it loads another. */
export function useJobsSkills(jobs: readonly string[]): readonly string[] {
  return useJobsOf(jobs, skillsAcross, sameSkills)
}

const keepSame = (held: readonly RunChild[], next: readonly RunChild[]) => keepEachEqual(held, next, sameFields)
const NO_HELPERS: readonly RunChild[] = []

/** The helpers the host holds of each job: the main agent's own under `MAIN_ACTIVITY`, a run's under its id. */
function heldHelpers(state: HostState, jobs: readonly string[]): readonly RunChild[] {
  return jobs.flatMap((job) => {
    if (job === MAIN_ACTIVITY) return mainChildrenFrom(state.snapshot, state)
    return childrenFrom(state.snapshot, job, state)
  })
}

/** The sample's helpers of each job, for a window with no host. */
function sampleHelpers(jobs: readonly string[]): readonly RunChild[] {
  return jobs.flatMap((job) => {
    if (job === MAIN_ACTIVITY) return sampleMainChildren
    return sampleChildren[job] ?? NO_HELPERS
  })
}

/**
 * The helpers hobkin started for any of the agent's jobs, the newest job's first: the host's for a live window, the
 * sample's before a host has answered. Kept while they say the same, so a helper that moves draws only this.
 */
export function useJobsHelpers(jobs: readonly string[]): readonly RunChild[] {
  const live = useHasHost()
  const helpers = useHostKept((state) => heldHelpers(state, jobs), keepSame)
  const key = jobs.join('\n')
  const sampled = useMemo(() => (live ? NO_HELPERS : sampleHelpers(key.split('\n'))), [live, key])

  return live ? helpers : sampled
}
