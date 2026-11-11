/**
 * hobkin's way through a review: the review as a map it can read, the lines of one node, and the words a message
 * carries when the user writes during a review. With these and `review.show` and `review.note`, hobkin can walk a
 * review node by node, move the user's view as it goes, and leave notes for the fix that follows.
 * Specs: 007-review-story (A10), 009-review-notes, 013-hobkin-access (A3).
 */
import { foldNotes, whereInWords, type NoteEntry } from '#shared/review/notes.ts'
import type { ReviewCode, ReviewMap } from '#shared/review/status.ts'
import type { Reviews } from './reviews.ts'

/** Every node, wire, path and step of a review, and its notes, without code ranges, hashes or places on the graph. */
export function reviewMap(reviews: Reviews, id: string): ReviewMap {
  const { review, notes, status } = reviews.get(id)
  return {
    id,
    title: review.change.title,
    summary: review.summary,
    head: review.change.head,
    outdated: status.stale,
    notices: review.notices,
    nodes: review.nodes.map(({ id: node, kind, title, subtitle, summary, io, status: state, warning }) => ({
      id: node,
      kind,
      title,
      ...(subtitle ? { path: subtitle } : {}),
      summary,
      ...(io ? { io } : {}),
      ...(state ? { status: state } : {}),
      ...(warning ? { warning } : {}),
    })),
    wires: review.edges.map(({ id: wire, from, to, kind, label, certainty }) => ({ id: wire, from, to, kind, ...(label ? { label } : {}), ...(certainty === 'model' ? { proposed: true as const } : {}) })),
    paths: review.paths ?? [],
    steps: review.story.map((step, index) => ({ step: index + 1, title: step.title, focus: step.focus, ...(step.path ? { path: step.path } : {}) })),
    notes: foldNotes(notes.entries as NoteEntry[]).map((note) => ({
      id: note.id,
      step: review.story.findIndex((step) => step.id === note.step) + 1,
      about: whereInWords(review, note),
      intent: note.intent,
      author: note.author,
      text: note.text,
      sent: note.sent != null,
    })),
  }
}

/** The most lines of one node hobkin reads at once. */
const MOST_LINES = 200

/** A node's own lines, numbered, side by side with which side of the change they are on. */
export function reviewCode(reviews: Reviews, id: string, nodeId: string): ReviewCode {
  const { review } = reviews.get(id)
  const node = review.nodes.find((entry) => entry.id === nodeId)
  if (!node) throw new Error(`This review has no node ${nodeId}.`)
  let left = MOST_LINES
  const parts = node.anchors.flatMap((anchor) => {
    if (left <= 0) return []
    const file = reviews.file(id, anchor.fileId)
    const lines = ((anchor.side === 'added' ? file.head : file.base) ?? '').split('\n').slice(anchor.startLine - 1, anchor.endLine)
    const shown = lines.slice(0, left)
    left -= shown.length
    const more = lines.length - shown.length
    const text = [...shown.map((line, index) => `${anchor.startLine + index} ${line}`), ...(more > 0 ? [`… ${more} more lines`] : [])].join('\n')
    return [{ side: anchor.side, startLine: anchor.startLine, endLine: anchor.endLine, text }]
  })
  return { node: node.id, title: node.title, ...(node.subtitle ? { path: node.subtitle } : {}), parts }
}

/**
 * What a message sent during a review carries to hobkin: where the user is, and how to work in the review. It goes
 * ahead of their words the way a report does, and the conversation shows it as what the message is about.
 */
export function reviewBrief(reviews: Reviews, { id, step, node }: { id: string; step?: string; node?: string }): { id: string; title: string; body: string } {
  let opened: ReturnType<Reviews['get']>
  try {
    opened = reviews.get(id)
  } catch {
    return { id: `review:${id}`, title: 'A review being prepared', body: `The user has the review ${id} open in hobkin, and it is still being prepared. Its map is not ready yet.` }
  }
  const { review, status } = opened
  const built = review.change.head.slice(0, 7)
  const index = step ? review.story.findIndex((entry) => entry.id === step) : -1
  const current = index >= 0 ? review.story[index] : undefined
  const stepName = current ? `step ${index + 1} of ${review.story.length}` : null
  const focused = node ? review.nodes.find((entry) => entry.id === node) : undefined

  const where = status.stale && status.head
    ? `It was built for commit ${built}, and the change has moved on to ${status.head.slice(0, 7)} since, so it is outdated until it is rebuilt.`
    : `It was built for commit ${built}, where the change is now.`

  let onStep: string | null = null
  if (current) {
    const path = current.path ? review.paths?.find((entry) => entry.id === current.path) : undefined
    const test = path ? (review.nodes.find((entry) => entry.id === path.test)?.title ?? path.test) : null
    onStep = `They are on ${stepName}: "${current.title}".${path ? ` It walks ${path.id}, the path of the test "${test}".` : ''}`
  }

  let onNode: string | null = null
  if (focused) {
    const place = focused.subtitle ? `${focused.kind}, ${focused.subtitle}` : focused.kind
    const flow = focused.io ? ` In: ${focused.io.in || 'nothing'}. Out: ${focused.io.out || 'nothing said'}.` : ''
    onNode = `Their focus is ${focused.id} ${focused.title} (${place}). ${focused.summary}${flow}`
  }

  const lines = [
    `The user is reviewing "${review.change.title}" in hobkin's Review screen (review id ${id}).`,
    where,
    ...(onStep ? [onStep] : []),
    ...(onNode ? [onNode] : []),
    '',
    'You can work in this review with the client tool: review.map {id} for every node, wire, path, step and note; review.code {id, node} for the lines of one node; review.show {id, step} or {id, node} to move the user\'s view; review.note {id, intent, text, and node, wire or step} to leave a note signed as you.',
    'Walk it one node at a time, following each test\'s path inward, and say what goes in and comes out at each hop. Leave a comment for every fix you would make. When the review is done, the user sends the comments to an agent from the review panel. You cannot send them yourself.',
  ]
  return {
    id: `review:${id}`,
    title: `Review "${review.change.title}"${stepName ? `, ${stepName}` : ''}`,
    body: lines.join('\n'),
  }
}
