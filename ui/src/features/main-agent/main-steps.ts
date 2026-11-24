import { useMemo, useRef, useState } from 'react'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { Mood } from '@/avatar/moods.tsx'
import { sampleAt, sampleLength } from '@/features/agent-activity/sample.ts'
import { familyOf, pauseOf, stepCount } from '@/features/agent-activity/steps.ts'
import { sameTasks, tasksOf, type AgentTask } from '@/features/agent-activity/tasks.ts'
import type { EntryTime } from '@/features/agent-activity/use-agent-activity.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { useHasHost, useHost } from '@/lib/host/index.ts'
import { mainActivityOf } from './mind.ts'
import { SAMPLE_MAIN } from './sample.ts'

/**
 * What hobkin's mind reads of its main agent's steps, each part of it only what it shows: the host's steps while one is
 * connected, the sample's before. A part draws again only when what it shows changes, not for every step.
 */

/** When the sample first played, so it plays on from there. */
let sampleStart: number | undefined

/** When the sample first played, read once by each part. */
export function useSampleStart(): number {
  const [start] = useState(() => (sampleStart ??= Date.now()))
  return start
}

/**
 * When the sample's steps first played. The host's are timed as the host sends them, whether the mind is open or not
 * (`mainTimeOf`), so a mind opened late shows its earlier steps' real times.
 */
const times = new Map<string, EntryTime>()
export const sampleTimeOf = (id: string) => times.get(id)
function timeSteps(entries: readonly ActivityEntry[], now: number) {
  for (const entry of entries) {
    const time = times.get(entry.id)
    const running = entry.kind === 'tool' && entry.state === 'running'
    if (!time) times.set(entry.id, running ? { seen: now, started: now } : { seen: now })
    else if (!running && time.started !== undefined && time.ended === undefined) time.ended = now
  }
}

/** The face says what the steps say: a tool running, a pause between steps, or rest between turns. hobkin's thinking itself is never shown. */
export function moodOf(entries: readonly ActivityEntry[], busy: boolean): Mood {
  if (!busy) return 'idle'
  const last = entries.at(-1)
  if (last?.kind !== 'tool' || last.state !== 'running') return 'thinking'
  return ['read', 'search', 'list', 'fetch'].includes(familyOf(last.name)) ? 'searching' : 'working'
}

/** The main agent's steps, an empty list before its first, or null from a host too old to send them. */
type Entries = readonly ActivityEntry[] | null

/** What one part of the mind shows of the steps (`select`). It draws again only when that says something new by `same`. */
function useMainOf<Shown>(select: (entries: Entries) => Shown, same: (held: Shown, next: Shown) => boolean = Object.is): Shown {
  const live = useHasHost()
  const start = useSampleStart()
  const now = useNow(!live && Date.now() - start <= sampleLength(SAMPLE_MAIN), 500)
  const sampled = live ? null : sampleAt(SAMPLE_MAIN, now - start)
  useMemo(() => sampled && timeSteps(sampled, Date.now()), [sampled])
  const held = useRef<{ entries: Entries; select: typeof select; shown: Shown } | null>(null)
  return useHost((state) => {
    const entries = live ? mainActivityOf(state.snapshot) : sampled
    const before = held.current
    if (before && before.entries === entries && before.select === select) return before.shown

    // Something that says the same as what is shown stays the very value shown, so the part does not draw again.
    const next = select(entries)
    const shown = before && same(before.shown, next) ? before.shown : next
    held.current = { entries, select, shown }
    return shown
  })
}

const whole = (entries: Entries) => entries

/** The steps themselves, for the part that draws them: it draws again for every step. */
export function useMainSteps(): Entries {
  return useMainOf(whole)
}

/** What the mind's header and frame show of the steps: whether there are any, how many, and how the newest stands. */
export interface Head {
  any: boolean
  steps: number
  /** The face while hobkin is busy. */
  mood: Mood
  /** Between steps. */
  thinking: boolean
}

function headOf(entries: Entries): Head | null {
  if (entries === null) return null
  return {
    any: entries.length > 0,
    steps: stepCount(entries),
    mood: moodOf(entries, true),
    thinking: pauseOf(entries) === 'thinking',
  }
}

function sameHead(left: Head | null, right: Head | null): boolean {
  if (left === right) return true
  if (left === null || right === null) return false
  return left.any === right.any && left.steps === right.steps && left.mood === right.mood && left.thinking === right.thinking
}

/** What the header shows of the steps, null from a host too old to send them. It changes with the count or the newest step's state. */
export function useMainHead(): Head | null {
  return useMainOf(headOf, sameHead)
}

const NO_TASKS: readonly AgentTask[] = []
const tasksFrom = (entries: Entries) => (entries ? tasksOf(entries) : NO_TASKS)

/** The main agent's tasks, kept as they are until a task changes. */
export function useMainTasks(): readonly AgentTask[] {
  return useMainOf(tasksFrom, sameTasks)
}
