import { isHobkinTurn } from '#shared/protocol/hobkins.ts'
import type { RunChild, RunSummary, WireSnapshot } from '#shared/protocol/snapshot.ts'
import type { SampleAgent, SampleProject, Tier } from '../../app/sample.ts'
import type { HostState } from './state.ts'
import { summaryLine } from '../summary-line.ts'

/**
 * What the frame draws around the conversation, read from hobkin's snapshot: who is working, what waits on the
 * user, which model answers. The shapes are the ones the frame's sample data already has.
 */

/** hobkin's own word for a tool that reads or searches (`src/cli/mood.mjs`). */
const SEARCH_TOOL = /read|grep|find|glob|search|fetch|^ls$/i

// Until `017-model-tiers` gives each run a tier, its thinking level stands in for one.
export const TIER_BY_EFFORT: Record<string, Tier> = { off: 'fast', minimal: 'fast', low: 'fast', medium: 'mid', high: 'high', xhigh: 'max', max: 'max' }

interface ActivityEntry {
  kind?: string
  name?: string
  state?: string
  /** The agent's own words, for an `assistant` entry. */
  text?: string
}

/** A color that stays with the agent for as long as it runs. */
export function hueOf(id: string): number {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 360
  return hash
}

export const folderName = (path: string | undefined) => path?.split('/').filter(Boolean).at(-1) ?? 'session'

export function doingOf(activity: ActivityEntry[] | undefined): Pick<SampleAgent, 'doing' | 'mood'> {
  const last = activity?.at(-1)
  if (!last) return { doing: activity ? 'thinking' : 'starting', mood: 'thinking' }
  if (last.kind === 'tool' && last.state === 'running') {
    return { doing: `running ${last.name ?? 'a tool'}`, mood: SEARCH_TOOL.test(last.name ?? '') ? 'searching' : 'working' }
  }
  return last.kind === 'tool' ? { doing: 'thinking', mood: 'thinking' } : { doing: 'writing', mood: 'thinking' }
}

/**
 * The agent's own latest words, in one line: what it is saying as it works, taken straight from the activity the
 * snapshot already carries. No extra work and no second agent — just the newest thing it said. Absent until it speaks.
 */
export function updateOf(activity: ActivityEntry[] | undefined): string | undefined {
  if (!activity) return undefined
  for (let index = activity.length - 1; index >= 0; index--) {
    const line = lineOf(activity[index]!)
    if (line) return line
  }
  return undefined
}

/** Each entry's line, null for one that says nothing. An entry the host did not change is the same object in the next message. */
const lines = new WeakMap<ActivityEntry, string | null>()

function lineOf(entry: ActivityEntry): string | undefined {
  if (entry.kind !== 'assistant' || !entry.text) return undefined

  let line = lines.get(entry)
  if (line === undefined) {
    // One plain line: an agent's message can be pages of Markdown, and a row and its hover say one line of it.
    line = summaryLine(entry.text) ?? null
    lines.set(entry, line)
  }
  return line ?? undefined
}

function kindOf(run: RunSummary): SampleAgent['kind'] {
  if (run.work) return 'work'
  // `hobkin session` outside Herdr runs as a job on a schedule id of its own (`session-jobs.mjs` in hobkin).
  return run.scheduleId && !run.scheduleId.startsWith('session.') ? 'routine' : 'session'
}

/**
 * A run that is an agent of the list: running, waiting for its time (spec 053), or ended too when asked, and neither the
 * main conversation nor a durable hobkin's turn.
 */
export const isAgentRun = (run: RunSummary, includeEnded = false): run is RunSummary & { id: string } =>
  (includeEnded || run.state === 'running' || run.state === 'waiting') && run.kind !== 'main' && typeof run.id === 'string' && !isHobkinTurn(run)

/** A run that ended its turn to carry on at a time, with no process: when, and its own note of what it will do then. */
export interface AgentWait {
  /** An ISO time. */
  until: string
  note?: string
}

/** An agent as the host's runs make it: a sample agent's fields, and for a run that waits for its time, its wait. */
export interface HostedAgent extends SampleAgent {
  waits?: AgentWait
  /** A living job between its turns (spec 072): since when, as an ISO time. Its run still runs, waiting for a message. */
  idle?: { since: string }
  /** It runs on Claude Code, so its face has the crab pal beside it (avatar/Pals.tsx). */
  onClaudeCode?: true
}

/** A waiting run's note in one plain line, as the list says an agent's words. */
export const waitNoteOf = (run: Pick<RunSummary, 'waitNote'>): string | undefined => (run.waitNote ? summaryLine(run.waitNote) : undefined)

/** The calendar day of `at` where the user is, as a count of days, so two times compare by day. */
function dayNumber(at: number, timeZone?: string): number {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at).split('-').map(Number)
  return Date.UTC(year!, month! - 1, day!) / 86_400_000
}

/**
 * What a waiting run's row says of its time: "waiting until 7:10 PM", "… tomorrow", or the weekday further on, in the
 * user's clock and time zone unless given. Once its time has come it is about to carry on, as hobkin starts it at the
 * next tick with a free place.
 */
export function waitingWords(until: string, now: number, { timeZone, locale }: { timeZone?: string; locale?: string } = {}): string {
  const at = Date.parse(until)
  if (!Number.isFinite(at)) return 'waiting'
  if (at <= now) return 'about to carry on'

  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(at)
  const days = dayNumber(at, timeZone) - dayNumber(now, timeZone)
  if (days === 0) return `waiting until ${time}`
  if (days === 1) return `waiting until ${time} tomorrow`
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }).format(at)
  return `waiting until ${weekday} ${time}`
}

/** What an idle living job's row says of its time: "idle since 10:51 PM", "… yesterday", or the weekday further back, in the user's clock and time zone unless given. */
export function idleWords(since: string, now: number, { timeZone, locale }: { timeZone?: string; locale?: string } = {}): string {
  const at = Date.parse(since)
  if (!Number.isFinite(at)) return 'idle'

  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(at)
  const days = dayNumber(now, timeZone) - dayNumber(at, timeZone)
  if (days <= 0) return `idle since ${time}`
  if (days === 1) return `idle since ${time} yesterday`
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }).format(at)
  return `idle since ${weekday} ${time}`
}

/** A running run that hobkin marks idle: a living job between its turns. */
const isIdle = (run: RunSummary): boolean => run.state === 'running' && run.idle === true

/**
 * Agents for the dock, or also ended runs for a reopened canvas. The main conversation is never an agent, and nor is a
 * durable hobkin's turn: the hobkin itself stands for its turns (`features/hobkins/list.ts`).
 */
export function agentsFrom(snapshot: WireSnapshot, { includeEnded = false }: { includeEnded?: boolean } = {}): HostedAgent[] {
  if (includeEnded) return buildAgents(snapshot, true)
  return madeOnce(agentsMade, snapshot, () => buildAgents(snapshot, false))
}

/** Stands for a snapshot without activity, as a key. */
const NO_ACTIVITY = {}

/** What a list of agents was made from, and the list: the runs, the durable hobkins, and the activity as its key. */
export type MadeLists<List> = WeakMap<object, { runs: WireSnapshot['runs']; hobkins: WireSnapshot['hobkins']; list: List }>

const agentsMade: MadeLists<HostedAgent[]> = new WeakMap()

/**
 * The list `make` gives for a snapshot, made once while its runs, durable hobkins and activity are the same objects,
 * so every reader of one host message shares one list. Readers never change it.
 */
export function madeOnce<List>(made: MadeLists<List>, snapshot: WireSnapshot, make: () => List): List {
  const { runs, hobkins } = snapshot
  const key = (snapshot.jobActivity as object | undefined) ?? NO_ACTIVITY
  const held = made.get(key)
  if (held && held.runs === runs && held.hobkins === hobkins) return held.list

  const list = make()
  made.set(key, { runs, hobkins, list })
  return list
}

/** What a run is doing and how its face looks: from its activity while it works, at rest while it is idle, waits or once it ended. */
function stateOf(run: RunSummary & { id: string }, activity: Record<string, ActivityEntry[]>): Pick<SampleAgent, 'doing' | 'mood'> {
  if (isIdle(run)) return { doing: idleWords(run.idleSince ?? '', Date.now()), mood: 'idle' }
  if (run.state === 'running') return doingOf(activity[run.id])
  if (run.state === 'waiting') return { doing: waitingWords(run.waitUntil ?? '', Date.now()), mood: 'idle' }
  return { doing: run.state, mood: 'idle' }
}

function buildAgents(snapshot: WireSnapshot, includeEnded: boolean): HostedAgent[] {
  const activity = (snapshot.jobActivity ?? {}) as Record<string, ActivityEntry[]>
  return (snapshot.runs ?? [])
    .filter((run): run is RunSummary & { id: string } => isAgentRun(run, includeEnded))
    .map((run) => {
      const kind = kindOf(run)
      const waits = run.state === 'waiting'
      // A waiting run's words are its note of what it will do, not the last thing it said before it stopped.
      const update = run.state === 'running' ? updateOf(activity[run.id]) : waits ? waitNoteOf(run) : undefined
      return {
        id: run.id,
        title: run.title,
        project: run.work?.slug ?? (kind === 'routine' ? 'routine' : folderName(run.cwd)),
        ...stateOf(run, activity),
        ...(update ? { update } : {}),
        tier: TIER_BY_EFFORT[run.effort ?? ''] ?? 'mid',
        hue: hueOf(run.id),
        kind,
        ...(waits ? { waits: { until: run.waitUntil ?? '', ...(update ? { note: update } : {}) } } : {}),
        ...(isIdle(run) ? { idle: { since: run.idleSince ?? '' } } : {}),
        ...(run.onClaudeCode ? { onClaudeCode: true as const } : {}),
      }
    })
}

const NO_CHILDREN: readonly RunChild[] = []

type ChildFreshness = Pick<HostState, 'link' | 'snapshotReady'>
const staleChildren = new WeakMap<readonly RunChild[], readonly RunChild[]>()

/** Cache by source list so Zustand selectors keep stable references between messages. */
function projectChildren(children: readonly RunChild[], snapshot: WireSnapshot, freshness?: ChildFreshness): readonly RunChild[] {
  const snapshotLive = snapshot.connection !== 'offline' && snapshot.connection !== 'connecting'
  const hostReady = !freshness || (freshness.link === 'open' && freshness.snapshotReady)
  if (snapshotLive && hostReady) return children
  let held = staleChildren.get(children)
  if (!held) {
    held = children.map((child) => {
      if (['queued', 'running', 'cancelling'].includes(child.state)) return { ...child, state: 'unknown' as const }
      return child
    })
    staleChildren.set(children, held)
  }
  return held
}

/** Exact owned ancestry and legacy rows, including retained last-known facts. */
export const childrenFrom = (snapshot: WireSnapshot, runId: string, freshness?: ChildFreshness): readonly RunChild[] => projectChildren(snapshot.jobChildren?.[runId] ?? NO_CHILDREN, snapshot, freshness)

export const mainChildrenFrom = (snapshot: WireSnapshot, freshness?: ChildFreshness): readonly RunChild[] => projectChildren(snapshot.mainChildren ?? NO_CHILDREN, snapshot, freshness)

/** What waits on the user: open questions, plus every row hobkin counts as waiting (`decisionCount` in its `src/cli/ui.mjs`). */
export function actionItemCountFrom(snapshot: WireSnapshot): number {
  const rows = Object.values(snapshot.waiting ?? {}).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0)
  return (snapshot.decisions?.length ?? 0) + rows
}

export const mainModelFrom = (snapshot: WireSnapshot): { model: string; effort: string } => ({
  model: snapshot.main?.model ?? '',
  effort: snapshot.main?.effort ?? '',
})

interface WorkProject {
  slug: string
  name?: string
  priority?: SampleProject['priority']
  state?: string
  open?: number
  prs?: number
  branches?: number
  left?: number
}

/** The projects work mode knows, without the ones the user dropped or skipped. Finished work waiting on a yes counts as waiting. */
export function projectsFrom(snapshot: WireSnapshot): SampleProject[] {
  const projects = ((snapshot.work as { projects?: WorkProject[] } | undefined)?.projects ?? []) as WorkProject[]
  return projects
    .filter(({ state }) => state !== 'dropped' && state !== 'skipped')
    .map((project) => ({
      slug: project.slug,
      name: project.name ?? project.slug,
      priority: project.priority ?? 'P2',
      queued: project.open ?? 0,
      waiting: (project.prs ?? 0) + (project.branches ?? 0) + (project.left ?? 0),
    }))
}

export type ConnectionStatus = 'sample' | 'connecting' | 'live' | 'offline'

export interface Connection {
  status: ConnectionStatus
  /** One or two words for the status. The header shows them beside the dot while the window is not live. */
  label: string
  /** A sentence for a tooltip, when there is more to say. */
  detail: string | null
}

/** The Mac window, whose shell starts hobkin's host with it. A browser tab only has a host it finds. */
export const IN_MAC_WINDOW = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * Whether this window has a host, so everything on screen is hobkin's own: always in the Mac window, even before
 * the host first answers, and in a browser tab once one has. Without one the frame draws its sample data. A host
 * that went away is still the window's host, and what it last sent stays on screen.
 */
export const hasHost = (state: Pick<HostState, 'home'>, macWindow = IN_MAC_WINDOW): boolean => macWindow || state.home !== null

export function connectionFrom(state: HostState, macWindow = IN_MAC_WINDOW): Connection {
  if (!hasHost(state, macWindow)) return { status: 'sample', label: 'Sample data', detail: 'No host is running, so this is sample data.' }
  if (state.home === null) return { status: 'connecting', label: 'Connecting…', detail: state.link === 'none' ? 'hobkin is not answering yet. The window keeps trying.' : null }
  if (state.link !== 'open') return { status: 'offline', label: 'Reconnecting…', detail: 'hobkin went away. What it last sent stays on screen until it is back.' }

  const owner = state.owner
  if (owner?.state === 'live') return { status: 'live', label: 'Connected', detail: state.model === 'scripted' ? 'Scripted model. Nothing is spent.' : null }
  if (owner?.state === 'failed') return { status: 'offline', label: 'Offline', detail: owner.message }
  return { status: 'connecting', label: 'Starting', detail: null }
}

/**
 * Two values say the same: every field the same, and a nested object (a durable hobkin's facts) by its own fields. The
 * host's messages rebuild what the window reads from them, so a reader compares what it draws instead of objects.
 */
export function sameFields(left: object | null | undefined, right: object | null | undefined, depth = 1): boolean {
  if (left === right) return true
  if (!left || !right) return false
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => {
    const [a, b] = [(left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]]
    if (a === b) return true
    return depth > 0 && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b) && sameFields(a, b, depth - 1)
  })
}

/** Two lists hold values that say the same, in the same order. */
export function sameLists<Value>(left: readonly Value[], right: readonly Value[], same: (a: Value, b: Value) => boolean = Object.is): boolean {
  return left === right || (left.length === right.length && left.every((value, index) => same(value, right[index]!)))
}

/** The value held while the next one says the same, so a reader of it draws again only when it changed. */
export const keepEqual = <Value>(held: Value | undefined, next: Value, same: (a: Value, b: Value) => boolean): Value =>
  held !== undefined && same(held, next) ? held : next

/** The values of a list, each the one held while it says the same, and the list itself the one held while all do. */
export function keepEachEqual<Value>(held: readonly Value[] | undefined, next: readonly Value[], same: (a: Value, b: Value) => boolean): readonly Value[] {
  if (!held) return next
  const merged = next.map((value, index) => (held[index] !== undefined && same(held[index]!, value) ? held[index]! : value))
  return merged.length === held.length && merged.every((value, index) => value === held[index]) ? held : merged
}

/** Two agents say the same, leaving aside their latest words (`update`), for a reader that never draws them. */
export function sameAgentsQuietly(left: object, right: object): boolean {
  const { update: _left, ...a } = left as { update?: string }
  const { update: _right, ...b } = right as { update?: string }
  return sameFields(a, b)
}
