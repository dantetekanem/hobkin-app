import type { CommandArgs, CommandResults } from '#shared/commands/registry.ts'
import type { AssessmentStatus } from '#shared/review/assessment.ts'
import type { ReviewStatus } from '#shared/review/status.ts'

/**
 * Following one card's change review (spec 032): the host is asked how it stands, and asked again while it is queued
 * or running, and "Review again" asks the host to run it once more. Without React, so it is tested alone; the card's
 * hook around it is `use-change-review.ts`.
 */

type FollowCommand = 'review.status' | 'review.prepare'

/** The two host commands a card's change review uses. */
export type ChangeReviewCommands = <Name extends FollowCommand>(name: Name, args: CommandArgs<Name>) => Promise<CommandResults[Name]>

/** How often a card asks while its change review is queued or running. */
const ASK_EVERY_MS = 5000
/** How often a card asks while its change review has not started: the host starts it in the background, a few at a time. */
const ASK_WHILE_IDLE_MS = 30_000

export function underWay(status: AssessmentStatus | undefined): boolean {
  return status?.state === 'queued' || status?.state === 'running'
}

/**
 * How a card's change review stands, from its review's status. While the host prepares the review itself, as it does
 * first when asked to review again, the change review it starts after that counts as queued. A host that runs no
 * change review says nothing of one, and neither does this.
 */
export function assessmentOf(status: ReviewStatus): AssessmentStatus | undefined {
  const { assessment } = status
  if (!assessment || !status.phase || underWay(assessment)) return assessment
  return { state: 'queued', head: status.head }
}

export interface ChangeReviewFollow {
  /** Asks the host to prepare the review again at the same commit, which runs its change review once more. Rejects with the host's reason. */
  again(): Promise<void>
  /** Asks nothing more, and drops any answer still on its way. */
  stop(): void
}

/**
 * Asks the host at once how the change review of review `id` stands, again every five seconds while it is queued or
 * running, and every thirty while it has not started. It stops asking once it is ready or failed, when the host runs
 * no change review, or once stopped. Only the newest answer is shown.
 */
export function followChangeReview({ id, run, onStatus }: { id: string; run: ChangeReviewCommands; onStatus: (status: AssessmentStatus | undefined) => void }): ChangeReviewFollow {
  let stopped = false
  let turn = 0
  let shown: AssessmentStatus | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const next = () => {
    clearTimeout(timer)
    const wait = underWay(shown) ? ASK_EVERY_MS : shown?.state === 'idle' ? ASK_WHILE_IDLE_MS : null
    timer = wait === null ? undefined : setTimeout(ask, wait)
  }
  const send = async (call: () => Promise<ReviewStatus>) => {
    const asked = ++turn
    try {
      const status = await call()
      if (stopped || asked !== turn) return
      shown = assessmentOf(status)
      onStatus(shown)
      next()
    } catch (error) {
      // What the card shows stays, and while it is under way the next turn asks again.
      if (!stopped && asked === turn) next()
      throw error
    }
  }
  function ask() {
    send(() => run('review.status', { id })).catch(() => {})
  }

  ask()
  return {
    again: () => send(() => run('review.prepare', { id, refresh: true })),
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}
