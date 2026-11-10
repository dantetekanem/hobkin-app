import type { RunSummary, WireSnapshot } from '#shared/protocol/snapshot.ts'
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
  if (!last) return { doing: 'starting', mood: 'thinking' }
  if (last.kind === 'tool' && last.state === 'running') {
    return { doing: `running ${last.name ?? 'a tool'}`, mood: SEARCH_TOOL.test(last.name ?? '') ? 'searching' : 'working' }
  }
  return last.kind === 'tool' ? { doing: 'thinking', mood: 'thinking' } : { doing: 'writing', mood: 'thinking' }
}

function kindOf(run: RunSummary): SampleAgent['kind'] {
  if (run.work) return 'work'
  return run.scheduleId ? 'routine' : 'session'
}

/** Every agent or routine running now. hobkin's own turn is not one of them: the conversation shows that. */
export function agentsFrom(snapshot: WireSnapshot): SampleAgent[] {
  const activity = (snapshot.jobActivity ?? {}) as Record<string, ActivityEntry[]>
  return (snapshot.runs ?? [])
    .filter((run): run is RunSummary & { id: string } => run.state === 'running' && run.kind !== 'main' && typeof run.id === 'string')
    .map((run) => {
      const kind = kindOf(run)
      return {
        id: run.id,
        title: run.title,
        project: run.work?.slug ?? (kind === 'routine' ? 'routine' : folderName(run.cwd)),
        ...doingOf(activity[run.id]),
        tier: TIER_BY_EFFORT[run.effort ?? ''] ?? 'mid',
        hue: hueOf(run.id),
        kind,
      }
    })
}

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

export type ConnectionStatus = 'sample' | 'connecting' | 'live' | 'read-only' | 'offline'

export interface Connection {
  status: ConnectionStatus
  /** One or two words for the status. */
  label: string
  /** A sentence for a tooltip, when there is more to say. */
  detail: string | null
}

/** Whether a host has ever answered. Before that the frame draws its sample data. */
export const hasHost = (state: Pick<HostState, 'home'>): boolean => state.home !== null

export function connectionFrom(state: HostState): Connection {
  if (!hasHost(state)) return { status: 'sample', label: 'Sample data', detail: 'No host is running, so this is sample data.' }
  if (state.link !== 'open') return { status: 'offline', label: 'Offline', detail: 'The host went away. Reconnecting.' }

  const owner = state.owner
  if (owner?.state === 'live') return { status: 'live', label: 'Connected', detail: state.model === 'scripted' ? 'Scripted model. Nothing is spent.' : null }
  if (owner?.state === 'read-only') return { status: 'read-only', label: 'Read-only', detail: 'hobkin is open in the terminal. This is the last view it saved.' }
  if (owner?.state === 'failed') return { status: 'offline', label: 'Offline', detail: owner.message }
  return { status: 'connecting', label: 'Starting', detail: null }
}
