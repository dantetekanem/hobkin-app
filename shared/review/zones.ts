/**
 * The zones of a review (spec 055): the part of the code each node is in, a layer and a subject, as the change
 * review's own rule names it from the node's path (`packages/change-review/src/zones.ts`), and the review's zones in
 * the order a request passes them. A request goes along the wires, from what calls to what it reaches, and so from zone
 * to zone: a zone comes after every zone a step reaches it from, a zone a request enters by first, and each way is
 * followed to where it waits for another before the next way starts. Ties go to a zone with a way in, then to the one
 * whose code the review lists first. Code no such wire joins comes after the code that is. A test's zone comes right
 * after the code it mirrors, or else after the last code its tests cover. The spec's zone, which no request passes,
 * comes last. Pure, so it is tested without a host.
 */
import { zoneOf } from '../../packages/change-review/src/zones.ts'
import { cleanProse } from './prose.ts'
import { PROSE_LIMIT, type ReviewEdge, type ReviewNode, type ReviewZone } from './types.ts'

/** The two ends of a wire in the order a request passes them, or null for a wire that says nothing of that order. */
function passed(edge: ReviewEdge): [first: string, then: string] | null {
  // Changed code on the left is called by the caller on the right, which a request reaches first.
  if (edge.kind === 'called-by') return [edge.to, edge.from]
  if (edge.kind === 'calls' || edge.kind === 'renders' || edge.kind === 'uses') return [edge.from, edge.to]
  return null
}

const isTestZone = (zone: ReviewZone) => zone.layer.startsWith('test:')

/** Two sort keys, compared one part after another. */
const byKey = (a: readonly number[], b: readonly number[]) => a.reduce((order, value, at) => order || value - b[at]!, 0)

/**
 * Zones in the order the steps between them go: each comes once every zone a step reaches it from has come, and after
 * a zone, one it leads to that is now free comes next, so a way is followed to its end. Of the zones free to come, the
 * one with the smallest key comes first; in a loop, the smallest left.
 */
function alongSteps(ids: readonly string[], steps: ReadonlyMap<string, ReadonlySet<string>>, keyOf: (id: string) => readonly number[]): string[] {
  const waiting = new Map(ids.map((id) => [id, 0]))
  for (const next of steps.values()) for (const id of next) if (waiting.has(id)) waiting.set(id, waiting.get(id)! + 1)
  const smallest = (candidates: readonly string[]) => candidates.reduce((best, id) => (byKey(keyOf(id), keyOf(best)) < 0 ? id : best))
  const order: string[] = []
  let last: string | undefined
  while (waiting.size > 0) {
    const free = [...waiting.keys()].filter((id) => waiting.get(id) === 0)
    const onward = free.filter((id) => last != null && steps.get(last)?.has(id))
    const chosen = smallest(onward.length ? onward : free.length ? free : [...waiting.keys()])
    waiting.delete(chosen)
    for (const id of steps.get(chosen) ?? []) if (waiting.has(id)) waiting.set(id, waiting.get(id)! - 1)
    order.push(chosen)
    last = chosen
  }
  return order
}

/** A node's zone as the review holds it: the rule's words, kept to a title's length. */
function zoneAt(node: ReviewNode): ReviewZone | undefined {
  if (!node.subtitle) return undefined
  const { id, layer, subject, component, label } = zoneOf(node.subtitle, node.kind === 'test' ? 'test' : undefined)
  return { id, layer, subject, label: cleanProse(label, PROSE_LIMIT.title) || id, ...(component ? { component } : {}) }
}

/** Every node with the id of its zone, and the zones in the order a request passes them. */
export function withZones(nodes: readonly ReviewNode[], edges: readonly ReviewEdge[]): { nodes: ReviewNode[]; zones: ReviewZone[] } {
  const zoneOfNode = new Map(nodes.flatMap((node) => {
    const zone = zoneAt(node)
    return zone ? [[node.id, zone] as const] : []
  }))
  const zones = new Map<string, ReviewZone>()
  for (const zone of zoneOfNode.values()) if (!zones.has(zone.id)) zones.set(zone.id, zone)

  // A code zone's key: a zone a request enters by first, then as the review lists its code.
  const keyOf = new Map<string, number[]>()
  nodes.forEach((node, index) => {
    const zone = zoneOfNode.get(node.id)
    if (!zone || isTestZone(zone) || node.kind === 'criterion') return
    const key = [node.entry ? 0 : 1, index]
    const known = keyOf.get(zone.id)
    if (!known || byKey(key, known) < 0) keyOf.set(zone.id, key)
  })

  // The steps a request takes from one code zone to another.
  const steps = new Map<string, Set<string>>()
  for (const edge of edges) {
    const ends = passed(edge)
    const [from, to] = ends ? [zoneOfNode.get(ends[0])?.id, zoneOfNode.get(ends[1])?.id] : []
    if (!from || !to || from === to || !keyOf.has(from) || !keyOf.has(to)) continue
    steps.set(from, (steps.get(from) ?? new Set()).add(to))
  }
  const joined = new Set([...steps.keys(), ...[...steps.values()].flatMap((next) => [...next])])
  const zoneKey = (id: string) => keyOf.get(id)!
  const loneZones = [...keyOf.keys()].filter((id) => !joined.has(id)).sort((a, b) => byKey(zoneKey(a), zoneKey(b)))
  const code = [...alongSteps([...joined], steps, zoneKey), ...loneZones]
  const rankOf = new Map(code.map((id, rank) => [id, rank]))

  // A test zone follows the code zone it mirrors, else the last one its tests cover.
  const after = new Map<string, string[]>()
  const loose: string[] = []
  const zoneIdOf = (id: string) => zoneOfNode.get(id)?.id
  for (const zone of [...zones.values()].filter(isTestZone)) {
    const mirror = `${zone.component ?? '-'}/${zone.layer.slice('test:'.length)}/${zone.subject}`
    const members = new Set(nodes.filter((node) => zoneIdOf(node.id) === zone.id).map((node) => node.id))
    const covered = edges.filter((edge) => edge.kind === 'exercises' && members.has(edge.from)).flatMap((edge) => (rankOf.has(zoneIdOf(edge.to) ?? '') ? [zoneIdOf(edge.to)!] : []))
    const target = rankOf.has(mirror) ? mirror : covered.sort((a, b) => rankOf.get(b)! - rankOf.get(a)!)[0]
    if (target) after.set(target, [...(after.get(target) ?? []), zone.id])
    else loose.push(zone.id)
  }
  const order = [...code.flatMap((id) => [id, ...(after.get(id) ?? [])]), ...loose]
  const rest = [...zones.keys()].filter((id) => !order.includes(id))
  return {
    nodes: nodes.map((node) => {
      const zone = zoneIdOf(node.id)
      return zone ? { ...node, zone } : node
    }),
    zones: [...order, ...rest].map((id) => zones.get(id)!),
  }
}
