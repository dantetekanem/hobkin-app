/**
 * A review's story once its change review is ready (spec 032): an opening with the change's claim, then one step per
 * unit of the change review, in the order its story walks the request, then the closing the review already had. Each
 * step tells its unit: its title (a claim), what changed, and its level. Its focus is the graph's nodes that hold the
 * unit's definitions: in the same file, on overlapping lines, at head, or at base for a definition the change removed.
 * A step may hold several nodes, and the walk goes to each node once. Tests are never steps, and never in a step's focus.
 */
import type { StoryWords, Unit } from '#shared/review/assessment.ts'
import { testCovers } from '#shared/review/draft.ts'
import { cleanProse, listed } from '#shared/review/prose.ts'
import { connectingEdge } from '#shared/review/story.ts'
import { HOST_TEXT_LIMIT, MAX_FOCUS, PROSE_LIMIT, type NodeStatus, type Review, type ReviewNode, type StoryStep } from '#shared/review/types.ts'

/** Where one node of the change review's graph sits: at head, or at base for one the change removed. */
export interface UnitPlace {
  id: string
  /** `function`, `general` or `test`. */
  kind: string
  symbol?: string
  path: string
  lines: [number, number]
  change: 'added' | 'modified' | 'removed' | 'none'
  /** A removed definition something still refers to: its lines say nothing, so only its file places it. */
  broken?: boolean
}

/**
 * One run of test files the change review made: at head (`baseline`), with a definition put back (`revert`) or made to
 * fail (`probe`), or with a definition made to fail to see which request tests run through it (`reach`).
 */
export interface UnitRun {
  kind: string
  /** The definition a mutation run changed, by its id in the change review's graph. */
  node?: string
  tests: readonly string[]
  failed: readonly string[]
  /** Where in its test files the run failed, when its output said. A test of a failed file with no place here passed. */
  failed_at?: readonly { path: string; line: number }[]
}

export interface UnitStoryParts {
  units: readonly Unit[]
  places: readonly UnitPlace[]
  /** The words the story was written with, when the change review saved them. */
  words: StoryWords | null
  /** The story as Markdown: its heading and its "Does" line open the review when no words were saved. */
  story: string
  /** The change review's buckets, for a unit that holds files rather than definitions. */
  buckets: readonly { id: string; paths: readonly string[] }[]
}

export interface UnitWordsParts {
  units: readonly Unit[]
  places: readonly UnitPlace[]
  words: StoryWords | null
  /** Every test run the change review made. */
  runs: readonly UnitRun[]
  /** Why no test ran, when the change review says so. */
  notRun?: string
}

/** The graph's nodes of a definition of the change review's graph: the same file and overlapping lines, at head or at base. */
function holdsPlace(review: Review): (node: ReviewNode, place: UnitPlace) => boolean {
  const files = new Map(review.files.map((file) => [file.id, file]))
  return (node, place) => {
    const side = place.change === 'removed' ? 'deleted' : 'added'
    return node.anchors.some((anchor) => {
      const file = files.get(anchor.fileId)
      const path = side === 'deleted' ? (file?.oldPath ?? file?.path) : file?.path
      return anchor.side === side && path === place.path && anchor.startLine <= place.lines[1] && place.lines[0] <= anchor.endLine
    })
  }
}

/**
 * The graph's nodes in the change review's words. Code that belongs to a unit says what the unit says of it: its own
 * member line when the unit groups several, else the unit's "what changed". A test says what it covers and how the
 * change review's runs went: it proves the change (it fails when the change is put back), it fails at the change's
 * commit, it passes, or it was not run, and why. A test proves the change only when the run failed in that test: where
 * a run says which places failed, another test of the same file passed, and says so.
 */
export function unitWords(review: Review, parts: UnitWordsParts): ReviewNode[] {
  const holds = holdsPlace(review)
  const files = new Map(review.files.map((file) => [file.id, file]))
  const unitOf = new Map(parts.units.flatMap((unit) => unit.nodes.map((id) => [id, unit] as const)))
  const symbolOf = new Map(parts.places.map((place) => [place.id, place.symbol ?? place.id]))
  const code = parts.places.filter((place) => place.kind !== 'test' && !place.broken)
  return review.nodes.map((node) => {
    if (node.kind === 'code' || node.kind === 'file') {
      const place = code.find((entry) => unitOf.has(entry.id) && holds(node, entry))
      const unit = place && unitOf.get(place.id)
      if (!unit) return node
      const member = unit.members?.find((entry) => entry.node === place!.id)?.what
      const said = member ?? parts.words?.units?.[unit.id]?.what ?? unit.what
      return said ? { ...node, summary: cleanProse(said, PROSE_LIMIT.summary) } : node
    }
    if (node.kind !== 'test' || node.status == null || !node.subtitle) return node
    const path = node.subtitle
    const ran = parts.runs.filter((run) => run.tests.includes(path))
    const here = node.anchors.filter((anchor) => anchor.side !== 'deleted' && files.get(anchor.fileId)?.path === path)
    /** The run failed in this test: in its file, and at one of its own lines when the run says where it failed. */
    const failedIn = (run: UnitRun) =>
      run.failed.includes(path) && (run.failed_at == null || run.failed_at.some((at) => at.path === path && here.some((anchor) => anchor.startLine <= at.line && at.line <= anchor.endLine)))
    const namesOf = (kinds: readonly string[]) => [...new Set(ran.filter((run) => kinds.includes(run.kind) && run.node && failedIn(run)).map((run) => symbolOf.get(run.node!) ?? run.node!))]
    const failsAtHead = ran.some((run) => run.kind === 'baseline' && run.node == null && failedIn(run))
    const proves = namesOf(['revert', 'probe'])
    const reaches = namesOf(['reach'])
    const passes = ran.some((run) => run.kind === 'baseline' && !failedIn(run))
    const status: NodeStatus = failsAtHead ? 'failed' : proves.length ? 'proves-change' : passes ? 'passed' : 'not-run'
    const result = {
      failed: "It fails at the change's commit.",
      'proves-change': `It proves the change: it fails when ${listed(proves.slice(0, 2))}${proves.length > 2 ? ' and more' : ''} ${proves.length === 1 ? 'is' : 'are'} put back.`,
      passed: reaches.length
        ? `It runs through ${listed(reaches.slice(0, 2))} and passes, with the change and with it put back: it does not check the change itself.`
        : "It passes at the change's commit, and no change put back made it fail.",
      'not-run': `Not run${parts.notRun ? `: ${parts.notRun.replace(/\.$/, '')}` : ' by the change review'}.`,
    }[status as 'failed' | 'proves-change' | 'passed' | 'not-run']
    return { ...node, status, summary: cleanProse(`${testCovers(review.nodes, review.edges, node).said} ${result}`, PROSE_LIMIT.summary) }
  })
}

/** The opening's words from the story itself: its heading and its "Does" line. */
function openingOf(story: string): { title?: string; does?: string } {
  const lines = story.split('\n')
  const title = lines.find((line) => line.startsWith('# '))?.slice(2).trim()
  const does = lines.find((line) => line.startsWith('**Does:** '))?.slice('**Does:** '.length).trim()
  return { ...(title ? { title } : {}), ...(does ? { does } : {}) }
}

/** The graph's nodes that hold each unit's definitions, the unit's own first, at most `MAX_FOCUS`. */
function focusFinder(review: Review, parts: UnitStoryParts): (unit: Unit) => string[] {
  const files = new Map(review.files.map((file) => [file.id, file]))
  const changed = review.nodes.filter((node) => node.kind === 'code' || node.kind === 'file')
  const placeOf = new Map(parts.places.map((place) => [place.id, place]))
  const bucketPaths = new Map(parts.buckets.map((bucket) => [bucket.id, bucket.paths]))
  /** The path an anchor's lines are in, on its side: a renamed file is at its old path at base. */
  const pathAt = (fileId: string, side: 'added' | 'deleted') => {
    const file = files.get(fileId)
    return side === 'deleted' ? (file?.oldPath ?? file?.path) : file?.path
  }
  const holds = (node: ReviewNode, place: UnitPlace) => {
    const side = place.change === 'removed' ? 'deleted' : 'added'
    return node.anchors.some((anchor) => anchor.side === side && pathAt(anchor.fileId, side) === place.path && anchor.startLine <= place.lines[1] && place.lines[0] <= anchor.endLine)
  }
  return (unit) => {
    const focus: string[] = []
    const add = (id: string) => {
      if (!focus.includes(id)) focus.push(id)
    }
    const places = unit.nodes.flatMap((id) => {
      const place = placeOf.get(id)
      return place && place.kind !== 'test' ? [place] : []
    })
    for (const place of places.filter((entry) => !entry.broken)) for (const node of changed) if (holds(node, place)) add(node.id)
    // A unit of files, a broken reference, or definitions the graph shows only as whole files: the nodes of its files.
    if (focus.length === 0) {
      const paths = new Set([...(unit.buckets ?? []).flatMap((id) => bucketPaths.get(id) ?? []), ...places.map((place) => place.path)])
      for (const node of changed) if (node.subtitle && paths.has(node.subtitle)) add(node.id)
    }
    return focus.slice(0, MAX_FOCUS)
  }
}

/**
 * The story told as the change review's units. The opening takes the story's title and what the change does, a step
 * takes its unit's title and what changed (in the story's words where it has them) and its level, and the closing
 * stays as it was. Units go in the order the story walks: entry first, part by part.
 */
export function unitStory(review: Review, parts: UnitStoryParts): StoryStep[] {
  const outcome = review.story.find((step) => step.kind === 'outcome')
  const closing = review.story.find((step) => step.kind === 'closing')
  const told = openingOf(parts.story)
  const opening: StoryStep = {
    id: outcome?.id ?? 'outcome',
    kind: 'outcome',
    title: cleanProse(parts.words?.title ?? told.title ?? outcome?.title ?? review.change.title, PROSE_LIMIT.title) || 'This change',
    text: cleanProse(parts.words?.does ?? told.does ?? outcome?.text ?? '', HOST_TEXT_LIMIT),
    focus: [],
    criteria: [],
  }

  const criteria = new Set(review.nodes.filter((node) => node.kind === 'criterion').map((node) => node.id))
  /** The acceptance lines a focus serves: the ones wired to it. */
  const served = (focus: readonly string[]) => [...criteria].filter((id) => review.edges.some((edge) => edge.from === id && focus.includes(edge.to)))
  const focusOf = focusFinder(review, parts)
  const ordered = parts.units.map((unit, index) => ({ unit, index })).sort((a, b) => (a.unit.part ?? 1) - (b.unit.part ?? 1) || a.unit.story_order - b.unit.story_order || a.index - b.index)
  // The walk goes to each node once. A step may hold several nodes, and a node belongs to the first step that holds
  // it: a later step that would go back there keeps only what is its alone. A step left with nothing of its own goes
  // back to its nodes, so its code is told beside the node that holds it, never with the whole graph.
  const visited = new Set<string>()
  const walks: StoryStep[] = ordered.map(({ unit }) => {
    const said = parts.words?.units?.[unit.id]
    const own = focusOf(unit)
    const fresh = own.filter((id) => !visited.has(id))
    const focus = fresh.length ? fresh : own
    for (const id of focus) visited.add(id)
    return {
      id: `unit-${unit.id}`,
      kind: 'walk',
      title: cleanProse(said?.title ?? unit.title, PROSE_LIMIT.title),
      text: cleanProse(said?.what ?? unit.what, PROSE_LIMIT.stepText),
      focus,
      criteria: served(focus),
      level: unit.level,
      unit: unit.id,
    }
  })

  const steps = [opening, ...walks, ...(closing ? [closing] : [])]
  // The camera rides the wire that joins a step to the one before it, when there is one.
  return steps.map((step, index) => {
    const { travel: _travel, ...rest } = step
    const ride = index > 0 ? connectingEdge(review.edges, steps[index - 1]!.focus, step.focus) : undefined
    return ride ? { ...rest, travel: ride.edge.id } : rest
  })
}
