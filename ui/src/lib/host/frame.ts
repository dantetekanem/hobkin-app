import { isHobkinTurn } from '#shared/protocol/hobkins.ts'
import type { RunChild, RunSummary, WireSnapshot } from '#shared/protocol/snapshot.ts'
import type { SampleAgent, SampleProject, Tier } from '../../app/sample.ts'
import type { HostState } from './state.ts'

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
    const entry = activity[index]!
    if (entry.kind === 'assistant' && entry.text && entry.text.trim()) {
      return entry.text.replace(/\s+/g, ' ').trim()
    }
  }
  return undefined
}

function kindOf(run: RunSummary): SampleAgent['kind'] {
  if (run.work) return 'work'
  // `hobkin session` outside Herdr runs as a job on a schedule id of its own (`session-jobs.mjs` in hobkin).
  return run.scheduleId && !run.scheduleId.startsWith('session.') ? 'routine' : 'session'
}

/**
 * Agents for the dock, or also ended runs for a reopened canvas. The main conversation is never an agent, and nor is a
 * durable hobkin's turn: the hobkin itself stands for its turns (`features/hobkins/list.ts`).
 */
export function agentsFrom(snapshot: WireSnapshot, { includeEnded = false }: { includeEnded?: boolean } = {}): SampleAgent[] {
  const activity = (snapshot.jobActivity ?? {}) as Record<string, ActivityEntry[]>
  return (snapshot.runs ?? [])
    .filter((run): run is RunSummary & { id: string } => (includeEnded || run.state === 'running') && run.kind !== 'main' && typeof run.id === 'string' && !isHobkinTurn(run))
    .map((run) => {
      const kind = kindOf(run)
      const update = run.state === 'running' ? updateOf(activity[run.id]) : undefined
      return {
        id: run.id,
        title: run.title,
        project: run.work?.slug ?? (kind === 'routine' ? 'routine' : folderName(run.cwd)),
        ...(run.state === 'running' ? doingOf(activity[run.id]) : { doing: run.state, mood: 'idle' as const }),
        ...(update ? { update } : {}),
        tier: TIER_BY_EFFORT[run.effort ?? ''] ?? 'mid',
        hue: hueOf(run.id),
        kind,
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
