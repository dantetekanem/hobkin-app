/**
 * What the reviewer has seen in a review (spec 053): a node is seen when its step was visited in the story, its code was
 * opened, or the reviewer marked it. A mark is kept by the node's code, not by its id: its name and the hashes of the
 * lines its anchors point at. So a newer commit that left a node's code as it was keeps its mark, and one that changed
 * it drops it, as reviewed marks expire when the code changes (https://docs.reviewable.io/files.html).
 */
import type { ReviewNode } from '#shared/review/types.ts'

/** The mark a node's seen state is kept by: its kind, its name, and its code, by the hashes of its anchors. */
export function markOf(node: Pick<ReviewNode, 'kind' | 'title' | 'subtitle' | 'anchors' | 'stats' | 'summary'>): string {
  const code = node.anchors.map((anchor) => `${anchor.side}:${anchor.hash}`).sort().join(',')
  // A node with no lines of its own, such as an acceptance line, is the same while its words are.
  return `${node.kind}:${node.title}#${code || `${node.subtitle ?? ''}:${node.summary}`}`
}

/** Each node of a review, by its id, to its mark. */
export function marksOf(nodes: readonly ReviewNode[]): Map<string, string> {
  return new Map(nodes.map((node) => [node.id, markOf(node)]))
}
