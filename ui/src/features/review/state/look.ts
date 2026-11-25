/**
 * The two looks of a review (spec 071). Graph is the review walked as a graph, in Story or Free Roam. Code is the change
 * as a diff, one file at a time, the way pi-coder's `/diff` shows it. The window's settings choose the look a review
 * opens in (`reviewView`), and I moves between the two. Pure, so what the code view reads of a review is tested without
 * a screen.
 */
import type { AnchorSide, ReviewFile, ReviewNode, StoryStep } from '#shared/review/types.ts'
import type { NoteTarget } from '../notes/notes.ts'

export type ReviewLook = 'graph' | 'code'

/** The code view's key, which goes back to the graph too: I, beside O and P, as Code sits beside Free Roam and Story on the switch. */
export const LOOK_KEY = 'I'

/** A saved look as the window reads it back: anything but Code is Graph, an older window's nothing among it. */
export const readLook = (value: unknown): ReviewLook => (value === 'code' ? 'code' : 'graph')

/** Lines of one side of a file. */
export interface DiffAt {
  side: AnchorSide
  startLine: number
  endLine: number
}

/** Whether the code view lists a file: one the change touched. A file in the review only for unchanged code shown in it is not. */
export const listed = (file: Pick<ReviewFile, 'status'>): boolean => file.status !== 'unchanged'

/** Code the change did not touch, shown for what it connects to. */
const untouched = (node: ReviewNode) => node.kind === 'context' && node.change === 'unchanged'

/**
 * The parts of the review in a file, in the review's order: those with lines in it, and a part with no lines that names
 * it, as a binary file's. Changed parts come first and unchanged code after, so the first is what a note about the file
 * is about.
 */
export function partsInFile(nodes: readonly ReviewNode[], file: Pick<ReviewFile, 'id' | 'path'>): ReviewNode[] {
  const inFile = nodes.filter((node) => node.anchors.some((anchor) => anchor.fileId === file.id) || (node.anchors.length === 0 && node.subtitle === file.path))
  return [...inFile.filter((node) => !untouched(node)), ...inFile.filter(untouched)]
}

/** The parts a file's seen mark stands for: its changed parts. */
export const partsToSee = (nodes: readonly ReviewNode[], file: Pick<ReviewFile, 'id' | 'path'>): ReviewNode[] => partsInFile(nodes, file).filter((node) => !untouched(node))

/** A file is seen once every changed part of the review in it is seen. A file with none is not. */
export function fileSeen(nodes: readonly ReviewNode[], file: Pick<ReviewFile, 'id' | 'path'>, seen: ReadonlySet<string>): boolean {
  const parts = partsToSee(nodes, file)
  return parts.length > 0 && parts.every((node) => seen.has(node.id))
}

/**
 * Where the code view shows a part: its first lines in a file it lists, or, for a part with no lines that names such a
 * file, that file alone. Null when the part's code is in no listed file.
 */
export function placeOfPart(node: ReviewNode, files: readonly ReviewFile[]): { fileId: string; at: DiffAt | null } | null {
  const shown = new Set(files.filter(listed).map((file) => file.id))
  const anchor = node.anchors.find((each) => shown.has(each.fileId))
  if (anchor) return { fileId: anchor.fileId, at: { side: anchor.side, startLine: anchor.startLine, endLine: anchor.endLine } }
  const named = node.anchors.length === 0 ? files.find((file) => listed(file) && file.path === node.subtitle) : undefined
  return named ? { fileId: named.id, at: null } : null
}

/**
 * The step a note taken in the code view is on, which says where it was taken when hobkin or an agent reads it: the
 * first step that shows its lines, else the first that shows its file; for a note about a part, the first step that
 * shows that part, else its file. Null when no step shows any of them. `expand` gives the parts a step's focus stands
 * for (a card's tests, a group's members), and `partOf` finds a part by its id.
 */
export function stepShowing(
  steps: readonly Pick<StoryStep, 'id' | 'focus'>[],
  expand: (id: string) => readonly string[],
  partOf: (id: string) => ReviewNode | undefined,
  target: NoteTarget,
): string | null {
  const shows = (step: Pick<StoryStep, 'focus'>) => step.focus.flatMap(expand)
  const first = (test: (node: ReviewNode) => boolean) => steps.find((step) => shows(step).some((id) => {
    const node = partOf(id)
    return node != null && test(node)
  }))?.id ?? null

  if (target.kind === 'lines') {
    const covers = (node: ReviewNode) => node.anchors.some((anchor) => anchor.fileId === target.fileId && anchor.side === target.side && anchor.startLine <= target.endLine && target.startLine <= anchor.endLine)
    return first(covers) ?? first((node) => node.anchors.some((anchor) => anchor.fileId === target.fileId))
  }
  if (target.kind === 'node') {
    const files = new Set(partOf(target.node)?.anchors.map((anchor) => anchor.fileId) ?? [])
    return steps.find((step) => shows(step).includes(target.node))?.id ?? first((node) => node.anchors.some((anchor) => files.has(anchor.fileId)))
  }
  return null
}
