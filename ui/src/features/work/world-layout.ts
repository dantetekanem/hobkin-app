import type { ActivityEntry, JobActivity } from '#shared/protocol/activity.ts'
import { GRADES } from '#shared/protocol/work.ts'

interface ZoneInput { project: { slug: string; priority: string }; agents: readonly { id: string }[] }
interface WorldInput { zones: readonly ZoneInput[]; fresh: boolean; sourceIdentity: string }
interface Point { x: number; y: number }
export interface Territory { slug: string; label: Point; points: Point[]; top: Point[]; bottom: Point[] }
export interface AgentPlace extends Point { id: string; slug: string; observation: string | null }
export interface WorldLayout { width: number; height: number; territories: Territory[]; agents: AgentPlace[] }
export interface SceneFrame { sourceIdentity: string; fresh: boolean; layout: WorldLayout; travel: string[] }

/** A new entry or tool state is evidence; streamed text/output and inferred dock labels are not. */
export function activityObservation(entries: readonly ActivityEntry[] | undefined): string | null {
  const last = entries?.at(-1)
  return last ? JSON.stringify([last.id, last.kind, last.state ?? null]) : null
}

function hash(value: string): number {
  let result = 0
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0
  return result
}

/** Shared ridgelines make adjoining districts one ground, with a safe interior for full-size hit targets. */
export function worldLayout(zones: readonly ZoneInput[], activity: JobActivity = {}, observations: ReadonlyMap<string, string | null> = new Map()): WorldLayout {
  const territories: Territory[] = [], agents: AgentPlace[] = []
  const seen = new Set<string>()
  const edge = (y: number, index: number): Point[] => [
    { x: 24, y }, { x: 185, y: y - 10 - index % 2 * 8 },
    { x: 430, y: y + 12 }, { x: 696, y: y - 4 },
  ]
  let y = 40
  const ordered = [...zones].sort((a, b) => GRADES.indexOf(a.project.priority as typeof GRADES[number]) - GRADES.indexOf(b.project.priority as typeof GRADES[number]) || a.project.slug.localeCompare(b.project.slug, 'en'))
  ordered.forEach((zone, index) => {
    const ids = [...new Set(zone.agents.map(agent => agent.id))].sort().filter(id => !seen.has(id))
    const height = 150 + Math.max(1, Math.ceil(ids.length / 3)) * 110
    const top = edge(y, index), bottom = edge(y + height, index + 1)
    territories.push({ slug: zone.project.slug, label: { x: 76, y: y + 30 }, top, bottom, points: [...top, ...[...bottom].reverse()] })
    ids.forEach((id, slot) => {
      seen.add(id)
      const observation = activityObservation(activity[id]) ?? observations.get(id) ?? null
      const drift = observation ? hash(observation) % 17 - 8 : 0
      agents.push({ id, slug: zone.project.slug, observation, x: 80 + slot % 3 * 190 + drift, y: y + 120 + Math.floor(slot / 3) * 110 + drift })
    })
    y += height
  })
  return { width: 720, height: Math.max(280, y + 40), territories, agents }
}

/** Offline freezes geometry; a different source never inherits it. Arrivals/reconnects snap. */
export function sceneFrame(previous: SceneFrame | null, world: WorldInput, activity: JobActivity, still: boolean): SceneFrame {
  const sameSource = previous?.sourceIdentity === world.sourceIdentity
  const old = new Map(sameSource ? previous.layout.agents.map(agent => [agent.id, agent]) : [])
  const observations = new Map([...old].map(([id, agent]) => [id, agent.observation]))
  const layout = !world.fresh && sameSource ? previous.layout : worldLayout(world.zones, activity, observations)
  const travel = !still && sameSource && previous.fresh && world.fresh
    ? layout.agents.filter(agent => {
      const before = old.get(agent.id)
      return before && (before.slug !== agent.slug || (agent.observation !== null && before.observation !== agent.observation))
    }).map(agent => agent.id) : []
  return { sourceIdentity: world.sourceIdentity, fresh: world.fresh, layout, travel }
}
