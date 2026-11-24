/**
 * The outline of a review (spec 053): every unit and file of the change, under Needs you, Worth a look and Safe, in the
 * order the host ranked them, the safe ones in the groups the graph folds them into. It is the way to reach anything
 * the graph folded. A review that says nothing of attention lists everything under one heading, in its own order. By
 * zone (spec 055), it lists each zone the graph draws, with what it holds and every node in it, the unchanged code on
 * the way in too. Pure, so what it lists and how it filters can be tested without drawing it.
 */
import type { NodeKind, Review, ReviewNode } from '#shared/review/types.ts'
import type { ReviewView } from '../state/memory.ts'

/** What the outline lists by: what needs the reviewer, or the zones of the graph. */

export interface OutlineRow {
  /** The node of the review. */
  id: string
  title: string
  path: string
  kind: NodeKind
  additions: number
  deletions: number
}

export interface OutlineGroup {
  /** The group card's id in the graph. */
  id: string
  label: string
  rows: OutlineRow[]
}

export interface OutlineSection {
  /** `needs-you`, `worth-a-look`, `safe` or `all`, or by zone, the zone's id. */
  id: string
  title: string
  /** By zone, what the zone holds: "1 needs you · 1 changed · 7 tests". A zone whose name matches a filter keeps all of it. */
  note?: string
  /** What is listed directly under the heading. */
  rows: OutlineRow[]
  /** For Safe: its groups, each opening to its members. */
  groups: OutlineGroup[]
}

/** One line of the list as it is drawn: a heading, a group, or a row, inside a group or not. */
export type OutlineItem =
  | { kind: 'heading'; section: OutlineSection }
  | { kind: 'group'; group: OutlineGroup; open: boolean }
  | { kind: 'row'; row: OutlineRow; group: string | null }

/** A unit or a file of the change: not an acceptance line, nor code around it that the change did not touch. */
const isPart = (node: ReviewNode) => node.kind !== 'criterion' && !(node.kind === 'context' && node.change === 'unchanged')

function rowOf(node: ReviewNode): OutlineRow {
  return {
    id: node.id,
    title: node.title,
    path: node.subtitle ?? '',
    kind: node.kind,
    additions: node.stats?.additions ?? 0,
    deletions: node.stats?.deletions ?? 0,
  }
}

/** The nodes in the host's rank order, unrated last, each rank in the review's own order. */
function byRank(nodes: readonly ReviewNode[]): ReviewNode[] {
  const rankOf = (node: ReviewNode) => node.attention?.rank ?? Infinity
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => rankOf(a.node) - rankOf(b.node) || a.index - b.index)
    .map(({ node }) => node)
}

/** The outline of a review as its view draws it: the groups are the graph's own. */
export function outlineOf(review: Pick<Review, 'nodes'>, view: Pick<ReviewView, 'groupOf' | 'plan'>): OutlineSection[] {
  const parts = review.nodes.filter(isPart)
  if (!view.plan.active) return [{ id: 'all', title: 'In this change', rows: parts.map(rowOf), groups: [] }]

  const ranked = byRank(parts)
  const needsYou = ranked.filter((node) => node.attention?.tier === 'needs-you')
  // What the host did not rate is drawn as a card, as what is worth a look is, and listed after it.
  const worth = ranked.filter((node) => node.attention?.tier === 'worth-a-look' || node.attention == null)
  const safe = ranked.filter((node) => node.attention?.tier === 'safe')
  // A safe node is listed in the group its card folds into, and on its own when its card stands alone.
  const groupOf = (node: ReviewNode) => {
    const group = view.plan.groupOf[view.groupOf[node.id] ?? node.id]
    return group != null && view.plan.groups[group]?.standing === 'safe' ? group : null
  }
  const groups = view.plan.order
    .filter((id) => view.plan.groups[id]!.standing === 'safe')
    .map((id) => ({
      id,
      label: view.plan.groups[id]!.label,
      rows: safe.filter((node) => groupOf(node) === id).map(rowOf),
    }))
    .filter((group) => group.rows.length > 0)

  return [
    { id: 'needs-you', title: 'Needs you', rows: needsYou.map(rowOf), groups: [] },
    { id: 'worth-a-look', title: 'Worth a look', rows: worth.map(rowOf), groups: [] },
    { id: 'safe', title: 'Safe', rows: safe.filter((node) => groupOf(node) == null).map(rowOf), groups },
  ]
}

/** The outline with only what matches every word typed, by name or path. A group or a zone whose name matches keeps all of it. */
export function filterOutline(sections: readonly OutlineSection[], query: string): OutlineSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...sections]
  const matches = (text: string) => words.every((word) => text.toLowerCase().includes(word))
  const keep = (rows: readonly OutlineRow[]) => rows.filter((row) => matches(`${row.title} ${row.path}`))
  const keepGroup = (group: OutlineGroup) => (matches(group.label) ? group : { ...group, rows: keep(group.rows) })
  return sections.map((section) => ({
    ...section,
    rows: section.note != null && matches(section.title) ? section.rows : keep(section.rows),
    groups: section.groups.map(keepGroup).filter((group) => group.rows.length > 0),
  }))
}

/** The lines of the list, in order: each heading, its rows, then its groups, each open one followed by its rows. */
export function outlineItems(sections: readonly OutlineSection[], expanded: ReadonlySet<string>, filtering = false): OutlineItem[] {
  const items: OutlineItem[] = []
  for (const section of sections) {
    if (section.rows.length === 0 && section.groups.length === 0 && filtering) continue
    items.push({ kind: 'heading', section })
    for (const row of section.rows) items.push({ kind: 'row', row, group: null })
    for (const group of section.groups) {
      const open = filtering || expanded.has(group.id)
      items.push({ kind: 'group', group, open })
      if (open) for (const row of group.rows) items.push({ kind: 'row', row, group: group.id })
    }
  }
  return items
}
