/**
 * The rules a review file keeps, checked before it is saved and again when it is opened.
 * `validateReview` checks the file against itself. `openReview` also checks its anchors against the bytes.
 */
import { NODE_SIZE } from './layout.ts'
import { hashLines } from './lines.ts'
import { isCleanProse, isSafePath, listed } from './prose.ts'
import { connectingEdge } from './story.ts'
import { EDGE_KINDS, HOST_TEXT_LIMIT, MAX_FOCUS, NODE_KINDS, NO_SPEC_NOTICE, PROSE_LIMIT, TITLE_LIMIT, WIRE_RULES, type AnchorSide, type NodeKind, type Review, type ReviewEdge, type ReviewNode } from './types.ts'

const KIND_NAME: Record<NodeKind, string> = { criterion: 'an acceptance line', test: 'a test', code: 'code', file: 'a file', context: 'context' }
const HASH = /^[0-9a-f]{64}$/

const isRecord = (value: unknown): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value)
const isLine = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

export function kindName(kind: NodeKind): string {
  return KIND_NAME[kind]
}

/** Why a wire of this kind cannot join these two kinds, or undefined when it can. */
export function wireProblem(kind: ReviewEdge['kind'], from: NodeKind, to: NodeKind): string | undefined {
  const rule = WIRE_RULES[kind]
  return rule.from.includes(from) && rule.to.includes(to) ? undefined : `${kind} cannot join ${KIND_NAME[from]} to ${KIND_NAME[to]}`
}

/** Everything wrong with a review file. An empty list means it is valid. */
export function validateReview(value: unknown): string[] {
  if (!isRecord(value)) return ['A review must be an object.']
  const problems: string[] = []
  const review = value as unknown as Review
  if (review.version !== 1) problems.push('version must be 1.')
  if (typeof review.id !== 'string' || !review.id) problems.push('id must be a name.')
  if (typeof review.snapshot !== 'string' || !HASH.test(review.snapshot)) problems.push('snapshot must be a fingerprint.')
  if (!isCleanProse(review.summary, PROSE_LIMIT.stepText)) problems.push('The summary has control characters or is too long.')
  for (const field of ['files', 'nodes', 'edges', 'story', 'notices'] as const) {
    if (!Array.isArray(review[field])) problems.push(`${field} must be a list.`)
  }

  const change = review.change
  if (!isRecord(change)) problems.push('change must say what was reviewed.')
  else {
    for (const field of ['project', 'item', 'title', 'branch', 'base', 'head'] as const) {
      if (!isCleanProse(change[field], TITLE_LIMIT)) problems.push(`change.${field} must be plain text.`)
    }
    for (const field of ['additions', 'deletions', 'files'] as const) if (!isCount(change[field])) problems.push(`change.${field} must be a count.`)
    if (change.risk !== undefined && !isCleanProse(change.risk, HOST_TEXT_LIMIT)) problems.push('change.risk must be plain text.')
  }
  if (review.spec !== null) {
    const spec = review.spec
    const lists = isRecord(spec) && [spec.outOfScope, spec.openQuestions].every((entries) => Array.isArray(entries) && entries.every((entry) => typeof entry === 'string'))
    if (!isRecord(spec) || !isSafePath(spec.path) || typeof spec.outcome !== 'string' || !lists) problems.push('spec must hold a path, an outcome, what is out of scope and the open questions, or be null.')
  }
  // Nothing below can be checked without these.
  if (problems.length > 0) return problems

  const fileIds = new Set<string>()
  for (const file of review.files) {
    if (!isRecord(file) || typeof file.id !== 'string' || !isSafePath(file.path)) {
      problems.push('A file has no id or no path inside the repository.')
      continue
    }
    if (fileIds.has(file.id)) problems.push(`File ${file.id} is listed twice.`)
    fileIds.add(file.id)
    if (!['added', 'modified', 'deleted', 'renamed', 'unchanged'].includes(file.status)) problems.push(`File ${file.id} has an unknown status.`)
    if (file.oldPath !== undefined && !isSafePath(file.oldPath)) problems.push(`File ${file.id} has an old path outside the repository.`)
    if (!isCount(file.additions) || !isCount(file.deletions)) problems.push(`File ${file.id} must count its added and removed lines.`)
  }

  const nodes = new Map<string, ReviewNode>()
  for (const node of review.nodes) {
    if (!isRecord(node) || typeof node.id !== 'string' || !node.id) {
      problems.push('A node has no id.')
      continue
    }
    const name = `Node ${node.id}`
    if (nodes.has(node.id)) problems.push(`Node id ${node.id} is used twice.`)
    nodes.set(node.id, node)
    if (!NODE_KINDS.includes(node.kind)) {
      problems.push(`${name} has an unknown kind.`)
      continue
    }
    if (!isCleanProse(node.title, TITLE_LIMIT) || !node.title) problems.push(`${name}: the title is empty, has control characters or is too long.`)
    if (!isCleanProse(node.summary, node.kind === 'criterion' ? HOST_TEXT_LIMIT : PROSE_LIMIT.summary)) problems.push(`${name}: the summary has control characters or is too long.`)
    if (node.subtitle !== undefined && !isSafePath(node.subtitle)) problems.push(`${name}: the path is not inside the repository.`)
    if (!['added', 'modified', 'deleted', 'unchanged'].includes(node.change)) problems.push(`${name} has an unknown change.`)
    const statuses = node.kind === 'criterion' ? ['proven', 'unproven'] : node.kind === 'test' ? ['passed', 'failed', 'not-run', undefined] : [undefined]
    if (!statuses.includes(node.status)) problems.push(`${name}: ${String(node.status)} is not a status of ${KIND_NAME[node.kind]}.`)
    if (node.kind === 'criterion' && review.spec === null) problems.push(`${name} is an acceptance line, and this review has no spec.`)
    if (node.kind === 'criterion' && node.status === 'unproven' && !node.warning) problems.push(`${name} is unproven and does not say why.`)
    for (const field of ['proof', 'warning'] as const) {
      if (node[field] !== undefined && !isCleanProse(node[field], HOST_TEXT_LIMIT)) problems.push(`${name}: ${field} must be plain text.`)
    }
    if (node.io !== undefined && (!isRecord(node.io) || !isCleanProse(node.io.in, PROSE_LIMIT.io) || !isCleanProse(node.io.out, PROSE_LIMIT.io))) problems.push(`${name}: what goes in and out must be plain text.`)
    if (node.stats !== undefined && (!isRecord(node.stats) || !isCount(node.stats.additions) || !isCount(node.stats.deletions))) problems.push(`${name} must count its added and removed lines.`)
    if (node.lifecycle !== undefined && (node.kind !== 'context' || !isRecord(node.lifecycle) || !['caller', 'callee'].includes(node.lifecycle.role) || !isLine(node.lifecycle.hops) || node.lifecycle.hops > 9)) {
      problems.push(`${name}: only context has a place in the life cycle, as a caller or a callee some calls away.`)
    }
    if (node.entry !== undefined && (!['code', 'context'].includes(node.kind) || !isRecord(node.entry) || typeof node.entry.kind !== 'string' || !/^[a-z][a-z-]{0,31}$/.test(node.entry.kind) || typeof node.entry.exact !== 'boolean')) {
      problems.push(`${name}: an entry point is code or context, with a kind and whether it is exact.`)
    }
    if (!isRecord(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) problems.push(`${name} has no place on the graph.`)
    if (!Array.isArray(node.anchors)) {
      problems.push(`${name} must list its anchors.`)
      continue
    }
    for (const anchor of node.anchors) {
      if (!isRecord(anchor) || !isLine(anchor.startLine) || !isLine(anchor.endLine) || anchor.endLine < anchor.startLine || !['added', 'deleted'].includes(anchor.side)) {
        problems.push(`${name} has an anchor that is not an ordered range of lines on one side.`)
      } else if (!fileIds.has(anchor.fileId)) problems.push(`${name} points into ${anchor.fileId}, which is not a file of this review.`)
      else if (typeof anchor.hash !== 'string' || !HASH.test(anchor.hash)) problems.push(`${name} has an anchor without a hash of its lines.`)
    }
  }

  const placed = [...nodes.values()].filter((node) => NODE_KINDS.includes(node.kind) && isRecord(node.position))
  for (let first = 0; first < placed.length; first += 1) {
    for (let second = first + 1; second < placed.length; second += 1) {
      const [a, b] = [placed[first]!, placed[second]!]
      const [sizeA, sizeB] = [NODE_SIZE[a.kind], NODE_SIZE[b.kind]]
      const apart = a.position.x + sizeA.width <= b.position.x || b.position.x + sizeB.width <= a.position.x || a.position.y + sizeA.height <= b.position.y || b.position.y + sizeB.height <= a.position.y
      if (!apart) problems.push(`Nodes ${a.id} and ${b.id} overlap.`)
    }
  }

  const edges = new Map<string, ReviewEdge>()
  const joined = new Set<string>()
  for (const edge of review.edges) {
    if (!isRecord(edge) || typeof edge.id !== 'string' || !edge.id) {
      problems.push('A wire has no id.')
      continue
    }
    const name = `Wire ${edge.id}`
    if (edges.has(edge.id)) problems.push(`Wire id ${edge.id} is used twice.`)
    edges.set(edge.id, edge)
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (!from) problems.push(`${name} starts at ${String(edge.from)}, which is not a node.`)
    if (!to) problems.push(`${name} ends at ${String(edge.to)}, which is not a node.`)
    if (!EDGE_KINDS.includes(edge.kind)) problems.push(`${name} has an unknown kind.`)
    else if (from && to && NODE_KINDS.includes(from.kind) && NODE_KINDS.includes(to.kind)) {
      const impossible = wireProblem(edge.kind, from.kind, to.kind)
      if (edge.from === edge.to) problems.push(`${name} joins a node to itself.`)
      else if (impossible) problems.push(`${name}: ${impossible}.`)
    }
    if (edge.certainty !== 'host' && edge.certainty !== 'model') problems.push(`${name} must say whether the host or the model drew it.`)
    if (edge.label !== undefined && (!isCleanProse(edge.label, PROSE_LIMIT.label) || !edge.label)) problems.push(`${name}: the label is empty, has control characters or is too long.`)
    if (joined.has(`${edge.from}>${edge.to}`)) problems.push(`${name} repeats a wire between the same two nodes.`)
    joined.add(`${edge.from}>${edge.to}`)
  }

  const pathIds = new Set<string>()
  if (review.paths !== undefined) {
    if (!Array.isArray(review.paths)) problems.push('paths must be a list.')
    else
      for (const path of review.paths) {
        if (!isRecord(path) || typeof path.id !== 'string' || !path.id || !Array.isArray(path.hops)) {
          problems.push('A path has no id or no hops.')
          continue
        }
        if (pathIds.has(path.id)) problems.push(`Path id ${path.id} is used twice.`)
        pathIds.add(path.id)
        if (nodes.get(path.test)?.kind !== 'test' || path.hops[0] !== path.test) problems.push(`Path ${path.id} must start at a test, and ${String(path.test)} is not one.`)
        for (const hop of path.hops) if (!nodes.has(hop)) problems.push(`Path ${path.id} goes through ${String(hop)}, which is not a node.`)
      }
  }

  const criteria = new Set([...nodes.values()].filter((node) => node.kind === 'criterion').map((node) => node.id))
  const focused = new Set<string>()
  const stepIds = new Set<string>()
  const steps = review.story
  if (steps.length === 0) problems.push('The story has no steps.')
  steps.forEach((step, index) => {
    if (!isRecord(step) || typeof step.id !== 'string' || !step.id || !Array.isArray(step.focus) || !Array.isArray(step.criteria)) {
      problems.push(`Step ${index + 1} is not a step.`)
      return
    }
    const name = `Step ${step.id}`
    if (stepIds.has(step.id)) problems.push(`Step id ${step.id} is used twice.`)
    stepIds.add(step.id)
    if (index === 0 ? step.kind !== 'outcome' : step.kind === 'outcome') problems.push('The first step, and only the first, presents the outcome.')
    if (step.kind === 'closing' && index !== steps.length - 1) problems.push('Only the last step may close the story.')
    if (!['outcome', 'walk', 'closing'].includes(step.kind)) problems.push(`${name} has an unknown kind.`)
    if (!isCleanProse(step.title, PROSE_LIMIT.title) || !step.title) problems.push(`${name}: the title is empty, has control characters or is over ${PROSE_LIMIT.title} characters.`)
    if (!isCleanProse(step.text, step.kind === 'walk' ? PROSE_LIMIT.stepText : HOST_TEXT_LIMIT)) problems.push(`${name}: the text has control characters or is too long.`)
    for (const id of step.focus) {
      if (!nodes.has(id)) problems.push(`${name} focuses ${String(id)}, which is not a node.`)
      focused.add(id)
    }
    if (new Set(step.focus).size !== step.focus.length) problems.push(`${name} focuses a node twice.`)
    if (step.kind === 'walk' && (step.focus.length < 1 || step.focus.length > MAX_FOCUS)) problems.push(`${name} must focus one to ${MAX_FOCUS} nodes.`)
    if (step.kind !== 'walk' && step.focus.length > 0) problems.push(`${name} frames the whole graph and focuses no node.`)
    for (const id of step.criteria) if (!criteria.has(id)) problems.push(`${name} serves ${String(id)}, which is not an acceptance line of this review.`)
    if (step.path !== undefined && !pathIds.has(step.path)) problems.push(`${name} walks ${String(step.path)}, which is not a path of this review.`)
    if (step.travel !== undefined) {
      const edge = edges.get(step.travel)
      const previous = steps[index - 1]
      if (!edge) problems.push(`${name} rides ${String(step.travel)}, which is not a wire.`)
      else if (!previous || !connectingEdge([edge], previous.focus ?? [], step.focus)) problems.push(`${name} rides a wire that does not join it to the step before.`)
    }
  })
  for (const node of nodes.values()) if (!focused.has(node.id)) problems.push(`Node ${node.id} (${node.title}) is not the focus of any step.`)

  const closes = steps.at(-1)?.kind === 'closing'
  const hasClosing = Boolean(review.spec?.outOfScope.length || review.spec?.openQuestions.length || review.change.risk)
  if (hasClosing && !closes) problems.push('The last step must present what is out of scope, the risk and the open questions.')
  if (!hasClosing && closes) problems.push('The story closes on a step with nothing to present.')

  for (const notice of review.notices) if (!isCleanProse(notice, HOST_TEXT_LIMIT)) problems.push('A notice has control characters or is too long.')
  if (review.spec === null && !review.notices.includes(NO_SPEC_NOTICE)) problems.push('A review without a spec must say so.')
  return problems
}

/** A review that cannot be shown: it breaks its own rules, or the code it points at has changed. */
export class ReviewRefused extends Error {
  readonly reasons: readonly string[]

  constructor(message: string, reasons: readonly string[]) {
    super(message)
    this.name = 'ReviewRefused'
    this.reasons = reasons
  }
}

/** Reads one side of a file of the review: `added` at head, `deleted` at base. Null when it is not there. */
export type ReadSide = (fileId: string, side: AnchorSide) => string | null

/** The anchors whose lines are no longer what the review was prepared from. Empty when every hash holds. */
export function staleAnchors(review: Review, read: ReadSide): string[] {
  const pathOf = new Map(review.files.map((file) => [file.id, file]))
  const stale = new Set<string>()
  const texts = new Map<string, string | null>()
  for (const node of review.nodes) {
    for (const anchor of node.anchors) {
      const key = `${anchor.side}:${anchor.fileId}`
      if (!texts.has(key)) texts.set(key, read(anchor.fileId, anchor.side))
      const text = texts.get(key)
      const file = pathOf.get(anchor.fileId)
      const path = (anchor.side === 'deleted' ? file?.oldPath : undefined) ?? file?.path ?? anchor.fileId
      if (text == null) stale.add(`${path} is not there to read at ${anchor.side === 'added' ? 'head' : 'base'}`)
      else if (hashLines(text, anchor.startLine, anchor.endLine) !== anchor.hash) {
        stale.add(anchor.startLine === anchor.endLine ? `${path}, line ${anchor.startLine}` : `${path}, lines ${anchor.startLine} to ${anchor.endLine}`)
      }
    }
  }
  return [...stale]
}

/**
 * Opens a saved review. It is refused, with the reason, when it is not a valid review or when any anchor
 * no longer matches the bytes at its head. Anchors are compared exactly and never moved to fit new code.
 */
export function openReview(value: unknown, read: ReadSide): Review {
  const problems = validateReview(value)
  if (problems.length > 0) throw new ReviewRefused(`This is not a valid review file. ${problems[0]}${problems.length > 1 ? ` And ${problems.length - 1} more.` : ''}`, problems)
  const review = value as Review
  const stale = staleAnchors(review, read)
  if (stale.length > 0) {
    const shown = stale.slice(0, 3)
    const rest = stale.length - shown.length
    throw new ReviewRefused(`The saved review no longer matches the code. It was prepared from other bytes: ${listed(shown)}${rest > 0 ? `, and ${rest} more` : ''}.`, stale)
  }
  return review
}
