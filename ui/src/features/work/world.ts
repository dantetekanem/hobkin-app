import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { GRADES, type WorkProject, type WorkState } from '#shared/protocol/work.ts'

interface AgentIdentity { id: string; doing: string }
interface WorldInput<A extends AgentIdentity> {
  work: WorkState
  runs: readonly RunSummary[]
  agents: readonly A[]
  connection: 'live' | 'offline' | 'connecting' | 'sample'
  sourceIdentity: string
}

/** Exact assignments and independent host facts, never a guessed project lifecycle. */
export function worldFrom<A extends AgentIdentity>({ work, runs, agents, connection, sourceIdentity }: WorldInput<A>) {
  const known = new Map<string, WorkProject>()
  for (const project of work.projects) if (project.state === 'chosen' && project.slug && !known.has(project.slug)) known.set(project.slug, project)
  const presentations = new Map(agents.map(agent => [agent.id, agent]))
  const assigned = runs.filter((run): run is RunSummary & { id: string } => Boolean(run.id) && run.kind !== 'main' && run.state === 'running' && known.has(run.work?.slug ?? ''))
  const zones = [...known.values()]
    .sort((a, b) => GRADES.indexOf(a.priority) - GRADES.indexOf(b.priority))
    .map(project => ({
      project,
      agents: assigned.filter(run => run.work?.slug === project.slug).map(run => ({ id: run.id, title: run.title, doing: presentations.get(run.id)?.doing ?? 'Activity unknown', presentation: presentations.get(run.id) })),
      queue: work.queue.filter(row => row.slug === project.slug),
      finished: work.finished.flatMap(group => group.changes).filter(change => change.slug === project.slug),
      facts: [project.state, ...(project.paused ? ['paused'] : []), `${project.open} open items`, `${project.prs} PRs`, `${project.branches} branches`, `${project.left} waiting for you`, `${project.unmerged} unmerged`, ...(project.lookError ? [`Last look failed: ${project.lookError}`] : []), 'Assessment unknown'],
    }))
  return { sourceIdentity, fresh: connection === 'live', connection, visible: known.size >= 3, zones }
}

export type WorkWorld = ReturnType<typeof worldFrom>

/** No initial/reconnect pulse or terminal celebration; only a new observed run, assignment or activity. */
export function changedWorldAgents(previous: WorkWorld | null, next: WorkWorld, still: boolean): string[] {
  if (still || !previous?.fresh || !next.fresh || previous.sourceIdentity !== next.sourceIdentity) return []
  const old = new Map(previous.zones.flatMap(zone => zone.agents.map(agent => [agent.id, { slug: zone.project.slug, doing: agent.doing }] as const)))
  return next.zones.flatMap(zone => zone.agents.filter(agent => {
    const before = old.get(agent.id)
    return !before || before.slug !== zone.project.slug || before.doing !== agent.doing
  }).map(agent => agent.id))
}

export function visitWorldAgent(world: WorkWorld, id: string, navigation: { open: (id: string) => void; focus: () => void }): boolean {
  if (!world.zones.some(zone => zone.agents.some(agent => agent.id === id))) return false
  navigation.open(id)
  navigation.focus()
  return true
}

export function visitWorldProject(world: WorkWorld, slug: string, visit: (slug: string, discover: boolean) => void): boolean {
  const zone = world.zones.find(zone => zone.project.slug === slug)
  if (!zone) return false
  visit(slug, zone.project.state !== 'chosen')
  return true
}
