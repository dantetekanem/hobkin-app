import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { hostStore, runCommand } from '../../lib/host/client.ts'
import type { HostState } from '../../lib/host/state.ts'
import { hasHost } from '../../lib/host/frame.ts'
import { useView } from '../../app/view-store.ts'
import { routinesFromHost, templatesFromHost } from './host-data.ts'
import type { TimesEdit, WindowEdit } from './edit.ts'
import { groupChoices, groupOf, type GroupChoices } from './groups.ts'
import { prepareRoutines, withSkyWidth, type PreparedRoutines } from './prepare.ts'
import { changeTimes, finishRun, holdFor, setEnabled, startRun, type RunOutcome } from './rules.ts'
import { buildSample, SAMPLE_OUTCOMES } from './sample.ts'
import { occurrencesBetween } from './timeline.ts'
import type { Recurrence, RoutinesData, RoutineTemplate } from './types.ts'

/**
 * With a host, Run now, the switch and new times are hobkin's own commands, and its snapshot then shows what it did.
 * Without a host, the explicit sample keeps its simulated actions. Only the view is persisted; a host snapshot always
 * owns the routine data.
 *
 * What the screen draws is worked out here, ahead of time: whenever the data changes, on each minute, and when
 * the sky's width changes (`prepared`). Opening the screen then only draws what is ready.
 */

/** All routines grouped by how often they run, or the next seven days in time order. */
export type RoutinesView = 'all' | 'week'

/** The user's own timezone. The screen counts its days in it. */
export const VIEW_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

/** A Run now, switch or change of times hobkin is making. The switch shows where it is going meanwhile. */
export type Pending = { action: 'run' } | { action: 'enable'; enabled: boolean } | { action: 'times' }

/** The host's commands, through the window's connection. A test hands in a host of its own. */
export const routinesHost = { run: runCommand, templates: () => runCommand('routine.templates', {}) }

const SECOND = 1000
const MINUTE = 60 * SECOND

type Deletion = { id: string; expectedDefinition: string; home: string; epoch: number; navigation: number; pending: boolean; refusal?: string }
const definitionOf = (id: string): string | undefined => {
  const rows = hostStore.getState().snapshot.schedules
  const row = Array.isArray(rows) ? rows.find((row) => row?.id === id) : undefined
  return typeof row?.expectedDefinition === 'string' && /^[a-f0-9]{64}$/.test(row.expectedDefinition) ? row.expectedDefinition : undefined
}

interface RoutinesState {
  navigation: number
  deletion: Deletion | null
  askDelete: (id: string) => string | null
  cancelDelete: () => void
  confirmDelete: () => Promise<string | null>
  data: RoutinesData
  /** The screen worked out from `data` for the current minute. */
  prepared: PreparedRoutines
  /** Null for host data; otherwise the explicitly labelled sample. */
  sample: 'full' | 'empty' | null
  view: RoutinesView
  /** Which groups of All routines the user opened or folded. A group never touched follows what is due. Kept with the view. */
  groups: GroupChoices
  /** The routine whose detail is open. */
  openId: string | null
  /** The row the detail opened from. The keyboard goes back to it when the detail closes. */
  openFrom: string | null
  /** The routine the pointer or the keyboard is on. Its times light up in the sky. */
  lit: string | null
  /** What hobkin is doing for a routine now. One thing at a time for each routine. */
  pending: Record<string, Pending>
  /** Why hobkin did not do a routine's last Run now or switch, in its words, until the next action on it. */
  refused: Record<string, string>

  setView: (view: RoutinesView) => void
  setGroup: (group: Recurrence, open: boolean) => void
  open: (id: string, from: string) => void
  close: () => void
  light: (id: string | null) => void
  /** Each answers with null once done, or with the reason it was not, in hobkin's words. */
  runNow: (id: string) => Promise<string | null>
  setEnabled: (id: string, enabled: boolean) => Promise<string | null>
  changeTimes: (id: string, edit: TimesEdit | WindowEdit) => Promise<string | null>
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

/** One action on a host routine. It is pending until hobkin answers, and by then hobkin's snapshot has the change. */
async function onHost(id: string, pending: Pending, call: () => Promise<unknown>): Promise<string | null> {
  const before = useRoutines.getState()
  if (before.pending[id] || before.deletion?.pending && before.deletion.id === id) return 'hobkin is still busy with this routine.'
  const { [id]: _last, ...refused } = before.refused
  useRoutines.setState({ pending: { ...before.pending, [id]: pending }, refused })

  let refusal: string | null = null
  try {
    await call()
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error)
  }
  // A refused time shows in its form. Run now and the switch show theirs by the routine.
  useRoutines.setState(({ pending: { [id]: _done, ...still }, refused: kept }) => ({
    pending: still,
    refused: refusal !== null && pending.action !== 'times' ? { ...kept, [id]: refusal } : kept,
  }))
  return refusal
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
      groups: {},
      navigation: 0,
      deletion: null,
      openId: null,
      openFrom: null,
      lit: null,
      pending: {},
      refused: {},

      setView: (view) => set({ view }),
      setGroup: (group, open) => set({ groups: { ...get().groups, [group]: open } }),
      // Its group opens too, so the keyboard has a row to come back to when the detail closes.
      open: (id, from) => {
        const routine = get().data.routines.find((row) => row.id === id)
        const group = routine ? groupOf(routine) : null
        set({
          openId: id,
          openFrom: from,
          lit: id,
          navigation: get().navigation + 1,
          deletion: null,
          ...(group && get().groups[group] !== true ? { groups: { ...get().groups, [group]: true } } : {}),
        })
      },
      // What it opened from stays known, so the keyboard can go back to it.
      close: () => set({ openId: null, lit: null, navigation: get().navigation + 1, deletion: null }),
      askDelete: (id) => {
        const host = hostStore.getState()
        const expectedDefinition = definitionOf(id)
        const routine = get().data.routines.find((row) => row.id === id)
        if (get().sample !== null || host.link !== 'open' || !host.home || !expectedDefinition || !routine ||
          get().openId !== id || get().pending[id] || get().deletion?.pending || routine.nextRun?.state === 'running' || id in get().data.running) {
          const refusal = 'Cannot delete now: connect to a current host and stop this routine first.'
          set({ refused: { ...get().refused, [id]: refusal } })
          return refusal
        }
        set({ deletion: { id, expectedDefinition, home: host.home, epoch: host.epoch, navigation: get().navigation, pending: false } })
        return null
      },
      cancelDelete: () => { if (!get().deletion?.pending) set({ deletion: null }) },
      confirmDelete: async () => {
        const pinned = get().deletion
        if (!pinned) return 'Confirm this routine first.'
        if (pinned.pending) return 'hobkin is still deleting this routine.'
        const host = hostStore.getState()
        if (host.home !== pinned.home || host.epoch !== pinned.epoch || get().navigation !== pinned.navigation ||
          definitionOf(pinned.id) !== pinned.expectedDefinition || host.link !== 'open' || get().sample !== null ||
          get().openId !== pinned.id || get().pending[pinned.id] || pinned.id in get().data.running ||
          get().data.routines.find((row) => row.id === pinned.id)?.nextRun?.state === 'running') {
          const refusal = 'This confirmation is no longer current.'
          set({ deletion: { ...pinned, refusal } })
          return refusal
        }
        const operation = { ...pinned, pending: true }
        set({ deletion: operation })
        let refusal: string | null = null
        try {
          const receipt = await routinesHost.run('routine.delete', { id: pinned.id, expectedDefinition: pinned.expectedDefinition })
          if (receipt?.id !== pinned.id || receipt.deleted !== true) throw Error('hobkin did not confirm deletion of this routine.')
        } catch (error) { refusal = error instanceof Error ? error.message : String(error) }
        if (get().deletion !== operation) return refusal
        if (refusal) set({ deletion: { ...pinned, pending: false, refusal } })
        else { set({ deletion: null }); if (get().openId === pinned.id) get().close() }
        return refusal
      },
      light: (lit) => {
        const { openId } = get()
        // While a detail is open, its routine stays lit.
        if (openId === null && get().lit !== lit) set({ lit })
      },
      runNow: async (id) => {
        if (get().sample === null) return onHost(id, { action: 'run' }, () => routinesHost.run('routine.run', { id }))
        const { data } = get()
        if (id in data.running) return null
        set(ready(startRun(data, id, Date.now(), 'manual')))

        // A sample run takes a few seconds and brings back the next outcome in turn.
        const outcome = SAMPLE_OUTCOMES[manualRuns % SAMPLE_OUTCOMES.length]!
        manualRuns += 1
        finishLater(id, 5 * SECOND + ((manualRuns * 1700) % 4000), outcome)
        return null
      },
      setEnabled: async (id, enabled) => {
        if (get().sample === null) return onHost(id, { action: 'enable', enabled }, () => routinesHost.run('routine.enable', { id, enabled }))
        set(ready(setEnabled(get().data, id, enabled)))
        return null
      },
      changeTimes: async (id, edit) => {
        if (get().sample === null) return onHost(id, { action: 'times' }, () => routinesHost.run('routine.times', { id, ...edit }))
        set(ready(changeTimes(get().data, id, edit, Date.now())))
        return null
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
      // Only the choice of view and of open groups is kept, never routine data.
      partialize: ({ view, groups }) => ({ view, groups }),
      merge: (stored, current) => ({ ...current, ...(stored as Partial<RoutinesState> | undefined), groups: groupChoices((stored as { groups?: unknown } | undefined)?.groups) }),
    },
  ),
)

/** hobkin's templates for the home this window shows, asked once for each home and connection. */
let hostTemplates: { key: string; rows: RoutineTemplate[] } | null = null

/**
 * The templates known for this home and connection. The first look asks hobkin for them and answers with none; they
 * join the screen's data once hobkin answers. A host that cannot list them leaves the screen without templates.
 */
function templatesFor(state: HostState): RoutineTemplate[] {
  const key = `${state.home} ${state.epoch}`
  if (hostTemplates?.key === key) return hostTemplates.rows
  // A connection's first full state starts its epoch. Before it, and while the link is down, there is no one to ask.
  if (state.epoch === 0 || state.link !== 'open') return []
  hostTemplates = { key, rows: [] }

  const landed = (rows: RoutineTemplate[]) => {
    if (hostTemplates?.key !== key) return
    hostTemplates = { key, rows }
    useRoutines.setState((now) => (now.sample === null ? { data: { ...now.data, templates: rows } } : {}))
  }
  routinesHost.templates().then((answer) => landed(templatesFromHost(answer)), () => {})
  return []
}

function syncRoutines(state: HostState, previous?: HostState): void {
  if (previous && state.home === previous.home &&
    state.snapshot.schedules === previous.snapshot.schedules &&
    state.snapshot.errors === previous.snapshot.errors && state.epoch === previous.epoch && state.link === previous.link) return

  stopAllRuns()
  const changedHome = previous !== undefined && state.home !== previous.home
  const current = useRoutines.getState()
  const sample = !hasHost(state) ? 'full' : null
  // Hello still carries the previous home's snapshot until the following state message.
  const data = sample ? freshSample() : routinesFromHost(changedHome ? {} : state.snapshot, templatesFor(state))
  const contains = (id: string | null) => !changedHome && data.routines.some((routine) => routine.id === id)
  useRoutines.setState({
    ...ready(data),
    sample,
    openId: contains(current.openId) ? current.openId : null,
    openFrom: contains(current.openId) ? current.openFrom : null,
    lit: contains(current.lit) ? current.lit : null,
    ...(changedHome ? { pending: {}, refused: {} } : {}),
    ...(current.deletion && (changedHome || state.link !== 'open' || state.epoch !== current.deletion.epoch ||
      (definitionOf(current.deletion.id) !== current.deletion.expectedDefinition &&
        !(current.deletion.pending && !data.routines.some((row) => row.id === current.deletion!.id)))) ? { deletion: null } : {}),
  })
}

syncRoutines(hostStore.getState())
const unsubscribe = hostStore.subscribe(syncRoutines)
const unsubscribeNavigation = useView.subscribe((view, before) => {
  if (view.screen !== before.screen) useRoutines.setState((state) => ({ navigation: state.navigation + 1, deletion: null }))
})

/** Each minute the screen is worked out again for the new time, whether it is open or not. */
let minuteTimer: ReturnType<typeof setTimeout> | undefined
function onMinute(): void {
  useRoutines.setState((state) => ({ prepared: prepareRoutines(state.data, Date.now(), VIEW_ZONE, skyWidth) }))
  minuteTimer = setTimeout(onMinute, MINUTE - (Date.now() % MINUTE))
}
minuteTimer = setTimeout(onMinute, MINUTE - (Date.now() % MINUTE))

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
  unsubscribeNavigation()
})
