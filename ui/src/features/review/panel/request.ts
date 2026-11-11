/**
 * A verdict is a request to hobkin, in its main conversation. The review panel does nothing itself: it writes down
 * exactly what the reviewer decided, with the comments that go with it, and hobkin carries it out with its own tools
 * and its own confirmations. A finished hobkin change gets its pull request opened, is merged, or goes back to an
 * agent with the fixes. A pull request from GitHub gets a review there.
 */
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { Review } from '#shared/review/types.ts'
import { askForChanges, type Verdict } from '#shared/review/verdict.ts'
import type { Note } from '../notes/notes.ts'

export interface VerdictRequest {
  /** What hobkin is asked, in the reviewer's voice. */
  text: string
  /** The comments it carries, to be marked sent once hobkin has them. */
  sends: string[]
}

/** The request for a verdict, or null when there is nothing to ask: fixes without a comment, or a merge hobkin cannot do here. */
export function verdictRequest(review: Review, notes: readonly Note[], verdict: Verdict): VerdictRequest | null {
  const target = targetOfReviewId(review.id)
  if (!target) return null

  const comments = notes.filter((note) => note.intent === 'comment' && note.sent == null)
  const listed = askForChanges(review, comments, '')
  const carried = listed ? comments.map((note) => note.id) : []
  const commit = review.change.head.slice(0, 7)

  if (target.kind === 'change') {
    const change = `"${review.change.title}" (project ${review.change.project}, branch ${review.change.branch}, at commit ${commit})`
    switch (verdict) {
      case 'approve':
        // hobkin's own work action, pinned to the reviewed commit, so the change's card then waits on its PR.
        return { text: `I reviewed ${change} and approve it. Open its pull request: hobkin work publish ${target.slug} ${target.item} ${review.change.head}`, sends: [] }
      case 'approve-merge':
        return { text: `I reviewed ${change} and approve it. Merge it.`, sends: [] }
      case 'request-changes':
        if (!listed) return null
        return { text: `I reviewed ${change}. Send these fixes to an agent to make on its branch, and tell me when they are done:\n\n${listed}`, sends: carried }
      case 'comment':
        return null
    }
  }

  const pull = `${target.owner}/${target.repo}#${target.number}`
  const reviewed = `I reviewed ${pull}, "${review.change.title}", at commit ${commit}.`
  switch (verdict) {
    case 'approve':
      return listed
        ? { text: `${reviewed} Approve ${pull} on GitHub, with these comments:\n\n${listed}`, sends: carried }
        : { text: `${reviewed} Approve ${pull} on GitHub.`, sends: [] }
    case 'comment':
      if (!listed) return null
      return { text: `${reviewed} Post these comments on ${pull} on GitHub:\n\n${listed}`, sends: carried }
    case 'request-changes':
      if (!listed) return null
      return { text: `${reviewed} Request changes on ${pull} on GitHub with these comments:\n\n${listed}`, sends: carried }
    case 'approve-merge':
      return null
  }
}
