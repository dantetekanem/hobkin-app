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
const TIER_BY_EFFORT: Record<string, Tier> = { off: 'fast', minimal: 'fast', low: 'fast', medium: 'mid', high: 'high', xhigh: 'max', max: 'max' }

interface ActivityEntry {
  kind?: string
  name?: string
  state?: string
}

/** A color that stays with the agent for as long as it runs. */
function hueOf(id: string): number {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 360
  return hash
}

const folderName = (path: string | undefined) => path?.split('/').filter(Boolean).at(-1) ?? 'session'

function doingOf(activity: ActivityEntry[] | undefined): Pick<SampleAgent, 'doing' | 'mood'> {
  const last = activity?.at(-1)
  if (!last) return { doing: activity ? 'thinking' : 'starting', mood: 'thinking' }
  if (last.kind === 'tool' && last.state === 'running') {
    return { doing: `running ${last.name ?? 'a tool'}`, mood: SEARCH_TOOL.test(last.name ?? '') ? 'searching' : 'working' }
  }
  return last.kind === 'tool' ? { doing: 'thinking', mood: 'thinking' } : { doing: 'writing', mood: 'thinking' }
}

function kindOf(run: RunSummary): SampleAgent['kind'] {
  if (run.work) return 'work'
  // `hobkin session` outside Herdr runs as a job on a schedule id of its own (`session-jobs.mjs` in hobkin).
  return run.scheduleId && !run.scheduleId.startsWith('session.') ? 'routine' : 'session'
}

/** Agents for the dock, or also ended runs for a reopened canvas. The main conversation is never an agent. */
export function agentsFrom(snapshot: WireSnapshot, { includeEnded = false }: { includeEnded?: boolean } = {}): SampleAgent[] {
  const activity = (snapshot.jobActivity ?? {}) as Record<string, ActivityEntry[]>
  return (snapshot.runs ?? [])
    .filter((run): run is RunSummary & { id: string } => (includeEnded || run.state === 'running') && run.kind !== 'main' && typeof run.id === 'string')
    .map((run) => {
      const kind = kindOf(run)
      return {
        id: run.id,
        title: run.title,
        project: run.work?.slug ?? (kind === 'routine' ? 'routine' : folderName(run.cwd)),
        ...(run.state === 'running' ? doingOf(activity[run.id]) : { doing: run.state, mood: 'idle' as const }),
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
