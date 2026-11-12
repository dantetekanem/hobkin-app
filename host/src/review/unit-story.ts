/**
 * A review's story once its change review is ready (spec 032): an opening with the change's claim, then one step per
 * unit of the change review, in the order its story walks the request, then the closing the review already had. Each
 * step tells its unit: its title (a claim), what changed, and its level. Its focus is the graph's nodes that hold the
 * unit's definitions: in the same file, on overlapping lines, at head, or at base for a definition the change removed.
 * Tests are never steps, and never in a step's focus.
 */
import type { StoryWords, Unit } from '#shared/review/assessment.ts'
import { cleanProse } from '#shared/review/prose.ts'
import { connectingEdge } from '#shared/review/story.ts'
import { HOST_TEXT_LIMIT, MAX_FOCUS, PROSE_LIMIT, type Review, type ReviewNode, type StoryStep } from '#shared/review/types.ts'

/** Where one node of the change review's graph sits: at head, or at base for one the change removed. */
export interface UnitPlace {
  id: string
  /** `function`, `general` or `test`. */
  kind: string
  path: string
  lines: [number, number]
  change: 'added' | 'modified' | 'removed' | 'none'
  /** A removed definition something still refers to: its lines say nothing, so only its file places it. */
  broken?: boolean
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
  const walks: StoryStep[] = ordered.map(({ unit }) => {
    const said = parts.words?.units?.[unit.id]
    const focus = focusOf(unit)
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
