/**
 * The zones of a review (spec 055): the part of the code each node is in, a layer and a subject, as the change
 * review's own rule names it from the node's path (`packages/change-review/src/zones.ts`), and the review's zones in
 * the order a request passes them. A request goes along the wires, from what calls to what it reaches, so a zone comes
 * before another when its code is reached first; code no such wire joins comes after the code that is. A test's zone
 * comes right after the code it mirrors, or else after the last code its tests cover. The spec's zone, which no
 * request passes, comes last. Pure, so it is tested without a host.
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

  // Each node's place along the request: the most nodes a request passes before it. A loop of calls stops growing
  // once every place could have been reached.
  const steps = edges.flatMap((edge) => {
    const ends = passed(edge)
    return ends && ends[0] !== ends[1] && zoneOfNode.has(ends[0]) && zoneOfNode.has(ends[1]) ? [ends] : []
  })
  const placeOf = new Map(nodes.map((node) => [node.id, 0]))
  for (let round = 0, moved = true; moved && round < nodes.length; round += 1) {
    moved = false
    for (const [first, then] of steps) {
      const next = placeOf.get(first)! + 1
      if (next > placeOf.get(then)!) {
        placeOf.set(then, next)
        moved = true
      }
    }
  }
  const joined = new Set(steps.flat())

  // A code zone comes where its first node does: joined code first, then by place, then as the nodes come.
  const keyOf = new Map<string, number[]>()
  nodes.forEach((node, index) => {
    const zone = zoneOfNode.get(node.id)
    if (!zone || isTestZone(zone) || node.kind === 'criterion') return
    const key = [joined.has(node.id) ? 0 : 1, placeOf.get(node.id)!, index]
    const known = keyOf.get(zone.id)
    if (!known || key.reduce((order, value, at) => order || value - known[at]!, 0) < 0) keyOf.set(zone.id, key)
  })
  const code = [...keyOf.keys()].sort((a, b) => keyOf.get(a)!.reduce((order, value, at) => order || value - keyOf.get(b)![at]!, 0))
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
