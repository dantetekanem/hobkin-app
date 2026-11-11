/**
 * Pass 5 of preparing a review: check what the model returned, and complete what it left out.
 *
 * Unknown ids and impossible wires are corrected or dropped, context is verified against the files at head,
 * every node gets a story step, the story is framed, the graph is laid out, and the result must pass the validator.
 */
import { anchorOf, edgeId, unchangedFile, type Draft } from './draft.ts'
import { testPaths } from './flow.ts'
import { layoutReview } from './layout.ts'
import { readModelPass, type ModelContext } from './model.ts'
import { cleanProse, isSafePath, listed } from './prose.ts'
import { connectingEdge } from './story.ts'
import {
  EDGE_KINDS,
  HOST_TEXT_LIMIT,
  MAX_FOCUS,
  PROSE_LIMIT,
  type EdgeKind,
  type Review,
  type ReviewEdge,
  type ReviewFile,
  type ReviewNode,
  type StoryStep,
} from './types.ts'
import { findDeclaration } from './units.ts'
import { kindName, validateReview, wireProblem } from './validate.ts'

export interface Completed {
  review: Review
  /** What the host corrected or dropped from the model's output, in plain words, for the run's log. */
  corrections: string[]
}

/**
 * A wire written right to left is turned around when its kind allows one reading only:
 * a test proves a line, code implements a line, a test exercises code. A `calls` wire is never turned,
 * because turning it would say the opposite.
 */
const TURNABLE: ReadonlySet<EdgeKind> = new Set(['proves', 'implements', 'exercises'])

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export async function completeReview(draft: Draft, modelOutput?: unknown): Promise<Completed> {
  const { input, spec } = draft
  const { capture } = input
  const model = readModelPass(modelOutput)
  const corrections: string[] = []

  let nodes: ReviewNode[] = draft.nodes.map((node) => ({ ...node, anchors: [...node.anchors] }))
  const edges: ReviewEdge[] = draft.edges.map((edge) => ({ ...edge }))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const extraFiles = new Map<string, ReviewFile>(draft.files.filter((file) => file.status === 'unchanged').map((file) => [file.id, file]))
  const titleOf = (id: string) => byId.get(id)?.title ?? id

  // Summaries. An acceptance line keeps its own words.
  for (const [id, summary] of model.summaries) {
    const node = byId.get(id)
    if (!node) corrections.push(`A summary names ${id}, which is not a node. It was dropped.`)
    else if (node.kind !== 'criterion') node.summary = summary
  }

  // Context the model found, verified against the files at head.
  const alias = new Map<string, string>()
  let contexts = 0
  for (const proposal of model.context) {
    const verified = await verifyContext(proposal)
    if (typeof verified === 'string') corrections.push(verified)
  }

  async function verifyContext(proposal: ModelContext): Promise<string | undefined> {
    const { id, path, symbol } = proposal
    const named = `Context ${symbol || id}`
    if (byId.has(id) || alias.has(id)) return `${named} uses the id ${id}, which is taken. It was dropped.`
    if (!isSafePath(path)) return `${named} names ${path || 'no file'}, which is not a path inside the repository. It was dropped.`
    if (!symbol) return `Context in ${path} names no symbol. It was dropped.`

    const captured = capture.files.find((file) => file.path === path)
    const text = captured ? captured.head : (draft.headFiles.get(path) ?? (await input.readHead(path)))
    if (text == null) return `${named}: ${path} is not at head. It was dropped.`
    const found = findDeclaration(text, symbol)
    if (!found) return `${named} is not declared in ${path} at head. It was dropped.`

    // Lines this change touched are a node of the change already, not context.
    const touched = captured != null && capture.changes.some((change) => change.fileId === captured.id && change.side === 'added' && change.startLine <= found.endLine && found.startLine <= change.endLine)
    if (touched) {
      const unit = nodes.find((node) => node.title === symbol && node.anchors.some((anchor) => anchor.fileId === captured.id && anchor.side === 'added' && anchor.startLine <= found.endLine && found.startLine <= anchor.endLine))
      if (!unit) return `${named} in ${path} is part of the change, not context. It was dropped.`
      alias.set(id, unit.id)
      return `${named} in ${path} is part of the change. Its wires go to ${unit.id} instead.`
    }

    const fileId = captured?.id ?? path
    if (!captured) {
      draft.headFiles.set(path, text)
      extraFiles.set(path, unchangedFile(path))
    }
    const node: ReviewNode = {
      id: `c${(contexts += 1)}`,
      kind: 'context',
      title: symbol,
      subtitle: path,
      change: 'unchanged',
      summary: proposal.summary || 'Unchanged code that this change leans on.',
      anchors: [anchorOf(text, { fileId, side: 'added', ...found })],
      position: { x: 0, y: 0 },
    }
    nodes.push(node)
    byId.set(node.id, node)
    alias.set(id, node.id)
    return undefined
  }

  const resolve = (id: string) => alias.get(id) ?? (byId.has(id) ? id : undefined)

  // What goes in and comes out, in the model's words where it has them, the host's signature where it has not.
  // Read after context, so the model can name context it found by its own id.
  for (const [id, words] of model.io) {
    const node = byId.get(resolve(id) ?? '')
    if (!node) corrections.push(`What goes in and out names ${id}, which is not a node. It was dropped.`)
    else if (node.kind !== 'criterion') node.io = { in: words.in || node.io?.in || '', out: words.out || node.io?.out || '' }
  }

  // Wires the model proposed.
  const joined = new Map(edges.map((edge) => [`${edge.from}>${edge.to}`, edge]))
  for (const proposal of model.wires) {
    let from = resolve(proposal.from)
    let to = resolve(proposal.to)
    if (!from || !to) {
      corrections.push(`A wire names ${!from ? proposal.from || 'nothing' : proposal.to || 'nothing'}, which is not a node. It was dropped.`)
      continue
    }
    if (!(EDGE_KINDS as readonly string[]).includes(proposal.kind)) {
      corrections.push(`A wire from ${titleOf(from)} to ${titleOf(to)} has the unknown kind "${proposal.kind}". It was dropped.`)
      continue
    }
    const kind = proposal.kind as EdgeKind
    if (from === to) {
      corrections.push(`A ${kind} wire joins ${titleOf(from)} to itself. It was dropped.`)
      continue
    }
    const kinds = () => [byId.get(from!)!.kind, byId.get(to!)!.kind] as const
    if (wireProblem(kind, ...kinds())) {
      const [left, right] = kinds()
      if (TURNABLE.has(kind) && !wireProblem(kind, right, left)) {
        ;[from, to] = [to, from]
        corrections.push(`A ${kind} wire was written right to left. It now runs from ${titleOf(from)} to ${titleOf(to)}.`)
      } else {
        corrections.push(`A ${kind} wire cannot join ${kindName(left)} to ${kindName(right)}: ${titleOf(from)} to ${titleOf(to)}. It was dropped.`)
        continue
      }
    }
    const existing = joined.get(`${from}>${to}`)
    if (existing) {
      // The wire is already there. The model's words for it are still worth keeping.
      if (!existing.label && proposal.label) existing.label = proposal.label
      continue
    }
    const edge: ReviewEdge = { id: edgeId(kind, from, to), from, to, kind, ...(proposal.label ? { label: proposal.label } : {}), certainty: 'model' }
    edges.push(edge)
    joined.set(`${from}>${to}`, edge)
  }

  // Context that nothing connects to explains nothing.
  const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]))
  for (const node of nodes.filter((entry) => entry.kind === 'context' && !connected.has(entry.id))) {
    corrections.push(`Context ${node.title} in ${node.subtitle} connects to nothing. It was dropped.`)
    byId.delete(node.id)
    for (const [key, value] of alias) if (value === node.id) alias.delete(key)
  }
  nodes = nodes.filter((node) => byId.has(node.id))

  const paths = testPaths(nodes, edges)
  const story = buildStory()

  function buildStory(): StoryStep[] {
    const criteria = new Set(nodes.filter((node) => node.kind === 'criterion').map((node) => node.id))
    const specSteps = new Set(spec?.steps.filter((step) => !step.retired).map((step) => step.id))
    const steps: StoryStep[] = [
      {
        id: 'outcome',
        kind: 'outcome',
        title: cleanProse(input.change.title, PROSE_LIMIT.title) || 'This change',
        text: spec ? cleanProse(spec.outcome, HOST_TEXT_LIMIT) : model.summary || 'This change has no spec, so the story follows its code.',
        focus: [],
        criteria: [],
      },
    ]

    /** The acceptance lines a focus serves: the ones in it, and the ones wired to it. */
    const served = (focus: readonly string[]) => {
      const inFocus = new Set(focus)
      return [...criteria].filter((id) => inFocus.has(id) || edges.some((edge) => edge.from === id && inFocus.has(edge.to)))
    }
    const walk = (focus: string[], title: string, text: string, given: readonly string[] = [], specStep?: string, path?: string) => {
      steps.push({ id: `s${steps.length}`, kind: 'walk', title, text, focus, criteria: given.length > 0 ? [...given] : served(focus), ...(specStep ? { specStep } : {}), ...(path ? { path } : {}) })
    }
    const pathIds = new Set(paths.map((path) => path.id))
    const hostTitle = (focus: readonly string[]) => cleanProse(listed(focus.map(titleOf)), PROSE_LIMIT.title)
    const hostText = (focus: readonly string[]) =>
      cleanProse(focus.length === 1 ? byId.get(focus[0]!)!.summary : focus.map((id) => `${titleOf(id)}: ${byId.get(id)!.summary}`).join(' '), PROSE_LIMIT.stepText)

    for (const proposal of model.story) {
      const named = proposal.title ? `Step "${proposal.title}"` : 'A step'
      const focus: string[] = []
      for (const id of proposal.focus) {
        const node = resolve(id)
        if (!node) corrections.push(`${named} focuses ${id}, which is not a node. That id was dropped.`)
        else if (!focus.includes(node)) focus.push(node)
      }
      if (focus.length === 0) {
        corrections.push(`${named} focuses no node of this change. It was dropped.`)
        continue
      }
      if (focus.length > MAX_FOCUS) corrections.push(`${named} focuses ${focus.length} nodes. It keeps the first ${MAX_FOCUS}.`)
      const kept = focus.slice(0, MAX_FOCUS)
      const known = proposal.criteria.filter((id) => criteria.has(id))
      for (const id of proposal.criteria) if (!criteria.has(id)) corrections.push(`${named} serves ${id}, which is not an acceptance line. That id was dropped.`)
      if (proposal.specStep && !specSteps.has(proposal.specStep)) corrections.push(`${named} names the spec step ${proposal.specStep}, which the spec does not have. It was dropped.`)
      if (proposal.path && !pathIds.has(proposal.path)) corrections.push(`${named} walks the path ${proposal.path}, which this review does not have. It was dropped.`)
      walk(kept, proposal.title || hostTitle(kept), proposal.text, known, specSteps.has(proposal.specStep) ? proposal.specStep : undefined, pathIds.has(proposal.path) ? proposal.path : undefined)
    }

    // Whatever the model left out still gets a step, so no node is outside the story.
    const pending = new Set(nodes.map((node) => node.id))
    for (const step of steps) for (const id of step.focus) pending.delete(id)
    const take = (ids: readonly string[]) => {
      const taken = ids.filter((id) => pending.has(id)).slice(0, MAX_FOCUS)
      for (const id of taken) pending.delete(id)
      return taken
    }
    const follow = (id: string, kind: EdgeKind, direction: 'from' | 'to') =>
      edges.filter((edge) => edge.kind === kind && edge[direction] === id).map((edge) => edge[direction === 'from' ? 'to' : 'from'])

    // Tests first: each test's path, hop by hop, with the acceptance lines the test proves beside it.
    for (const path of paths) {
      path.hops.forEach((hop, index) => {
        if (!pending.has(hop)) return
        const focus = take(index === 0 ? [hop, ...follow(hop, 'proves', 'to')] : [hop])
        walk(focus, hostTitle(focus), hostText(focus), [], undefined, path.id)
      })
    }
    // An acceptance line goes with the tests that prove it, and code with the tests that exercise it.
    for (const node of nodes) {
      if (!pending.has(node.id)) continue
      if (node.kind === 'criterion') {
        const focus = take([node.id, ...follow(node.id, 'proves', 'from')])
        walk(focus, hostTitle(focus), hostText(focus))
      } else if (node.kind === 'code') {
        const focus = take([node.id, ...follow(node.id, 'exercises', 'to')])
        walk(focus, hostTitle(focus), hostText(focus))
      }
    }
    // The rest go in small groups of one kind: tests of one file together, then files, then context.
    for (const kind of ['test', 'file', 'context'] as const) {
      const left = nodes.filter((node) => node.kind === kind && pending.has(node.id))
      const groups = new Map<string, string[]>()
      for (const node of left) {
        const key = kind === 'test' ? (node.subtitle ?? '') : ''
        groups.set(key, [...(groups.get(key) ?? []), node.id])
      }
      for (const ids of groups.values()) {
        for (let focus = take(ids); focus.length > 0; focus = take(ids)) walk(focus, hostTitle(focus), hostText(focus))
      }
    }

    const parts = [spec?.outOfScope.length ? 'out of scope' : '', input.change.risk ? 'the risk' : '', spec?.openQuestions.length ? 'open questions' : ''].filter(Boolean)
    if (parts.length > 0) steps.push({ id: 'closing', kind: 'closing', title: capitalized(listed(parts)), text: model.closing, focus: [], criteria: [] })

    for (let index = 1; index < steps.length; index += 1) {
      const ride = connectingEdge(edges, steps[index - 1]!.focus, steps[index]!.focus)
      if (ride) steps[index]!.travel = ride.edge.id
    }
    return steps
  }

  const positions = layoutReview(nodes, edges)
  for (const node of nodes) node.position = positions[node.id]!

  // Unchanged files stay listed only while a node still points into them.
  const referenced = new Set(nodes.flatMap((node) => node.anchors.map((anchor) => anchor.fileId)))
  const files = [...draft.files.filter((file) => file.status !== 'unchanged'), ...[...extraFiles.values()].filter((file) => referenced.has(file.id))]

  const review: Review = {
    version: 1,
    id: input.id,
    change: {
      project: input.change.project,
      item: input.change.item,
      title: cleanProse(input.change.title, 300),
      branch: input.change.branch,
      base: capture.base,
      head: capture.head,
      additions: capture.additions,
      deletions: capture.deletions,
      files: capture.files.length,
      ...(input.change.risk ? { risk: cleanProse(input.change.risk, HOST_TEXT_LIMIT) } : {}),
    },
    snapshot: capture.fingerprint,
    spec: spec && input.spec ? { path: input.spec.path, outcome: cleanProse(spec.outcome, HOST_TEXT_LIMIT), outOfScope: spec.outOfScope, openQuestions: spec.openQuestions } : null,
    files,
    nodes,
    edges,
    story,
    paths,
    summary: model.summary || cleanProse(input.change.title, PROSE_LIMIT.stepText),
    notices: draft.notices,
  }

  const problems = validateReview(review)
  if (problems.length > 0) throw new Error(`The prepared review is not valid: ${problems.join(' ')}`)
  return { review, corrections }
}
