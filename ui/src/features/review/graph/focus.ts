/**
 * Focus (spec 053): a large change opens on the few parts that need the reviewer. Every node that needs them and every
 * one worth a look is a card. Safe nodes fold into group cards: by kind (generated files, lockfiles, locale files, moved
 * files, formatting, docs, tests), and safe code by its top folder. Opening a group turns its members into cards, up to
 * the budget; past it they stay in the outline only. Nothing is ever drawn past the budget of cards and wires.
 *
 * A review whose nodes say nothing about attention (every review an older host prepared) is not folded at all: it
 * draws as it always did. Pure, and the same review in the same state always folds the same way.
 */
import { layoutRequest, openBlocks, type Positions } from '#shared/review/layout.ts'
import type { AttentionTier, NodeBucket, ReviewNode } from '#shared/review/types.ts'
import type { Arranged, ArrangedEdge, TestGroup, ViewStep } from './arrange.ts'

/** The most cards and wires a review ever mounts. */
export const FOCUS_BUDGET = { cards: 60, wires: 120 } as const
/** The most groups of safe nodes: past it, the smallest folders of safe code fold into one group. */
export const MAX_GROUPS = 12

const PREFIX = 'fold:'
/** True for the id of a group card. */
export const isFoldGroup = (id: string): boolean => id.startsWith(PREFIX)

/** What a drawn node asks of the reviewer: its own attention, or for a card of tests, the most any of its tests asks. */
export interface Attended {
  tier: AttentionTier
  rank: number
  bucket: NodeBucket
}

/**
 * Where a drawn node stands, most wanted first: what needs the reviewer, what is worth a look, the spec's acceptance
 * lines, whatever the host did not rate, and what is safe.
 */
export type Standing = AttentionTier | 'criterion' | 'unrated'
const STANDINGS: readonly Standing[] = ['needs-you', 'worth-a-look', 'criterion', 'unrated', 'safe']

export interface FoldGroup {
  id: string
  /** A kind of safe change, the safe code of one folder (`code`), of several small folders (`folders`), or the cards past the budget (`more`). */
  kind: NodeBucket | 'folders' | 'more'
  /** Safe code's folder, such as `app/models`. Empty at the top of the repository. */
  folder: string | null
  /** Whose nodes it holds. Safe, except for the cards a budget left over. */
  standing: Standing
  /** What it holds, in a few words: "Generated files", "Safe code in app/models". */
  label: string
  /** The drawn nodes it holds, most wanted first. A card of tests stands for its tests. */
  members: string[]
  /** How many files its members are in. */
  files: number
  additions: number
  deletions: number
  /** One sentence on why it can be read at a glance. */
  why: string
}

export interface FocusState {
  /** The groups opened, the last opened last. The last opened takes the budget first. */
  opened: readonly string[]
  /** Nodes reached from the outline or by the next-unseen key, the latest first: they are drawn before the rest of their group. */
  pinned: readonly string[]
}

export const NO_FOCUS: FocusState = { opened: [], pinned: [] }

export interface FocusPlan {
  /** False for a review with no attention on its nodes: nothing folds. */
  active: boolean
  /** Every drawn id, most wanted first: the cards, the members of open groups, then the group cards. */
  cards: string[]
  groups: Record<string, FoldGroup>
  /** The group ids in the order they are read. */
  order: string[]
  /** Each member of a group, by its drawn id, to its group. */
  groupOf: Record<string, string>
  /** The members of each open group that are drawn as cards. */
  shown: Record<string, string[]>
  /** The open groups, the last opened last. */
  open: string[]
  /** What each drawn node asks of the reviewer, when the host said. */
  attended: Record<string, Attended>
  /** Where each drawn node stands. */
  standing: Record<string, Standing>
}

const TIER_ORDER: Record<AttentionTier, number> = { 'needs-you': 0, 'worth-a-look': 1, safe: 2 }

/** Its attention, or for a card of tests, the most its tests ask: their strongest tier and their first rank. */
export function attendedOf(node: ReviewNode, members: readonly ReviewNode[] = []): Attended | null {
  const rated = (members.length > 0 ? members : [node]).filter((entry) => entry.attention != null)
  if (rated.length === 0) return null
  const tier = rated.map((entry) => entry.attention!.tier).reduce((best, next) => (TIER_ORDER[next] < TIER_ORDER[best] ? next : best))
  return { tier, rank: Math.min(...rated.map((entry) => entry.attention!.rank)), bucket: members.length > 0 ? 'test' : (node.bucket ?? 'code') }
}

/** True when the host said what the review's nodes ask of the reviewer. */
export function hasAttention(nodes: readonly ReviewNode[]): boolean {
  return nodes.some((node) => node.attention != null)
}

/** The folder safe code is grouped by: the first two folders of its path, such as `app/models`. Empty at the top. */
export function topFolder(path: string | undefined): string {
  return (path ?? '').split('/').slice(0, -1).slice(0, 2).join('/')
}

const KIND_LABEL: Record<NodeBucket, string> = {
  code: 'Safe code',
  test: 'Tests that pass',
  generated: 'Generated files',
  lockfile: 'Lockfiles',
  locale: 'Locale files',
  moved: 'Moved or renamed',
  format: 'Formatting only',
  docs: 'Docs',
}
const WHY: Record<NodeBucket | 'folders' | 'more', string> = {
  code: 'The review found nothing in this code that needs you.',
  test: 'They pass, and the review found nothing in them that needs you.',
  generated: 'A tool wrote these from its input, so they follow from what changed elsewhere.',
  lockfile: 'They pin the versions the project depends on, and follow from its manifests.',
  locale: 'Words in other languages: no code runs differently.',
  moved: 'They moved or were renamed with little or nothing changed inside.',
  format: 'Only spacing and layout changed: the code does the same.',
  docs: 'Words for people to read: no code runs differently.',
  folders: 'The review found nothing in this code that needs you.',
  more: 'More than the graph draws at once. Open it, or find each in the outline.',
}
const MORE_LABEL: Record<Standing, string> = {
  'needs-you': 'More that needs you',
  'worth-a-look': 'More worth a look',
  criterion: 'More acceptance lines',
  unrated: 'More of the change',
  safe: 'More safe changes',
}

interface Entry {
  node: ReviewNode
  standing: Standing
  rank: number
  index: number
  key: string
}

/** Opening Focus on a review: what is a card, what folds into which group, and what an open group draws. */
export function planFocus(input: { nodes: readonly ReviewNode[]; groups: Readonly<Record<string, TestGroup>>; nodeOf: ReadonlyMap<string, ReviewNode> }, state: FocusState = NO_FOCUS): FocusPlan {
  const { nodes, groups: testCards, nodeOf } = input
  const membersOf = (node: ReviewNode) => {
    const card = testCards[node.id]
    return card ? [...card.tests, ...card.helpers].map((id) => nodeOf.get(id)).filter((entry): entry is ReviewNode => entry != null) : []
  }
  const attended: Record<string, Attended> = {}
  for (const node of nodes) {
    const found = attendedOf(node, membersOf(node))
    if (found) attended[node.id] = found
  }
  const standing: Record<string, Standing> = {}
  const entries: Entry[] = nodes.map((node, index) => {
    const rated = attended[node.id]
    const where: Standing = rated ? rated.tier : node.kind === 'criterion' ? 'criterion' : 'unrated'
    standing[node.id] = where
    const bucket = rated?.bucket ?? 'code'
    return { node, standing: where, rank: rated?.rank ?? Number.POSITIVE_INFINITY, index, key: bucket === 'code' ? `code:${topFolder(node.subtitle)}` : bucket }
  })
  if (Object.keys(attended).length === 0) {
    return { active: false, cards: nodes.map((node) => node.id), groups: {}, order: [], groupOf: {}, shown: {}, open: [], attended, standing }
  }
  entries.sort((a, b) => STANDINGS.indexOf(a.standing) - STANDINGS.indexOf(b.standing) || a.rank - b.rank || a.index - b.index)

  // Safe nodes fold by their kind, and safe code by its folder. A group of one is simply its card.
  const byKey = new Map<string, Entry[]>()
  for (const entry of entries.filter((each) => each.standing === 'safe')) byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry])
  const cards: Entry[] = entries.filter((entry) => entry.standing !== 'safe' || byKey.get(entry.key)!.length === 1)
  const folding = [...byKey.entries()].filter(([, members]) => members.length > 1)
  // Past the most groups, the smallest folders of safe code join one group, so the graph is not all group cards.
  const folders = folding.filter(([key]) => key.startsWith('code:')).sort((a, b) => a[1].length - b[1].length || a[1][0]!.rank - b[1][0]!.rank)
  const merged: Entry[] = []
  while (folding.length + Number(merged.length > 0) > MAX_GROUPS && folders.length > 0) {
    const [key, members] = folders.shift()!
    folding.splice(folding.findIndex(([each]) => each === key), 1)
    merged.push(...members)
  }

  const made: FoldGroup[] = []
  const group = (id: string, kind: FoldGroup['kind'], folder: string | null, where: Standing, label: string, members: Entry[]) => {
    const sorted = [...members].sort((a, b) => a.rank - b.rank || a.index - b.index)
    const paths = new Set(sorted.flatMap(({ node }) => [...membersOf(node), node].map((each) => each.subtitle ?? each.id)))
    const sum = (field: 'additions' | 'deletions') => sorted.reduce((total, { node }) => total + (node.stats?.[field] ?? 0), 0)
    made.push({ id, kind, folder, standing: where, label, members: sorted.map(({ node }) => node.id), files: paths.size, additions: sum('additions'), deletions: sum('deletions'), why: WHY[kind] })
  }
  for (const [key, members] of folding) {
    if (key.startsWith('code:')) {
      const folder = key.slice('code:'.length)
      group(`${PREFIX}${key}`, 'code', folder, 'safe', folder ? `Safe code in ${folder}` : 'Safe code at the top', members)
    } else {
      const kind = key as NodeBucket
      const passed = members.every(({ node }) => node.status === 'passed' || node.status === 'proves-change')
      group(`${PREFIX}${key}`, kind, null, 'safe', kind === 'test' && !passed ? 'Safe tests' : KIND_LABEL[kind], members)
    }
  }
  if (merged.length > 0) group(`${PREFIX}folders`, 'folders', null, 'safe', 'Safe code in other folders', merged)

  // Past the budget, the least wanted cards fold too, into a group for what they are.
  const overflow = new Map<Standing, Entry[]>()
  const total = () => cards.length + made.length + overflow.size
  while (total() > FOCUS_BUDGET.cards && cards.length > 0) {
    const last = cards.pop()!
    overflow.set(last.standing, [last, ...(overflow.get(last.standing) ?? [])])
  }
  for (const [where, members] of overflow) group(`${PREFIX}more:${where}`, 'more', null, where, MORE_LABEL[where], members)

  // Groups are read in the order of what they hold: what needs the reviewer first, then by their first member's rank.
  const groupRank = (each: FoldGroup) => Math.min(...each.members.map((id) => entries.find((entry) => entry.node.id === id)!.rank))
  made.sort((a, b) => STANDINGS.indexOf(a.standing) - STANDINGS.indexOf(b.standing) || groupRank(a) - groupRank(b) || (a.id < b.id ? -1 : 1))
  const groups = Object.fromEntries(made.map((each) => [each.id, each]))
  const groupOf: Record<string, string> = {}
  for (const each of made) for (const id of each.members) groupOf[id] = each.id

  // An open group draws its members, the pinned first, while the budget lasts. The last opened is served first.
  const open = state.opened.filter((id, index, all) => groups[id] != null && all.lastIndexOf(id) === index)
  let room = FOCUS_BUDGET.cards - total()
  const shown: Record<string, string[]> = {}
  for (const id of [...open].reverse()) {
    const members = groups[id]!.members
    const pinned = state.pinned.filter((pin) => groupOf[pin] === id)
    const wanted = [...pinned, ...members.filter((member) => !pinned.includes(member))]
    shown[id] = wanted.slice(0, Math.max(0, room))
    room -= shown[id]!.length
  }
  const drawn = [...cards.map((entry) => entry.node.id), ...open.flatMap((id) => shown[id]!), ...made.map((each) => each.id)]
  return { active: true, cards: drawn, groups, order: made.map((each) => each.id), groupOf, shown, open, attended, standing }
}

/** The review as Focus draws it: the arranged graph with its safe nodes folded, and the plan that folded it. */
export interface Folded extends Arranged {
  plan: FocusPlan
  /** Each drawn node that is folded away now, by its id, to the group card that stands for it. */
  foldOf: Record<string, string>
}

/** The node a group card is drawn from. Its kind places it: a group of tests sits with the tests, any other with the code. */
function groupNode(group: FoldGroup): ReviewNode {
  return {
    id: group.id,
    kind: group.kind === 'test' ? 'test' : 'file',
    title: group.label,
    ...(group.folder ? { subtitle: group.folder } : {}),
    change: 'modified',
    stats: { additions: group.additions, deletions: group.deletions },
    summary: group.why,
    anchors: [],
    position: { x: 0, y: 0 },
  }
}

/** A wire's place when the budget is short: the story's own first, then those between cards, the most wanted first. */
function wireOrder(edges: readonly ArrangedEdge[], plan: FocusPlan, ridden: ReadonlySet<string>): ArrangedEdge[] {
  const place = new Map(plan.cards.map((id, index) => [id, index]))
  const at = (id: string) => place.get(id) ?? Number.MAX_SAFE_INTEGER
  const key = (edge: ArrangedEdge) => [ridden.has(edge.id) ? 0 : 1, Number(isFoldGroup(edge.from) || isFoldGroup(edge.to)), Math.max(at(edge.from), at(edge.to)), Math.min(at(edge.from), at(edge.to))]
  return [...edges].sort((a, b) => {
    const [one, two] = [key(a), key(b)]
    for (let index = 0; index < one.length; index += 1) if (one[index] !== two[index]) return one[index]! - two[index]!
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * Where Focus draws its nodes. The graph is laid out as it stands with every group closed, the request's way as always
 * (`layoutRequest`), from every wire, drawn or not: so opening or closing a group never moves the rest of the graph
 * about. Each open group then opens in place, its members after its card, and what is beside it and below it makes room.
 */
function layoutFolded(arranged: Arranged, nodes: readonly ReviewNode[], plan: FocusPlan): Positions {
  const opened = new Set(plan.open.flatMap((id) => plan.shown[id]!))
  const closed = (id: string) => plan.groupOf[id] ?? id
  const standing = nodes.filter((node) => !opened.has(node.id))
  const kept = new Set(standing.map((node) => node.id))
  const wires = arranged.edges.map((edge) => ({ from: closed(edge.from), to: closed(edge.to) })).filter((edge) => edge.from !== edge.to && kept.has(edge.from) && kept.has(edge.to))
  const kindOf = new Map(nodes.map((node) => [node.id, node.kind]))
  return openBlocks(layoutRequest(standing, wires), (id) => kindOf.get(id) ?? 'file', plan.open.map((id) => ({ at: id, ids: plan.shown[id]! })))
}

/**
 * Folds an arranged review as a plan says: the cards and group cards are drawn, a folded node's wires go to its group's
 * card, wires that then join the same two cards become one, and past the budget the least wanted wires are not drawn. A
 * step that focused a folded node focuses its group's card.
 */
export function foldArranged(arranged: Arranged, plan: FocusPlan): Folded {
  if (!plan.active) return { ...arranged, plan, foldOf: {} }
  const drawn = new Set(plan.cards)
  const foldOf: Record<string, string> = {}
  for (const [id, group] of Object.entries(plan.groupOf)) if (!drawn.has(id)) foldOf[id] = group
  const end = (id: string) => foldOf[id] ?? id

  const joined = new Map<string, ArrangedEdge>()
  const wireOf = new Map<string, string>()
  for (const edge of arranged.edges) {
    const [from, to] = [end(edge.from), end(edge.to)]
    if (from === to || !drawn.has(from) || !drawn.has(to)) continue
    const key = from !== edge.from || to !== edge.to ? `${edge.kind}:${from}>${to}` : edge.id
    wireOf.set(edge.id, key)
    const known = joined.get(key)
    if (!known) {
      joined.set(key, { ...edge, id: key, from, to, members: [...edge.members] })
      continue
    }
    known.members.push(...edge.members)
    if (edge.certainty === 'host') known.certainty = 'host'
    if (known.label !== edge.label) delete known.label
  }
  const ridden = new Set(arranged.story.map((step) => step.travel).filter((id): id is string => id != null && wireOf.get(id) === id))
  const kept = new Set(wireOrder([...joined.values()], plan, ridden).slice(0, FOCUS_BUDGET.wires).map((edge) => edge.id))
  const edges = [...joined.values()].filter((edge) => kept.has(edge.id))

  // In the review's own order, then the groups in the order they are read, so the layout does not hang on what is open.
  const nodes = [...arranged.nodes.filter((node) => drawn.has(node.id)), ...plan.order.map((id) => groupNode(plan.groups[id]!))]
  const positions = layoutFolded(arranged, nodes, plan)
  const story: ViewStep[] = arranged.story.map((step) => {
    const { travel, ...rest } = step
    const focus = [...new Set(step.focus.map(end))]
    return { ...rest, focus, ...(travel && kept.has(travel) && wireOf.get(travel) === travel ? { travel } : {}) }
  })
  return {
    ...arranged,
    nodes: nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position })),
    edges,
    story,
    hidden: [...arranged.hidden, ...arranged.nodes.filter((node) => foldOf[node.id] != null)],
    plan,
    foldOf,
  }
}
