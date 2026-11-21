import type { ActivityEntry, JobActivity } from '#shared/protocol/activity.ts'
import { GRADES, type Grade } from '#shared/protocol/work.ts'

interface ZoneInput {
  project: { slug: string; priority: string; merged?: number; prs?: number; branches?: number }
  agents: readonly { id: string }[]
}

interface WorldInput {
  zones: readonly ZoneInput[]
  fresh: boolean
  sourceIdentity: string
}

export interface Point {
  x: number
  y: number
}

/** The globe is drawn in a square of this side, seen from above its pole, which is the middle. */
export const GLOBE = 1000

/** A small island off a coast. Its place and coast are in its island's own measure, as `Island.coast` is. */
export interface Islet extends Point {
  coast: Point[]
}

/** One project. Its coast, islets and peak come from its slug alone; where it sits and how large come from the others. */
export interface Island extends Point {
  slug: string
  /** Every part of the island is within this of its centre. */
  radius: number
  /** How far the nearest other island's centre is, which is the room its name has. */
  room: number
  /** The coast around the centre, where 1 is `radius`. */
  coast: Point[]
  islets: Islet[]
  /** How far the land goes up and down from the centre, in the coast's measure. */
  north: number
  south: number
  /** Where the land is highest, in the coast's measure. */
  peak: Point
  /** How high the land has risen: 0 to 3, a step for 1, 5 and 20 merged. */
  tiers: number
  /** 0 to 1: 1 on the island with the most work landed and under way, 0 where there is none. */
  heat: number
  merged: number
  workers: number
  /** The side with more open sea for the name. */
  label: 'above' | 'below'
}

/** Where an agent stands, and how wide it can be drawn without touching the next one. */
export interface AgentPlace extends Point {
  id: string
  slug: string
  observation: string | null
  size: number
}

export interface WorldLayout {
  islands: Island[]
  agents: AgentPlace[]
}

export interface SceneFrame {
  sourceIdentity: string
  fresh: boolean
  layout: WorldLayout
  /** The agents that moved because of something seen: a new assignment or new activity. */
  travel: string[]
  /** The islands where a merge was seen. */
  landed: string[]
}

/** A new entry or tool state is evidence; streamed text/output and inferred dock labels are not. */
export function activityObservation(entries: readonly ActivityEntry[] | undefined): string | null {
  const last = entries?.at(-1)
  return last ? JSON.stringify([last.id, last.kind, last.state ?? null]) : null
}

/** Two activities give the globe the same evidence: the same jobs, each with the same `activityObservation`. */
export function sameObservations(left: JobActivity | undefined, right: JobActivity | undefined): boolean {
  if (left === right) return true
  const jobs = Object.keys(left ?? {})
  if (jobs.length !== Object.keys(right ?? {}).length) return false
  return jobs.every((job) => right?.[job] !== undefined && activityObservation(left?.[job]) === activityObservation(right[job]))
}

const TURN = Math.PI * 2
/** The angle between one seed of a sunflower and the next: any number of them fill a disc evenly. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5))
const POLE = GLOBE / 2

/** Land keeps inside this of the pole, so the rim of the globe is open sea. */
const SHORE = POLE - 26
/** Island centres spread out to this far from the pole, starting on this bearing. */
const SPREAD = POLE * 0.75
const FIRST_BEARING = -2.2
const LARGEST_ISLAND = POLE * 0.34
/** How much of the way to its nearest neighbour two islands may fill between them. The rest is sea, where names go. */
const LAND_SHARE = 0.84
/** An idle island is this much of the size it has when it is the busiest. */
const IDLE_SIZE = 0.84
/** How far beyond the land a name's middle sits. */
const NAME_DROP = 30
/** How many merged changes each step of height takes. */
const RISES = [1, 5, 20]

const COAST_POINTS = 96
/** The waves a coast is the sum of: how many capes each makes, and how far it can push the coast in and out. */
const SWELLS = [[2, 0.24], [3, 0.18], [4, 0.11], [5, 0.08], [7, 0.05], [9, 0.035], [13, 0.026], [19, 0.016]] as const
const MOST_ISLETS = 2
const ISLET_POINTS = 14
/** An islet clears the coast on its own bearing and this far to each side of it. */
const ISLET_SIDES = [-0.3, -0.15, 0, 0.15, 0.3]

/** Agents stand on rings this much of the way to the coast, this many to a ring. */
const STANDING = [0.12, 0.26, 0.4, 0.54, 0.68]
const STANDING_BEARINGS = 36
const LARGEST_AGENT = 54
const SMALLEST_AGENT = 12
/** The room an agent alone on its island is given, in the coast's measure. */
const LONE_AGENT_GAP = 0.6
/** New activity is a step this much of the gap to the nearest agent. */
const STEP = 0.1
/** An agent is as wide as the gap less its own step and its neighbour's, and a hair. */
const AGENT_SHARE = 1 - 2 * STEP - 0.02

function hash(value: string): number {
  let result = 0
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0
  return result
}

/** The same numbers for the same seed (mulberry32), so a slug always draws the same island. */
function seeded(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

const between = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** The point this far out from the middle on a bearing. */
const along = (bearing: number, out: number): Point => ({ x: out * Math.cos(bearing), y: out * Math.sin(bearing) })

/** How far apart the two nearest of these points are. */
function closest(points: readonly Point[]): number {
  const gaps = points.flatMap((point, index) => points.slice(index + 1).map((other) => between(point, other)))
  return Math.min(...gaps)
}

function inside(point: Point, polygon: readonly Point[]): boolean {
  let hit = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    const straddles = a.y > point.y !== b.y > point.y
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

/** A bay or a cove: the bearing it is on, how much of the coast there it takes away, and how wide it is, in radians. */
interface Dent {
  at: number
  depth: number
  width: number
}

/** How much of the coast a dent leaves on a bearing: all of it far from the dent, the least in its middle. */
function leftBy(dent: Dent, bearing: number): number {
  const off = Math.atan2(Math.sin(bearing - dent.at), Math.cos(bearing - dent.at))
  return 1 - dent.depth * Math.exp(-((off / dent.width) ** 2))
}

type Reach = (bearing: number) => number

/** A coast of capes, one bay and one cove. `reach` is how far the coast is from the centre on a bearing, at most 1. */
function drawCoast(random: () => number): { coast: Point[]; reach: Reach; bay: Dent } {
  const swells = SWELLS.map(([capes, push]) => ({
    capes,
    push: push * (0.45 + 0.55 * random()),
    phase: random() * TURN,
  }))
  const bay: Dent = {
    at: random() * TURN,
    depth: 0.2 + 0.28 * random(),
    width: 0.3 + 0.25 * random(),
  }
  const cove: Dent = {
    at: bay.at + 1.3 + 3.6 * random(),
    depth: 0.1 + 0.18 * random(),
    width: 0.14 + 0.14 * random(),
  }

  const unscaled = (bearing: number) => {
    let out = 1
    for (const swell of swells) out += swell.push * Math.cos(swell.capes * bearing + swell.phase)
    return out * leftBy(bay, bearing) * leftBy(cove, bearing)
  }
  const bearings = Array.from({ length: COAST_POINTS }, (_, index) => (index / COAST_POINTS) * TURN)
  const longest = Math.max(...bearings.map(unscaled))
  const reach: Reach = (bearing) => unscaled(bearing) / longest
  const coast = bearings.map((bearing) => along(bearing, reach(bearing)))

  return { coast, reach, bay }
}

function isletCoast(size: number, turned: number): Point[] {
  return Array.from({ length: ISLET_POINTS }, (_, index) => {
    const around = (index / ISLET_POINTS) * TURN
    const out = (size * (1 + 0.25 * Math.cos(2 * around + turned) + 0.15 * Math.cos(3 * around - turned))) / 1.4
    return along(around, out)
  })
}

/** An islet or two where the sea leaves room: off the bay first, then on two other bearings. Each stays within the island's radius. */
function drawIslets(random: () => number, reach: Reach, bayAt: number): Islet[] {
  const islets: Islet[] = []
  const bearings = [bayAt, bayAt + 2.1 + random(), random() * TURN]

  for (const bearing of bearings) {
    const size = 0.07 + 0.06 * random()
    const turned = random() * TURN
    const shore = Math.max(...ISLET_SIDES.map((aside) => reach(bearing + aside)))
    const out = shore + size + 0.06
    const place = along(bearing, out)

    const outgrowsTheIsland = out + size > 1
    const crowdsAnother = islets.some((other) => between(other, place) < 0.35)
    if (islets.length === MOST_ISLETS || outgrowsTheIsland || crowdsAnother) continue

    islets.push({ ...place, coast: isletCoast(size, turned) })
  }
  return islets
}

/**
 * Where agents stand on an island, in the order they take their places: the first near the middle, and each one after
 * as far from the others as the land allows, so nobody moves when another arrives.
 */
function standingOrder(reach: Reach, facing: number): (count: number) => readonly Point[] {
  const ground = STANDING.flatMap((share, ring) =>
    Array.from({ length: STANDING_BEARINGS }, (_, index) => {
      const bearing = facing + ((index + ring / 2) / STANDING_BEARINGS) * TURN
      return along(bearing, share * reach(bearing))
    }),
  )
  const taken: Point[] = []
  const clearOfTheOthers = (point: Point) => Math.min(...taken.map((other) => between(other, point)))

  return (count) => {
    while (taken.length < Math.min(count, ground.length)) {
      const next = taken.length === 0 ? ground[0]! : ground.reduce((best, point) => (clearOfTheOthers(point) > clearOfTheOthers(best) ? point : best))
      taken.push(next)
    }
    return taken
  }
}

interface Shape extends Pick<Island, 'coast' | 'islets' | 'north' | 'south' | 'peak'> {
  /** Where this many agents stand, around the centre, in the coast's measure. */
  stand: (count: number) => readonly Point[]
}

const shapes = new Map<string, Shape>()

/** The island a slug draws. Nothing here depends on the other islands, so it is drawn once. */
function shapeOf(slug: string): Shape {
  const known = shapes.get(slug)
  if (known) return known

  const random = seeded(hash(slug))
  const { coast, reach, bay } = drawCoast(random)
  const islets = drawIslets(random, reach, bay.at)
  const stand = standingOrder(reach, random() * TURN)

  const isletShores = islets.flatMap((islet) => islet.coast.map((point) => islet.y + point.y))
  const shores = [...coast.map((point) => point.y), ...isletShores]
  // The land is highest away from the bay.
  const peak = along(bay.at, -0.1)

  const shape: Shape = { coast, islets, north: Math.min(...shores), south: Math.max(...shores), peak, stand }
  shapes.set(slug, shape)
  return shape
}

/** A project's place on the globe, before its island is sized against the others. */
interface Site extends Point {
  slug: string
  merged: number
  /** The agents that stand here: each exact id once, on the first island in order that has it. */
  agentIds: string[]
  fromPole: number
  /** Work landed and under way: what merged, what waits as a PR or a branch, and twice each agent at work. */
  work: number
}

function byPriorityThenSlug(a: ZoneInput, b: ZoneInput): number {
  const byPriority = GRADES.indexOf(a.project.priority as Grade) - GRADES.indexOf(b.project.priority as Grade)
  return byPriority || a.project.slug.localeCompare(b.project.slug, 'en')
}

/**
 * Projects sit as a sunflower's seeds do, highest priority nearest the pole, so any number of them fills the globe and
 * one added after the others moves none of them off its bearing.
 */
function sitesOf(zones: readonly ZoneInput[]): Site[] {
  const placed = new Set<string>()
  const ordered = [...zones].sort(byPriorityThenSlug)

  return ordered.map((zone, index) => {
    const fromPole = ordered.length === 1 ? 0 : SPREAD * Math.sqrt((index + 0.5) / ordered.length)
    const bearing = FIRST_BEARING + index * GOLDEN

    const agentIds = [...new Set(zone.agents.map((agent) => agent.id))].sort().filter((id) => !placed.has(id))
    for (const id of agentIds) placed.add(id)

    const { slug, merged = 0, prs = 0, branches = 0 } = zone.project
    return {
      slug,
      merged,
      agentIds,
      fromPole,
      x: POLE + fromPole * Math.cos(bearing),
      y: POLE + fromPole * Math.sin(bearing),
      work: merged + prs + branches + 2 * agentIds.length,
    }
  })
}

type UnnamedIsland = Omit<Island, 'label'>

/** An island as large as the sea to its neighbours and to the rim allows, and larger the more work is landed and under way on it. */
function islandOf(site: Site, sites: readonly Site[], mostWork: number): UnnamedIsland {
  const others = sites.filter((other) => other !== site)
  const room = Math.min(GLOBE, ...others.map((other) => between(site, other)))
  const heat = mostWork ? Math.sqrt(site.work / mostWork) : 0
  const largest = Math.min(LARGEST_ISLAND, SHORE - site.fromPole, (LAND_SHARE * room) / 2)
  const { coast, islets, north, south, peak } = shapeOf(site.slug)

  return {
    slug: site.slug,
    x: site.x,
    y: site.y,
    radius: largest * (IDLE_SIZE + (1 - IDLE_SIZE) * heat),
    room,
    coast,
    islets,
    north,
    south,
    peak,
    tiers: RISES.filter((rise) => site.merged >= rise).length,
    heat,
    merged: site.merged,
    workers: site.agentIds.length,
  }
}

/** The side of an island where its name is further from the rim and from every other island. */
function nameSide(island: UnnamedIsland, islands: readonly UnnamedIsland[]): Island['label'] {
  const others = islands.filter((other) => other !== island)
  const openSeaAt = (y: number) => {
    const toRim = POLE - Math.hypot(island.x - POLE, y - POLE)
    const toOthers = others.map((other) => Math.hypot(other.x - island.x, other.y - y) - other.radius)
    return Math.min(toRim, ...toOthers)
  }

  const below = island.y + island.south * island.radius + NAME_DROP
  const above = island.y + island.north * island.radius - NAME_DROP
  return openSeaAt(below) >= openSeaAt(above) ? 'below' : 'above'
}

/** New activity is a step to one side. It is short enough never to reach the next agent, and it never leaves the land. */
function stepFrom(spot: Point, length: number, direction: number, coast: readonly Point[]): Point {
  const stepped = { x: spot.x + length * Math.cos(direction), y: spot.y + length * Math.sin(direction) }
  return inside(stepped, coast) ? stepped : spot
}

function agentPlacesOn(island: Island, agentIds: readonly string[], observationOf: (id: string) => string | null): AgentPlace[] {
  const spots = shapeOf(island.slug).stand(agentIds.length)
  const gap = agentIds.length > 1 ? closest(spots.slice(0, agentIds.length)) : LONE_AGENT_GAP
  const size = Math.max(SMALLEST_AGENT, Math.min(LARGEST_AGENT, gap * island.radius * AGENT_SHARE))

  return agentIds.map((id, order) => {
    const observation = observationOf(id)
    const spot = spots[order % spots.length]!
    const stood = observation ? stepFrom(spot, gap * STEP, hash(observation), island.coast) : spot

    return {
      id,
      slug: island.slug,
      observation,
      size,
      x: island.x + stood.x * island.radius,
      y: island.y + stood.y * island.radius,
    }
  })
}

/** The globe for these projects. An agent with no activity seen now keeps the last that was (`observations`). */
export function worldLayout(zones: readonly ZoneInput[], activity: JobActivity = {}, observations: ReadonlyMap<string, string | null> = new Map()): WorldLayout {
  const sites = sitesOf(zones)
  const mostWork = Math.max(0, ...sites.map((site) => site.work))
  const unnamed = sites.map((site) => islandOf(site, sites, mostWork))
  const islands = unnamed.map((island) => ({ ...island, label: nameSide(island, unnamed) }))

  const observationOf = (id: string) => activityObservation(activity[id]) ?? observations.get(id) ?? null
  const agents = sites.flatMap((site, index) => agentPlacesOn(islands[index]!, site.agentIds, observationOf))

  return { islands, agents }
}

/** Offline freezes the globe; a different source never inherits it. Arrivals and reconnects snap, and tell of no merge. */
export function sceneFrame(previous: SceneFrame | null, world: WorldInput, activity: JobActivity, still: boolean): SceneFrame {
  const sameSource = previous?.sourceIdentity === world.sourceIdentity
  const agentsBefore = new Map(sameSource ? previous.layout.agents.map((agent) => [agent.id, agent]) : [])
  const mergedBefore = new Map(sameSource ? previous.layout.islands.map((island) => [island.slug, island.merged]) : [])
  const observations = new Map([...agentsBefore].map(([id, agent]) => [id, agent.observation]))

  const layout = !world.fresh && sameSource ? previous.layout : worldLayout(world.zones, activity, observations)
  const watching = !still && sameSource && previous.fresh && world.fresh

  const hasMoved = (agent: AgentPlace) => {
    const before = agentsBefore.get(agent.id)
    if (!before) return false

    const reassigned = before.slug !== agent.slug
    const newActivity = agent.observation !== null && before.observation !== agent.observation
    return reassigned || newActivity
  }
  const hasLanded = (island: Island) => island.merged > (mergedBefore.get(island.slug) ?? Infinity)

  return {
    sourceIdentity: world.sourceIdentity,
    fresh: world.fresh,
    layout,
    travel: watching ? layout.agents.filter(hasMoved).map((agent) => agent.id) : [],
    landed: watching ? layout.islands.filter(hasLanded).map((island) => island.slug) : [],
  }
}
