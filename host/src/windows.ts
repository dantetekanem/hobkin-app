import { diffActivity, sameEntry, tailOf, type ActivityEntry, type ActivityStep, type JobActivity } from '#shared/protocol/activity.ts'
import { READS_PARAM, type StateMessage } from '#shared/protocol/messages.ts'
import type { HostFacts, StateSync } from './state-sync.ts'

/** What a window says it reads, in its socket address (`?reads=tails,extend`). A window from before says nothing and reads every feed whole. */
export interface Reads {
  /** Jobs it does not watch come as their tails (`tailOf`). */
  tails: boolean
  /** Words and output that only grew come as what was added (`extend` steps). */
  extend: boolean
}

export function readsOf(url: string | undefined): Reads {
  const said = new URL(url ?? '/', 'http://127.0.0.1').searchParams.get(READS_PARAM)?.split(',') ?? []
  return { tails: said.includes('tails'), extend: said.includes('extend') }
}

/** The part of a socket the windows use. */
export interface WindowSocket {
  readonly readyState: number
  readonly OPEN: number
  send(text: string): void
}

/** A job's tail goes out at most this often, four times a second. A job that starts or goes does so at once. */
const TAIL_MS = 250

/**
 * The activity one window holds, kept as the steps it was sent: whole feeds for the jobs it watches and tails for the
 * others, when it reads tails.
 */
class ActivityView {
  private held: JobActivity = {}
  private watched = new Set<string>()
  /** Jobs whose watching changed, sent whole or as a tail with one reset. */
  private turned = new Set<string>()
  private readonly sentAt = new Map<string, number>()
  /** When the tail held back soonest is due, or null when none waits. */
  due: number | null = null
  private readonly reads: Reads
  private readonly now: () => number

  constructor(reads: Reads, now: () => number) {
    this.reads = reads
    this.now = now
  }

  /** The jobs it watches, as the window last said. True when that changed anything. */
  watch(jobs: readonly string[]): boolean {
    const next = new Set(jobs)
    const turned = [...next, ...this.watched].filter((job) => next.has(job) !== this.watched.has(job))
    this.watched = next
    for (const job of turned) this.turned.add(job)
    return turned.length > 0
  }

  /** A window that starts over holds nothing. */
  forget(): void {
    this.held = {}
    this.sentAt.clear()
  }

  /** The steps from what the window holds to what it should hold of `activity` now. A tail sent less than TAIL_MS ago waits. */
  steps(activity: JobActivity): ActivityStep[] {
    const now = this.now()
    const before: Record<string, readonly ActivityEntry[]> = { ...this.held }
    const next: Record<string, readonly ActivityEntry[]> = {}
    const resets: ActivityStep[] = []
    this.due = null

    for (const [job, entries] of Object.entries(activity)) {
      const whole = !this.reads.tails || this.watched.has(job)
      const shown = whole ? entries : tailOf(entries)
      const held = this.held[job]

      // A job whose watching turned goes at once, as one reset. So does a job the window holds whole, or does not hold yet.
      if (this.turned.has(job) && held) {
        resets.push({ op: 'reset', job, entries: [...shown] })
        before[job] = shown
      }
      if ((this.turned.has(job) && held) || whole || !held) {
        if (!whole) this.sentAt.set(job, now)
        next[job] = shown
        continue
      }

      // A tail that reads the same stays the list held. One that changed waits until TAIL_MS after the last one sent.
      if (sameEntries(held, shown)) {
        next[job] = held
        continue
      }
      const due = (this.sentAt.get(job) ?? -Infinity) + TAIL_MS
      if (now < due) {
        next[job] = held
        this.due = Math.min(this.due ?? due, due)
        continue
      }
      this.sentAt.set(job, now)
      next[job] = shown
    }
    this.turned.clear()
    for (const job of this.sentAt.keys()) if (!(job in next)) this.sentAt.delete(job)

    const steps = diffActivity(before, next, { extend: (job) => this.reads.extend && (!this.reads.tails || this.watched.has(job)) })
    this.held = next
    return [...steps, ...resets]
  }
}

/** Two short lists with the same entries, read field by field. */
function sameEntries(left: readonly ActivityEntry[], right: readonly ActivityEntry[]): boolean {
  return left === right || (left.length === right.length && left.every((entry, index) => sameEntry(entry, right[index]!)))
}

export interface WindowsOptions {
  sync: StateSync
  now?: () => number
  /** Runs `run` in `ms`. Returns how to call it off. */
  later?: (run: () => void, ms: number) => () => void
}

const timeout = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms)
  timer.unref()
  return () => clearTimeout(timer)
}

/**
 * Every window connected and the state messages each gets. A window from before gets the same message as all the
 * others, encoded once. A window that reads tails gets the same message with its own activity: whole feeds only for
 * the jobs it watches.
 */
export class Windows {
  private readonly sync: StateSync
  private readonly now: () => number
  private readonly later: NonNullable<WindowsOptions['later']>
  private readonly views = new Map<WindowSocket, ActivityView | null>()
  private callOff: (() => void) | null = null
  private dueAt: number | null = null

  constructor({ sync, now = Date.now, later = timeout }: WindowsOptions) {
    this.sync = sync
    this.now = now
    this.later = later
  }

  /** A window that connected: the state it starts from. One that reads tails starts with every job's tail. */
  open(socket: WindowSocket, reads: Reads): StateMessage {
    if (!reads.tails && !reads.extend) {
      this.views.set(socket, null)
      return this.sync.full()
    }
    const view = new ActivityView(reads, this.now)
    this.views.set(socket, view)
    const steps = view.steps(this.sync.activityNow())
    return { ...this.sync.full({ activity: false }), ...(steps.length ? { activity: steps } : {}) }
  }

  close(socket: WindowSocket): void {
    this.views.delete(socket)
  }

  /**
   * Sends every window what changed. The feeds are compared whole only while a window from before is connected; the
   * others' views compare what each holds.
   */
  publish(facts: HostFacts): void {
    const open = [...this.views].filter(([socket]) => socket.readyState === socket.OPEN)
    const message = this.sync.update(facts, { activity: open.some(([, view]) => view === null) })
    const { activity: _whole, ...rest } = message ?? { type: 'state' as const, rev: this.sync.revision() }
    let encoded: string | null = null
    for (const [socket, view] of open) {
      if (!view) {
        if (message) socket.send((encoded ??= JSON.stringify(message)))
        continue
      }
      if (message?.reset) view.forget()
      this.send(socket, rest, view.steps(this.sync.activityNow()))
    }
    this.schedule()
  }

  /** The jobs a window shows whole steps for. Each one that turns gets one reset: its whole feed, or its tail. */
  watch(socket: WindowSocket, jobs: readonly string[]): void {
    const view = this.views.get(socket)
    if (!view || !view.watch(jobs)) return
    this.send(socket, { type: 'state', rev: this.sync.revision() }, view.steps(this.sync.activityNow()))
    this.schedule()
  }

  /** Sends the tails that waited and are due now. */
  private flush(): void {
    this.callOff = null
    this.dueAt = null
    const now = this.now()
    for (const [socket, view] of this.views) {
      if (!view || view.due === null || view.due > now || socket.readyState !== socket.OPEN) continue
      this.send(socket, { type: 'state', rev: this.sync.revision() }, view.steps(this.sync.activityNow()))
    }
    this.schedule()
  }

  private send(socket: WindowSocket, message: StateMessage, steps: ActivityStep[]): void {
    const out = steps.length ? { ...message, activity: steps } : message
    if (Object.keys(out).length > 2) socket.send(JSON.stringify(out))
  }

  /** One timer, for the tail due soonest. */
  private schedule(): void {
    const dues = [...this.views.values()].flatMap((view) => (view?.due != null ? [view.due] : []))
    const due = dues.length ? Math.min(...dues) : null
    if (due === this.dueAt) return
    this.callOff?.()
    this.callOff = null
    this.dueAt = due
    if (due !== null) this.callOff = this.later(() => this.flush(), Math.max(0, due - this.now()))
  }
}
