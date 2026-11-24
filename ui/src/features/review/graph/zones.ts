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
import { ZONE_FRAME, zoneRects, type Rect } from '#shared/review/layout.ts'
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
  const zones = [...given.values()]
  const zoneOf = new Map<string, string>()
  const missing: ReviewNode[] = []
  for (const node of review.nodes) {
    if (node.zone != null && given.has(node.zone)) zoneOf.set(node.id, node.zone)
    else missing.push(node)
  }
  if (missing.length === 0) return { zones, zoneOf }

  // The rest are named from their paths by the host's rule; a node with no path is an acceptance line or another part.
  const named = withZones(review.nodes, review.edges)
  const namedOf = new Map(named.nodes.map((node) => [node.id, node.zone]))
  const unnamed = (node: ReviewNode) => (node.kind === 'criterion' ? LINES : OTHER)
  const wanted = new Set(missing.map((node) => namedOf.get(node.id) ?? unnamed(node).id))
  for (const node of missing) zoneOf.set(node.id, namedOf.get(node.id) ?? unnamed(node).id)
  for (const zone of [...named.zones, LINES, OTHER]) {
    if (wanted.has(zone.id) && !given.has(zone.id)) zones.push(zone)
  }
  return { zones, zoneOf }
}

/** A zone as it is built: the drawn nodes in it, and how many subjects it holds once small zones merge into it. */
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
  if (!isTestLayer(zone.layer)) return head
  return `${head} · ${zone.layer.slice('test:'.length).replace(/[_-]+/g, ' ')}`
}

const layerKey = (entry: Building) => `${entry.zone.component ?? '-'}/${entry.zone.layer}`

/** Several zones as one, which holds all they hold. */
function joined(zone: ReviewZone, entries: readonly Building[]): Building {
  return {
    zone,
    subjects: entries.reduce((sum, entry) => sum + entry.subjects, 0),
    members: entries.flatMap((entry) => entry.members),
    kept: entries.some((entry) => entry.kept),
  }
}

/** The smallest layer that has more than one zone, by how many drawn nodes its zones hold, the later on a tie. */
function smallestLayer(list: readonly Building[]): Building[] | undefined {
  const layers = new Map<string, Building[]>()
  for (const entry of list) layers.set(layerKey(entry), [...(layers.get(layerKey(entry)) ?? []), entry])
  const size = (entries: readonly Building[]) => entries.reduce((sum, entry) => sum + entry.members.length, 0)
  const firstAt = (entries: readonly Building[]) => list.indexOf(entries[0]!)
  return [...layers.values()]
    .filter((entries) => entries.length > 1)
    .sort((a, b) => size(a) - size(b) || firstAt(b) - firstAt(a))[0]
}

/** A layer's zones merged into one, where its first zone stood. */
function mergeLayer(list: readonly Building[], layer: readonly Building[]): Building[] {
  const first = layer[0]!
  const zone: ReviewZone = {
    id: `${layerKey(first)}/*`,
    layer: first.zone.layer,
    subject: '*',
    label: layerLabel(first.zone),
    ...(first.zone.component ? { component: first.zone.component } : {}),
  }
  const into = joined(zone, layer)
  return list.flatMap((entry) => (entry === first ? [into] : layer.includes(entry) ? [] : [entry]))
}

/** The smallest zones joined into "Other parts", at the end, those to keep last, so that the most are left: one Other parts. */
function joinOther(list: readonly Building[]): Building[] {
  const before = list.find((entry) => entry.zone.id === OTHER.id)
  const byNeed = list
    .filter((entry) => entry !== before)
    .sort((a, b) => Number(a.kept ?? false) - Number(b.kept ?? false) || a.members.length - b.members.length || list.indexOf(b) - list.indexOf(a))
  const more = list.length - MAX_ZONES + (before ? 0 : 1)
  const joining = [...(before ? [before] : []), ...byNeed.slice(0, more)]
  return [...list.filter((entry) => !joining.includes(entry)), joined(OTHER, joining)]
}

/**
 * Past the most zones, a layer's zones merge into one, the smallest layer first, until few enough are left. When no
 * layer has two zones, the smallest zones join "Other parts", those that hold where a request enters, an acceptance line
 * or a part that needs the reviewer last.
 */
function merged(zones: readonly Building[]): Building[] {
  let list = [...zones]
  while (list.length > MAX_ZONES) {
    const layer = smallestLayer(list)
    list = layer ? mergeLayer(list, layer) : joinOther(list)
  }
  return list
}

/** What a zone's parts ask of the reviewer, and what it holds. */
function countsOf(zone: string, nodes: readonly ReviewNode[], zoneOf: Readonly<Record<string, string>>, covers: Readonly<Record<string, string>>, tests: boolean): Pick<GraphZone, 'counts' | 'standing'> {
  const inside = nodes.filter((node) => zoneOf[node.id] === zone)
  const isTest = (node: ReviewNode) => node.kind === 'test' && !node.supports?.length
  const coversHere = (node: ReviewNode) => covers[node.id] != null && zoneOf[covers[node.id]!] === zone
  const changed = inside.filter((node) => node.kind !== 'criterion' && node.change !== 'unchanged')
  // A zone of tests counts its own tests; a zone of code, the tests that cover its code.
  const counted = tests ? inside.filter(isTest) : nodes.filter((node) => isTest(node) && coversHere(node))
  const counts: ZoneCounts = {
    changed: changed.length,
    needsYou: inside.filter((node) => node.attention?.tier === 'needs-you').length,
    tests: counted.length,
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
  const nodeOf = new Map(review.nodes.map((node) => [node.id, node]))
  /** A drawn node's zone before any merge: its first node's. */
  const firstZoneOf = new Map(drawn.map((node) => [node.id, base.zoneOf.get(node.of[0] ?? node.id) ?? base.zoneOf.get(node.id) ?? OTHER.id]))
  const keepsItsName = (id: string) => {
    const node = nodeOf.get(id)
    return node?.entry != null || node?.kind === 'criterion' || node?.attention?.tier === 'needs-you'
  }

  const building = new Map<string, Building>()
  for (const zone of [...base.zones, OTHER]) building.set(zone.id, { zone, subjects: 1, members: [] })
  for (const node of drawn) {
    const entry = building.get(firstZoneOf.get(node.id)!)
    if (!entry) continue
    entry.members.push(node.id)
    if (node.of.some(keepsItsName)) entry.kept = true
  }
  const present = [...building.values()].filter((entry) => entry.members.length > 0)
  const zones = merged(present)

  const zoneOf: Record<string, string> = {}
  for (const entry of zones) for (const id of entry.members) zoneOf[id] = entry.zone.id
  // A node of the review is in the zone of the card that holds it, or else where its own zone went.
  for (const node of drawn) for (const id of node.of) zoneOf[id] ??= zoneOf[node.id]!
  const mergedInto = new Map(present.flatMap((entry) => entry.members.map((id) => [firstZoneOf.get(id)!, zoneOf[id]!] as const)))
  for (const node of review.nodes) zoneOf[node.id] ??= mergedInto.get(base.zoneOf.get(node.id) ?? OTHER.id) ?? zones[0]?.zone.id ?? OTHER.id

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

/** A zone's name as its heading says it: its layer and its subject, or one line for a zone with no subject of its own. */
export interface ZoneTitle {
  layer: string | null
  subject: string
}

/**
 * "Controllers · Posts" is the layer "Controllers" and the subject "Posts". A zone that merged a layer's subjects,
 * Other parts and a name the Reviewer gave have no subject of their own: their name is one line.
 */
export function zoneTitle(zone: Pick<GraphZone, 'label' | 'subjects'>): ZoneTitle {
  const at = zone.label.indexOf(' · ')
  if (zone.subjects > 1 || at < 0) return { layer: null, subject: zone.label }
  return { layer: zone.label.slice(0, at), subject: zone.label.slice(at + ' · '.length) }
}

/** About how wide a line of the heading's letters is: each takes this share of the type's size. */
const LETTER = 0.6
const widthOf = (text: string, size: number) => text.length * size * LETTER

/** The heading's type at reading size, and what sits beside its name: padding, mark, chevron and the gaps (`graph.css`). */
export const HEADING = { size: 14, countsSize: 12.5, beside: 24 + 8 + 9 + 15 + 9 + 9, overhang: 24 } as const

/**
 * The room a heading's name has at reading size in a region this wide: the heading's room less what sits beside the
 * name, and less the counts, which never take more than two fifths of it.
 */
export function headingRoom(regionWidth: number, counts: string): number {
  const heading = regionWidth - 2 * ZONE_FRAME.pad + HEADING.overhang - HEADING.beside
  const forCounts = Math.min(widthOf(counts, HEADING.countsSize), countsRoom(regionWidth))
  return Math.max(0, heading - forCounts)
}

/**
 * The heading's type from far away, and from farther still: the same one line, larger so it still reads, with a larger
 * mark and no counts or chevron beside the name (`graph.css`).
 */
export const FAR_HEADING = { far: { size: 24, mark: 12 }, farther: { size: 40, mark: 16 }, gap: 12 } as const

/** The room a heading's name has from far away in a region this wide: the heading's room less its padding, its mark and one gap. */
export function farRoom(regionWidth: number, distance: 'far' | 'farther'): number {
  const beside = 24 + FAR_HEADING[distance].mark + FAR_HEADING.gap
  return Math.max(0, regionWidth - 2 * ZONE_FRAME.pad + HEADING.overhang - beside)
}

/** The most room a heading's counts take at reading size, so its name keeps the rest: two fifths of the heading. */
export function countsRoom(regionWidth: number): number {
  return Math.max(0, (regionWidth - 2 * ZONE_FRAME.pad + HEADING.overhang - HEADING.beside) * 0.4)
}

/**
 * What a heading says at reading size in `room` points of type `size` (the user, 2026-11-23: zones are "more granular"
 * than a layer, "in a subject", so the subject is the last to go): the whole name, then the layer's first word with the
 * subject, then the subject alone, which the heading cuts at its end when even that is too wide.
 */
export function headingWords(title: ZoneTitle, room: number, size: number): string {
  if (title.layer == null) return title.subject
  const forms = [`${title.layer} · ${title.subject}`]
  const firstWord = title.layer.split(' ')[0]!
  if (firstWord !== title.layer) forms.push(`${firstWord} · ${title.subject}`)
  forms.push(title.subject)
  return forms.find((form) => widthOf(form, size) <= room) ?? title.subject
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
