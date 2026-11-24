/**
 * hobkin says in its chat when a review is ready (spec 032): the change review of a finished change, or of a pull
 * request the user started. The line is one of hobkin's own notices, posted with no model turn, and it names the review
 * so the window can open it from the chat.
 */
import { DEPLOY_WORDS, deployOf, deployWhy, type AssessmentSummary } from '#shared/review/assessment.ts'
import { targetOfReviewId } from '#shared/review/ids.ts'

/** A review that became ready in this host. */
export interface ReadyReview {
  id: string
  kind: 'change' | 'pull'
  title: string
  project: string
  head: string
  /** When it became ready, as an ISO time. */
  at: string
  /** Its change review: its level, and how many parts sit at each. */
  summary?: AssessmentSummary
}

/** What the chat says: which review, its answer for the whole change when it has one, why, and where to open it. */
export function readyLine({ id, kind, title, project, summary }: ReadyReview): string {
  const said = summary ? `: ${DEPLOY_WORDS[deployOf(summary)].toLowerCase()}. ${deployWhy(summary)}` : '.'
  if (kind === 'pull') {
    const target = targetOfReviewId(id)
    const name = target?.kind === 'pull' ? `${target.owner}/${target.repo}#${target.number}` : project
    return `The review of ${name} "${title}" is ready${said} Open it from Work › Ready for Review.`
  }
  return `The change review of "${title}" in ${project} is ready${said} Open it from its card in Work, or from Work › Ready for Review.`
}

type ClientNotices = typeof import('hobkin/src/cli/client-notices.mjs')

/**
 * Tells hobkin a review is ready, once for each time it became ready, and asks hobkin to show its chat again. While
 * hobkin is not open nothing is told: the line is only news, and the review opens from Work all the same. hobkin's
 * notices are loaded when first needed, so a hobkin checkout from before them still runs the host, only untold.
 */
export function chatTeller({
  data,
  refresh,
  log,
  notices = () => import('hobkin/src/cli/client-notices.mjs'),
}: {
  data: () => string
  refresh: () => void
  log?: (line: string) => void
  notices?: () => Promise<ClientNotices>
}): (ready: ReadyReview) => Promise<void> {
  let loaded: Promise<ClientNotices> | null = null
  return async (ready) => {
    try {
      const { postClientNotice } = await (loaded ??= notices())
      const key = `review-ready:${ready.id}@${ready.head.slice(0, 12)}:${ready.at}`
      if (postClientNotice(data(), { key, line: readyLine(ready), tone: 'useful', review: ready.id })) refresh()
    } catch (error) {
      log?.(`hobkin was not told that the review ${ready.id} is ready: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
