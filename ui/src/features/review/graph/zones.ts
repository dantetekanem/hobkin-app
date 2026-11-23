/**
 * The zones of a review as the graph draws them (spec 055, the user, 2026-11-23: "so I can see the zone of the change.
 * think 'controllers', 'models' but more granular than that, in a subject"). A zone is a layer and a subject, such as
 * "Controllers · Admin orders". The review's own zones come first, as the host named and ordered them; a review from an
 * older host has none, and they are named from its paths by the same rule the host uses (`#shared/review/zones.ts`).
 *
 * Past twelve zones, the small ones merge into their layer ("Controllers", with how many subjects), so the graph never
 * draws dozens of slivers. A card stands in the zone of the first node it holds. Each zone knows its drawn nodes, the
 * review's nodes in it, what changed, what needs the reviewer, its tests, and its standing. Pure, and the same review
 * always gives the same zones.
 */
import { zoneRects, type Rect } from '#shared/review/layout.ts'
import type { NodeKind, Review, ReviewNode, ReviewZone } from '#shared/review/types.ts'
import { withZones } from '#shared/review/zones.ts'

/** The most zones the graph draws: past it, the small ones merge into their layer. */
export const MAX_ZONES = 12

export interface ZoneCounts {
  /** The parts in it the change touched. */
  changed: number
  /** The parts in it that need the reviewer. */
  needsYou: number
  /** The tests in it, or for a zone of code, the tests that cover its code. */
  tests: number
}

/** The most a zone asks of the reviewer: what its parts ask, `context` when the change touched none of them. */
export type ZoneStanding = 'needs-you' | 'worth-a-look' | 'unrated' | 'safe' | 'context'

export interface GraphZone {
  id: string
  label: string
  layer: string
  subject: string
  component?: string
  /** A zone of tests: it sits under the code it mirrors. */
  tests: boolean
  /** How many subjects it holds: more than one when the small zones of its layer merged into it. */
  subjects: number
  /** Its drawn nodes, by the arranged graph's ids, in the review's order. */
  members: string[]
  /** The review's nodes in it, those folded into a card too. */
  nodes: string[]
  counts: ZoneCounts
  standing: ZoneStanding
}

export interface Zoned {
  zones: GraphZone[]
  /** Each drawn node and each node of the review, by its id, to the id of its zone. */
  zoneOf: Record<string, string>
}

/** A drawn node, and the nodes of the review it stands for: itself, or a card's tests and helpers. */
export interface DrawnNode {
  id: string
  of: readonly string[]
}

const OTHER: ReviewZone = { id: '-/other/other', layer: 'other', subject: 'other', label: 'Other parts' }
/** Where acceptance lines with no path stand: a spec's zone of its own. */
const LINES: ReviewZone = { id: '-/_specs/acceptance', layer: '_specs', subject: 'acceptance', label: 'Acceptance lines' }
const isTestLayer = (layer: string) => layer.startsWith('test:')

/** Each node of the review to its zone, and the zones in order: the host's first, then those named from paths. */
function baseZones(review: Pick<Review, 'nodes' | 'edges' | 'zones'>): { zones: ReviewZone[]; zoneOf: Map<string, string> } {
  const given = new Map((review.zones ?? []).map((zone) => [zone.id, zone]))
  const zoneOf = new Map<string, string>()
  const missing = review.nodes.filter((node) => !(node.zone != null && given.has(node.zone)))
  for (const node of review.nodes) if (node.zone != null && given.has(node.zone)) zoneOf.set(node.id, node.zone)
  const zones = [...given.values()]
  if (missing.length > 0) {
    const named = withZones(review.nodes, review.edges)
    const namedOf = new Map(named.nodes.map((node) => [node.id, node.zone]))
    const wanted = new Set(missing.map((node) => namedOf.get(node.id)).filter((id): id is string => id != null))
    for (const zone of named.zones) if (wanted.has(zone.id) && !given.has(zone.id)) zones.push(zone)
    const unnamed = (node: ReviewNode) => (node.kind === 'criterion' ? LINES : OTHER)
    for (const node of missing) zoneOf.set(node.id, namedOf.get(node.id) ?? unnamed(node).id)
    for (const zone of [LINES, OTHER]) if (missing.some((node) => namedOf.get(node.id) == null && unnamed(node) === zone)) zones.push(zone)
  }
  return { zones, zoneOf }
}

interface Building {
  zone: ReviewZone
  subjects: number
  members: string[]
  /** It holds where a request enters, an acceptance line or a part that needs the reviewer: the last to join "Other parts". */
  kept?: boolean
}

/** The words of a layer whose small zones merged: "Controllers", or for tests "Tests · request". */
function layerLabel(zone: ReviewZone): string {
  const head = zone.label.split(' · ')[0]!
  return isTestLayer(zone.layer) ? `${head} · ${zone.layer.slice('test:'.length).replace(/[_-]+/g, ' ')}` : head
}

/**
 * Past the most zones, a layer's zones merge into one, the smallest layer first (by how many drawn nodes its zones hold,
 * the later on a tie), until few enough are left. When no layer has two zones, the smallest zones join "Other parts",
 * those that hold where a request enters, an acceptance line or a part that needs the reviewer last.
 */
function merged(zones: readonly Building[]): Building[] {
  let list = [...zones]
  const layerKey = (entry: Building) => `${entry.zone.component ?? '-'}/${entry.zone.layer}`
  while (list.length > MAX_ZONES) {
    const layers = new Map<string, Building[]>()
    for (const entry of list) layers.set(layerKey(entry), [...(layers.get(layerKey(entry)) ?? []), entry])
    const size = (entries: readonly Building[]) => entries.reduce((sum, entry) => sum + entry.members.length, 0)
    const firstAt = (entries: readonly Building[]) => list.indexOf(entries[0]!)
    const [smallest] = [...layers.values()].filter((entries) => entries.length > 1).sort((a, b) => size(a) - size(b) || firstAt(b) - firstAt(a))
    if (smallest) {
      const [first] = smallest
      const zone: ReviewZone = { id: `${layerKey(first!)}/*`, layer: first!.zone.layer, subject: '*', label: layerLabel(first!.zone), ...(first!.zone.component ? { component: first!.zone.component } : {}) }
      const into: Building = { zone, subjects: smallest.reduce((sum, entry) => sum + entry.subjects, 0), members: smallest.flatMap((entry) => entry.members), kept: smallest.some((entry) => entry.kept) }
      list = list.flatMap((entry) => (entry === first ? [into] : smallest.includes(entry) ? [] : [entry]))
      continue
    }
    // No layer has two zones left: the smallest join "Other parts", at the end, one zone however many join it.
    const before = list.find((entry) => entry.zone.id === OTHER.id)
    const order = [...list].filter((entry) => entry !== before).sort((a, b) => Number(a.kept ?? false) - Number(b.kept ?? false) || a.members.length - b.members.length || list.indexOf(b) - list.indexOf(a))
    const joining = [...(before ? [before] : []), ...order.slice(0, list.length - MAX_ZONES + (before ? 0 : 1))]
    const other: Building = { zone: OTHER, subjects: joining.reduce((sum, entry) => sum + entry.subjects, 0), members: joining.flatMap((entry) => entry.members), kept: joining.some((entry) => entry.kept) }
    list = [...list.filter((entry) => !joining.includes(entry)), other]
  }
  return list
}

/** What a zone's parts ask of the reviewer, and what it holds. */
function countsOf(zone: string, nodes: readonly ReviewNode[], zoneOf: Readonly<Record<string, string>>, covers: Readonly<Record<string, string>>, tests: boolean) {
  const inside = nodes.filter((node) => zoneOf[node.id] === zone)
  const isTest = (node: ReviewNode) => node.kind === 'test' && !(node.supports?.length)
  const changed = inside.filter((node) => node.kind !== 'criterion' && node.change !== 'unchanged')
  const covering = tests ? inside.filter(isTest) : nodes.filter((node) => isTest(node) && covers[node.id] != null && zoneOf[covers[node.id]!] === zone)
  const counts: ZoneCounts = {
    changed: changed.length,
    needsYou: inside.filter((node) => node.attention?.tier === 'needs-you').length,
    tests: covering.length,
  }
  let standing: ZoneStanding = 'context'
  if (counts.needsYou > 0) standing = 'needs-you'
  else if (inside.some((node) => node.attention?.tier === 'worth-a-look')) standing = 'worth-a-look'
  else if (changed.some((node) => node.attention == null)) standing = 'unrated'
  else if (changed.length > 0) standing = 'safe'
  return { counts, standing }
}

/**
 * The zones of a review as the graph draws them. `drawn` is what the graph draws, each with the review's nodes it stands
 * for; `covers` is what each test covers (`Arranged.covers`), for the tests a zone of code counts.
 */
export function zonesOf(review: Pick<Review, 'nodes' | 'edges' | 'zones'>, drawn: readonly DrawnNode[], covers: Readonly<Record<string, string>> = {}): Zoned {
  const base = baseZones(review)
  const zoneOfDrawn = new Map(drawn.map((node) => [node.id, base.zoneOf.get(node.of[0] ?? node.id) ?? base.zoneOf.get(node.id) ?? OTHER.id]))
  const building = new Map<string, Building>()
  const known = new Map([...base.zones, OTHER].map((zone) => [zone.id, zone]))
  for (const zone of [...base.zones, OTHER]) building.set(zone.id, { zone, subjects: 1, members: [] })
  const nodeOf = new Map(review.nodes.map((node) => [node.id, node]))
  for (const node of drawn) {
    const entry = building.get(zoneOfDrawn.get(node.id)!)
    if (!entry) continue
    entry.members.push(node.id)
    if (node.of.some((id) => nodeOf.get(id)?.entry != null || nodeOf.get(id)?.kind === 'criterion' || nodeOf.get(id)?.attention?.tier === 'needs-you')) entry.kept = true
  }
  const present = [...building.values()].filter((entry) => entry.members.length > 0 && known.has(entry.zone.id))

  const zoneOf: Record<string, string> = {}
  const zones = merged(present).map((entry) => {
    for (const id of entry.members) zoneOf[id] = entry.zone.id
    return entry
  })
  // A node of the review is in the zone of the card that holds it, or else its own.
  for (const node of drawn) for (const id of node.of) zoneOf[id] ??= zoneOf[node.id]!
  const byOld = new Map(present.flatMap((entry) => entry.members.map((id) => [zoneOfDrawn.get(id)!, zoneOf[id]!] as const)))
  for (const node of review.nodes) zoneOf[node.id] ??= byOld.get(base.zoneOf.get(node.id) ?? OTHER.id) ?? zones[0]?.zone.id ?? OTHER.id

  return {
    zones: zones.map(({ zone, subjects, members }) => {
      const tests = isTestLayer(zone.layer)
      return {
        id: zone.id,
        label: zone.label,
        layer: zone.layer,
        subject: zone.subject,
        ...(zone.component ? { component: zone.component } : {}),
        tests,
        subjects,
        members,
        nodes: review.nodes.filter((node) => zoneOf[node.id] === zone.id).map((node) => node.id),
        ...countsOf(zone.id, review.nodes, zoneOf, covers, tests),
      }
    }),
    zoneOf,
  }
}

const some = (count: number, one: string, many: string) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`

/** What a zone holds, in a few words: "3 subjects · 1 needs you · 2 changed · 7 tests", or "Unchanged". */
export function zoneWords(zone: Pick<GraphZone, 'counts' | 'subjects' | 'tests'>): string {
  const { changed, needsYou, tests } = zone.counts
  const parts = [
    zone.subjects > 1 ? some(zone.subjects, 'subject', 'subjects') : '',
    needsYou > 0 ? `${needsYou.toLocaleString('en-US')} ${needsYou === 1 ? 'needs' : 'need'} you` : '',
    changed > 0 && !zone.tests ? `${changed.toLocaleString('en-US')} changed` : '',
    tests > 0 ? some(tests, 'test', 'tests') : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Unchanged'
}

/** A zone drawn as a region behind its nodes. */
export interface Region {
  /** Its id among the graph's nodes. */
  id: string
  zone: string
  rect: Rect
}

export const REGION_PREFIX = 'zone:'
/** True for the id of a zone's region on the graph. */
export const isRegion = (id: string): boolean => id.startsWith(REGION_PREFIX)

/** The region of each zone that has drawn nodes, around them, in the zones' order. */
export function regionsOf(nodes: readonly { id: string; kind: NodeKind; position: { x: number; y: number }; zone?: string }[], zones: readonly Pick<GraphZone, 'id'>[]): Region[] {
  const rects = zoneRects(nodes, Object.fromEntries(nodes.map((node) => [node.id, node.position])))
  return zones.flatMap((zone) => {
    const rect = rects.get(zone.id)
    return rect ? [{ id: `${REGION_PREFIX}${zone.id}`, zone: zone.id, rect }] : []
  })
}
