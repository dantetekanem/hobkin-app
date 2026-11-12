/**
 * hobkin says in its chat when a review is ready (spec 032): a finished change's change review, or a pull request's
 * review the user started. The line is one of hobkin's own notices, posted with no model turn, and it names the review
 * so the window can open it from the chat.
 */
import type { AssessmentSummary } from '#shared/review/assessment.ts'
import { targetOfReviewId } from '#shared/review/ids.ts'
import { count } from '#shared/review/prose.ts'

/** A review that became ready in this host. */
export interface ReadyReview {
  id: string
  kind: 'change' | 'pull'
  title: string
  project: string
  head: string
  /** When it became ready, as an ISO time. */
  at: string
  /** A finished change's change review: its level, and how many parts sit at each. */
  summary?: AssessmentSummary
}

const RISK = { high: 'high risk', mid: 'mid risk', safe: 'safe' } as const

/** What the chat says: which review, its level when it has one, and where to open it. */
export function readyLine({ id, kind, title, project, summary }: ReadyReview): string {
  if (kind === 'pull') {
    const target = targetOfReviewId(id)
    const name = target?.kind === 'pull' ? `${target.owner}/${target.repo}#${target.number}` : project
    return `The AI review of ${name} "${title}" is ready. Open it from Work › AI Reviews.`
  }
  const level = summary ? `: ${RISK[summary.level]}${summary.critical ? ', with something critical' : ''}` : ''
  const parts = summary ? partsLine(summary) : ''
  return `The change review of "${title}" in ${project} is ready${level}.${parts ? ` ${parts.charAt(0).toUpperCase()}${parts.slice(1)}.` : ''} Open it from its card in Work, or from Work › AI Reviews.`
}

/** How many parts need the user and how many are worth a look, as one clause. Empty when neither. */
function partsLine({ needsYou, worthALook }: AssessmentSummary): string {
  const clauses: string[] = []
  if (needsYou) clauses.push(`${count(needsYou, 'part')} ${needsYou === 1 ? 'needs' : 'need'} you`)
  if (worthALook) {
    // After a first clause the noun is already said, so only the number follows.
    const subject = needsYou ? worthALook : count(worthALook, 'part')
    clauses.push(`${subject} ${worthALook === 1 ? 'is' : 'are'} worth a look`)
  }
  return clauses.join(' and ')
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
