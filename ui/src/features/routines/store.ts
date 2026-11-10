import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { hostStore } from '../../lib/host/client.ts'
import type { HostState } from '../../lib/host/state.ts'
import { routinesFromHost } from './host-data.ts'
import type { TimesEdit, WindowEdit } from './edit.ts'
import { prepareRoutines, withSkyWidth, type PreparedRoutines } from './prepare.ts'
import { changeTimes, finishRun, holdFor, setEnabled, startRun, type RunOutcome } from './rules.ts'
import { buildSample, SAMPLE_OUTCOMES } from './sample.ts'
import { occurrencesBetween } from './timeline.ts'
import type { RoutinesData } from './types.ts'

/**
 * Host routines are read-only. Without a host, the explicit sample keeps its simulated actions.
 * Only the view is persisted; a host snapshot always owns the routine data.
 *
 * What the screen draws is worked out here, ahead of time: whenever the data changes, on each minute, and when
 * the sky's width changes (`prepared`). Opening the screen then only draws what is ready.
 */

/** All routines grouped by how often they run, or the next seven days in time order. */
export type RoutinesView = 'all' | 'week'

/** The user's own timezone. The screen counts its days in it. */
export const VIEW_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

const SECOND = 1000
const MINUTE = 60 * SECOND

interface RoutinesState {
  data: RoutinesData
  /** The screen worked out from `data` for the current minute. */
  prepared: PreparedRoutines
  /** Null for host data; otherwise the explicitly labelled sample. */
  sample: 'full' | 'empty' | null
  view: RoutinesView
  /** The routine whose detail is open. */
  openId: string | null
  /** The layout id of what the detail opened from, so it grows out of it and shrinks back into it. */
  openFrom: string | null
  /** The routine the pointer or the keyboard is on. Its times light up in the sky. */
  lit: string | null

  setView: (view: RoutinesView) => void
  open: (id: string, from: string) => void
  close: () => void
  light: (id: string | null) => void
  runNow: (id: string) => void
  setEnabled: (id: string, enabled: boolean) => void
  changeTimes: (id: string, edit: TimesEdit | WindowEdit) => void
  showSample: (sample: 'full' | 'empty') => void
  /** The sky measured its width. Its scenes are drawn again for it, and nothing else is worked out again. */
  setSkyWidth: (width: number) => void
}

/** The sky's width when it was last measured. The screen draws its sky for it before it opens. */
let skyWidth = 0

/** New data, with the screen worked out for it now. */
const ready = (data: RoutinesData) => ({ data, prepared: prepareRoutines(data, Date.now(), VIEW_ZONE, skyWidth) })

/** Runs in progress on sample data, and when each one ends. */
const finishing = new Map<string, ReturnType<typeof setTimeout>>()
let manualRuns = 0

function finishLater(id: string, afterMs: number, outcome: RunOutcome): void {
  clearTimeout(finishing.get(id))

  const timer = setTimeout(() => {
    finishing.delete(id)
    useRoutines.setState((state) => ready(finishRun(state.data, id, Date.now(), outcome)))
  }, afterMs)
  finishing.set(id, timer)
}

function stopAllRuns(): void {
  for (const timer of finishing.values()) clearTimeout(timer)
  finishing.clear()
}

/** The routine that is running when the sample opens finishes on its own after a while, as a real one would. */
const FIRST_RUN_ENDS: RunOutcome = {
  status: 'completed',
  usd: 0.29,
  summary: 'Useful: 1 vulnerable package, 3 outdated.',
  report:
    'Useful: 1 vulnerable package, 3 outdated.\n\n**Vulnerable**\n\n- `ws` 8.21.0 to 8.22.2. Minor. Fixes a denial of service on large frames.\n\n**Outdated**\n\n- `zod` 4.1 to 4.3. Minor.\n- `vite` 8.2 to 8.3. Minor.\n- `pino` 9 to 10. Major: the transport options moved.\n\nThis report is sample text.',
}

function freshSample(): RoutinesData {
  const data = buildSample(Date.now(), VIEW_ZONE)
  for (const id of Object.keys(data.running)) finishLater(id, 90 * SECOND, FIRST_RUN_ENDS)
  return data
}

function emptySample(): RoutinesData {
  return {
    routines: [],
    errors: [],
    logs: {},
    memory: {},
    reports: {},
    running: {},
    changedAt: {},
    // hobkin's templates ship with hobkin, so even an empty home has them.
    templates: buildSample(Date.now(), VIEW_ZONE).templates,
  }
}

export const useRoutines = create<RoutinesState>()(
  persist(
    (set, get) => ({
      ...ready(freshSample()),
      sample: 'full',
      view: 'all',
      openId: null,
      openFrom: null,
      lit: null,

      setView: (view) => set({ view }),
      open: (id, from) => set({ openId: id, openFrom: from, lit: id }),
      // What it opened from stays known, so the detail can shrink back into it.
      close: () => set({ openId: null, lit: null }),
      light: (lit) => {
        const { openId } = get()
        // While a detail is open, its routine stays lit.
        if (openId === null && get().lit !== lit) set({ lit })
      },
      runNow: (id) => {
        if (get().sample === null) return
        const { data } = get()
        if (id in data.running) return
        set(ready(startRun(data, id, Date.now(), 'manual')))

        // A sample run takes a few seconds and brings back the next outcome in turn.
        const outcome = SAMPLE_OUTCOMES[manualRuns % SAMPLE_OUTCOMES.length]!
        manualRuns += 1
        finishLater(id, 5 * SECOND + ((manualRuns * 1700) % 4000), outcome)
      },
      setEnabled: (id, enabled) => {
        if (get().sample !== null) set(ready(setEnabled(get().data, id, enabled)))
      },
      changeTimes: (id, edit) => {
        if (get().sample !== null) set(ready(changeTimes(get().data, id, edit, Date.now())))
      },
      showSample: (sample) => {
        if (get().sample === null) return
        stopAllRuns()
        set({
          ...ready(sample === 'full' ? freshSample() : emptySample()),
          sample,
          openId: null,
          lit: null,
        })
      },
      setSkyWidth: (width) => {
        const measured = Math.round(width)
        if (measured <= 0 || measured === skyWidth) return
        skyWidth = measured
        set({ prepared: withSkyWidth(get().prepared, measured, VIEW_ZONE) })
      },
    }),
    {
      name: 'hobkin-client-routines',
      version: 1,
      // Only the choice of view is kept, never routine data.
      partialize: ({ view }) => ({ view }),
    },
  ),
)

function syncRoutines(state: HostState, previous?: HostState): void {
  if (previous && state.home === previous.home &&
    state.snapshot.schedules === previous.snapshot.schedules &&
    state.snapshot.errors === previous.snapshot.errors && state.epoch === previous.epoch) return

  stopAllRuns()
  const changedHome = previous !== undefined && state.home !== previous.home
  const current = useRoutines.getState()
  const sample = state.home === null ? 'full' : null
  // Hello still carries the previous home's snapshot until the following state message.
  const data = sample ? freshSample() : routinesFromHost(changedHome ? {} : state.snapshot)
  const contains = (id: string | null) => !changedHome && data.routines.some((routine) => routine.id === id)
  useRoutines.setState({
    ...ready(data),
    sample,
    openId: contains(current.openId) ? current.openId : null,
    openFrom: contains(current.openId) ? current.openFrom : null,
    lit: contains(current.lit) ? current.lit : null,
  })
}

syncRoutines(hostStore.getState())
const unsubscribe = hostStore.subscribe(syncRoutines)

/** Each minute the screen is worked out again for the new time, whether it is open or not. */
let minuteTimer: ReturnType<typeof setTimeout> | undefined
function onMinute(): void {
  useRoutines.setState((state) => ({ prepared: prepareRoutines(state.data, Date.now(), VIEW_ZONE, skyWidth) }))
  minuteTimer = setTimeout(onMinute, MINUTE - (Date.now() % MINUTE))
}
minuteTimer = setTimeout(onMinute, MINUTE - (Date.now() % MINUTE))

export interface RunningRoutine {
  id: string
  title: string
  startedAt: number
  trigger: 'manual' | 'scheduled'
}

/**
 * The routines running right now, for the frame. A running routine shows in the agents list under the chat
 * too (010-routines). The list is the frame's to draw; this is what it would draw from.
 */
export function useRunningRoutines(): RunningRoutine[] {
  const data = useRoutines((state) => state.data)
  return useMemo(
    () =>
      Object.entries(data.running).flatMap(([id, run]) => {
        const routine = data.routines.find((item) => item.id === id)
        if (!routine) return []
        return [{ id, title: routine.title, startedAt: run.startedAt, trigger: run.trigger }]
      }),
    [data],
  )
}

/**
 * Sample routines that come due while the screen is open run by themselves and finish a few seconds later,
 * so the sky and the logs keep up with the clock. A routine that is off, held or already running is skipped.
 */
let lastTick = Date.now()
const QUIET: RunOutcome = { status: 'no_change', usd: 0.02, summary: 'Nothing new.' }

function tick(): void {
  const now = Date.now()
  const since = lastTick
  lastTick = now

  const { data, sample } = useRoutines.getState()
  if (sample !== 'full') return

  let next = data
  for (const routine of data.routines) {
    if (routine.id in next.running) continue
    if (holdFor(next, routine.id, now)) continue
    if (occurrencesBetween(routine, since, now).length === 0) continue

    next = startRun(next, routine.id, now, 'scheduled')
    finishLater(routine.id, 6 * SECOND, QUIET)
  }
  if (next !== data) useRoutines.setState(ready(next))
}

const ticker = setInterval(tick, 15 * SECOND)

// A saved edit reloads this module. The old clock and runs stop with it, so nothing runs twice.
import.meta.hot?.dispose(() => {
  clearInterval(ticker)
  clearTimeout(minuteTimer)
  stopAllRuns()
  unsubscribe()
})
