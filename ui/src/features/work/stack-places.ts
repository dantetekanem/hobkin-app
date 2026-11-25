import type { PullRequest } from '#shared/protocol/pulls.ts'
import type { FinishedChange, MergingRow, StackPlace } from '#shared/protocol/work.ts'
import { pullOfReview, targetOfReviewId } from '#shared/review/ids.ts'
import { pullStacks } from '#shared/review/pull-stacks.ts'
import { layerReviewId } from '../review/stack-strip.ts'
import type { ReviewRow } from './ai-reviews.ts'

/**
 * Where each Review row stands in its stack (_specs/067-review-list-one-list, "Stacks and one row each"). A layer is read
 * from hobkin's finished changes, from the open pull requests' branches (`pullStacks`), or from both. Pure, so it is
 * tested without a window.
 */

/** A layer the user already said merge to: hobkin took it out of its stack, and the frame still draws it, as a quiet line. */
export interface MergingLayer {
  key: string
  title: string
  place: StackPlace
}

/** Where a row stands in a stack: null for a row that is in none. `merging` holds, for each stack, its layers being merged. */
export interface PlaceOf {
  (row: ReviewRow): StackPlace | null
  readonly merging: ReadonlyMap<string, readonly MergingLayer[]>
}

/** One layer, whatever has been read of it: the change, the open pull request and the merge the user asked for. */
interface Node {
  change?: FinishedChange
  pull?: PullRequest
  merging?: MergingRow
}

const pullKey = (repo: string, number: number) => `${repo.toLowerCase()}#${number}`

/** The key of the pull request an address names, or null when it is none. */
function keyOfAddress(address: string | null | undefined): string | null {
  const target = address ? targetOfReviewId(address) : null
  return target?.kind === 'pull' ? pullKey(`${target.owner}/${target.repo}`, target.number) : null
}

const branchOf = (node: Node): string | null => node.change?.branch ?? node.merging?.branch ?? null

/**
 * The layers the pull requests and the changes make, each in one `Node`: a change or a merge joins the pull request it
 * opened, or is at the commit of, or is on the branch of. What matches none stands alone.
 */
function nodesOf(changes: readonly FinishedChange[], pulls: readonly PullRequest[], merging: readonly MergingRow[]): Node[] {
  const nodes: Node[] = []
  const byKey = new Map<string, Node>()
  const byHead = new Map<string, Node>()
  const byBranch = new Map<string, Node[]>()
  for (const pull of new Map(pulls.map((one) => [one.url, one])).values()) {
    const node: Node = { pull }
    nodes.push(node)
    byKey.set(pullKey(pull.repo, pull.number), node)
    if (pull.head && !byHead.has(pull.head)) byHead.set(pull.head, node)
    if (pull.headBranch) byBranch.set(pull.headBranch, [...(byBranch.get(pull.headBranch) ?? []), node])
  }
  /** The listed pull request that opened it, else the one at its commit, else the only one on its branch. */
  const pullOf = (address: string | null, head: string | null, branch: string | null): Node | undefined => {
    const key = keyOfAddress(address)
    const onBranch = branch ? byBranch.get(branch) : undefined
    return (key ? byKey.get(key) : undefined) ?? (head ? byHead.get(head) : undefined) ?? (onBranch?.length === 1 ? onBranch[0] : undefined)
  }
  for (const change of changes) {
    const found = pullOf(change.pr, change.head, change.branch)
    if (found && !found.change) found.change = change
    else nodes.push({ change })
  }
  for (const row of merging) {
    const found = pullOf(row.pr, null, row.branch)
    if (found && !found.change && !found.merging) found.merging = row
    else nodes.push({ merging: row })
  }
  return nodes
}

/** The layers of one stack, bottom first, counted by the pull requests' order, and the places they take. */
function placesOf(members: readonly Node[], pullPlaces: ReadonlyMap<string, StackPlace>): { node: Node; place: StackPlace }[] {
  const layerOf = (node: Node) => (node.pull ? pullPlaces.get(node.pull.url)?.layer : undefined)
  const keys = new Map<Node, number>()
  for (const node of members) {
    const layer = layerOf(node)
    if (layer !== undefined) keys.set(node, layer)
  }
  // A layer with no pull request listed sits just under the pull request that is based on its branch.
  for (const node of members) {
    const branch = branchOf(node)
    const over = branch ? members.find((other) => keys.has(other) && other.pull?.baseBranch === branch) : undefined
    if (!keys.has(node) && over) keys.set(node, keys.get(over)! - 0.5)
  }
  // Else beside a layer of the same hobkin stack that has its place, by hobkin's own distance between them.
  for (const node of members) {
    const own = node.change?.stack
    const near = own ? members.find((other) => keys.has(other) && other.change?.stack?.id === own.id) : undefined
    if (!keys.has(node) && own && near) keys.set(node, keys.get(near)! + (own.layer - near.change!.stack!.layer) * 0.01)
  }
  // What is left: a merge, which lands first, under the rest, and a change, over them.
  const ordered = members
    .map((node) => ({ node, key: keys.get(node) ?? (node.change ? 1e6 : -1) }))
    .toSorted((a, b) => a.key - b.key || (a.node.change?.item ?? '').localeCompare(b.node.change?.item ?? ''))
  const name = members.find((node) => node.change?.stack?.name)?.change?.stack?.name ?? null
  const idOf = (node: Node) => node.pull?.url ?? node.change?.key ?? node.merging?.key ?? ''
  return ordered.map(({ node }, at) => {
    const under = ordered[at - 1]?.node
    return {
      node,
      place: { id: idOf(ordered[0]!.node), layer: at + 1, of: ordered.length, name, below: under ? (under.change?.item ?? idOf(under)) : null, base: under?.pull?.head ?? under?.change?.head ?? null },
    }
  })
}

/**
 * Where each row stands in its stack. A change that is in a stack of hobkin's has its place from it. A layer that is also
 * one of the user's open pull requests, in a stack of pull requests, takes its place from the pull requests' order, and
 * the whole stack is numbered by it, since hobkin leaves a layer the user said merge to out of its own count: a stack
 * is joined when a pull request is the change's own, is at its commit, or is on its branch, or a change's branch is the
 * base of a pull request. A pull request in a stack with no change has its place from the pull requests alone.
 */
export function placeLookup(changes: readonly FinishedChange[], pulls: readonly PullRequest[] = [], merging: readonly MergingRow[] = []): PlaceOf {
  const nodes = nodesOf(changes, pulls, merging)
  const pullPlaces = pullStacks(pulls)

  // A stack is the layers joined by a pull request stack, by hobkin's, or by a branch that is another's base.
  const parent = new Map<Node, Node>(nodes.map((node) => [node, node]))
  const root = (node: Node): Node => {
    const up = parent.get(node)!
    return up === node ? node : root(up)
  }
  const join = (a: Node, b: Node) => parent.set(root(a), root(b))
  const first = new Map<string, Node>()
  const joinOn = (id: string, node: Node) => {
    const other = first.get(id)
    if (other) join(other, node)
    else first.set(id, node)
  }
  for (const node of nodes) {
    if (node.pull && pullPlaces.has(node.pull.url)) joinOn(`pulls:${pullPlaces.get(node.pull.url)!.id}`, node)
    if (node.change?.stack) joinOn(`change:${node.change.slug}:${node.change.stack.id}`, node)
    const branch = branchOf(node)
    if (branch) for (const other of nodes) if (other !== node && other.pull?.baseBranch === branch && pullPlaces.has(other.pull.url) && !node.pull) join(node, other)
  }

  const stacks = new Map<Node, Node[]>()
  for (const node of nodes) stacks.set(root(node), [...(stacks.get(root(node)) ?? []), node])

  const placed = new Map<Node, StackPlace>()
  const mergingOf = new Map<string, MergingLayer[]>()
  for (const members of stacks.values()) {
    if (!members.some((node) => node.pull && pullPlaces.has(node.pull.url))) continue
    for (const { node, place } of placesOf(members, pullPlaces)) {
      placed.set(node, place)
      if (node.merging && !node.change) mergingOf.set(place.id, [...(mergingOf.get(place.id) ?? []), { key: node.merging.key, title: node.merging.title, place }])
    }
  }

  const byReview = new Map<string, Node>()
  const byPull = new Map<string, Node>()
  const byHead = new Map<string, Node>()
  for (const node of nodes) {
    if (node.change) {
      byReview.set(layerReviewId(node.change), node)
      const opened = keyOfAddress(node.change.pr)
      if (opened) byPull.set(opened, node)
      if (node.change.head && !byHead.has(node.change.head)) byHead.set(node.change.head, node)
    }
    if (node.pull) {
      byPull.set(pullKey(node.pull.repo, node.pull.number), node)
      if (node.pull.head && !byHead.has(node.pull.head)) byHead.set(node.pull.head, node)
    }
  }

  const nodeOf = ({ item }: ReviewRow): Node | undefined => {
    const target = pullOfReview(item.id)
    const key = target ? pullKey(`${target.owner}/${target.repo}`, target.number) : null
    return byReview.get(item.id) ?? (key ? byPull.get(key) : undefined) ?? (item.head ? byHead.get(item.head) : undefined)
  }
  const placeOf = ((row: ReviewRow) => {
    const node = nodeOf(row)
    return node ? (placed.get(node) ?? node.change?.stack ?? null) : null
  }) as PlaceOf
  return Object.assign(placeOf, { merging: mergingOf as ReadonlyMap<string, readonly MergingLayer[]> })
}
