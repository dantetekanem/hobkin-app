import type { LudicrousArea } from '#shared/protocol/ludicrous.ts'
import { worldLayout, type Island } from './world-layout.ts'

/**
 * The Ludicrous map (_specs/076-ludicrous-mode): the plan's areas as islands on hobkin's globe, drawn by the World page's own layout. Each
 * area is laid out from the plan's dependencies, the foundation at the pole and each area further out the more areas it builds on. An island
 * grows with its agents and rises with its steps done. It says how many agents are on it, whether its leader is, and its steps done of
 * total, and nothing about what any agent is doing.
 */

const GRADES = ['P0', 'P1', 'P2', 'P3'] as const

/** How many areas an area builds on, the longest way back to the foundation. */
export function depthsOf(areas: readonly LudicrousArea[]): Map<string, number> {
  const depths = new Map<string, number>()
  const byId = new Map(areas.map((area) => [area.id, area]))
  const depthOf = (id: string, seen: readonly string[] = []): number => {
    const known = depths.get(id)
    if (known !== undefined) return known
    const area = byId.get(id)
    const deps = (area?.depends ?? []).filter((each) => byId.has(each) && !seen.includes(each))
    const depth = deps.length ? 1 + Math.max(...deps.map((each) => depthOf(each, [...seen, id]))) : 0
    depths.set(id, depth)
    return depth
  }
  areas.forEach((area) => depthOf(area.id))
  return depths
}

/** The areas as the World layout's zones: depth as priority, so the foundation sits nearest the pole; steps done as what merged. */
export function zonesOf(areas: readonly LudicrousArea[]) {
  const depths = depthsOf(areas)
  return areas.map((area) => ({
    project: { slug: area.id, priority: GRADES[Math.min(depths.get(area.id) ?? 0, GRADES.length - 1)]!, merged: area.steps.done },
    agents: Array.from({ length: area.agents }, (_, n) => ({ id: `${area.id}:${n}` })),
  }))
}

export interface MapIsland {
  island: Island
  area: LudicrousArea
}

/** Each area with its island. */
export function mapOf(areas: readonly LudicrousArea[]): MapIsland[] {
  const { islands } = worldLayout(zonesOf(areas))
  const byId = new Map(areas.map((area) => [area.id, area]))
  return islands.flatMap((island) => {
    const area = byId.get(island.slug)
    return area ? [{ island, area }] : []
  })
}

const plural = (amount: number, one: string, many = `${one}s`) => `${amount} ${amount === 1 ? one : many}`

/** What an island says under its name: its agents now, its leader, and its steps done of total. */
export function areaLine(area: LudicrousArea): string {
  if (area.done) return `done · ${area.steps.done} of ${area.steps.total} steps`
  if (!area.open) return `waits for ${area.depends.join(', ')}`
  const leader = area.leader ? 'leader on it' : 'no leader now'
  return `${plural(area.agents, 'agent')} · ${leader} · ${area.steps.done} of ${area.steps.total} steps`
}

/** The map's heading line: areas, how many are done, and the agents on them. */
export function mapTotals(areas: readonly LudicrousArea[]): string {
  const done = areas.filter((area) => area.done).length
  const agents = areas.reduce((sum, area) => sum + area.agents, 0)
  return `${plural(areas.length, 'area')} · ${done} done · ${plural(agents, 'agent')} on them`
}
