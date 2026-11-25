import type { ReviewList } from '#shared/review/status.ts'
import { isActive } from './ai-reviews.ts'
import { onAnyReviewStarted } from './review-started.ts'

/**
 * Following the host's list of AI reviews (`review.list`) while a screen shows it: asked at once, again every second
 * while a review runs, so its percent moves, and every three otherwise, so what changed elsewhere (a merge that landed,
 * a review the host started) shows without a wait. A review started anywhere in this window has it asked at once.
 * Without React, so it is tested alone; the screens' hook around it is `use-review-list.ts`.
 */

const ASK_WHILE_RUNNING_MS = 1_000
const ASK_OTHERWISE_MS = 3_000

export interface ReviewListFollow {
  /** Asks the host now, in place of the turn that was waiting: for when the user has just started a review. */
  askNow(): void
  /** Asks nothing more, and drops any answer still on its way. */
  stop(): void
}

export function followReviewList({ run, onList, onError }: { run: () => Promise<ReviewList>; onList: (list: ReviewList) => void; onError: (message: string) => void }): ReviewListFollow {
  let stopped = false
  let turn = 0
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const ask = async () => {
    const asked = ++turn
    try {
      const list = await run()
      if (stopped || asked !== turn) return
      running = list.reviews.some(isActive)
      onList(list)
    } catch (error) {
      if (stopped || asked !== turn) return
      // What the screen shows stays, and the next turn asks again.
      onError(error instanceof Error ? error.message : String(error))
    }
    timer = setTimeout(() => void ask(), running ? ASK_WHILE_RUNNING_MS : ASK_OTHERWISE_MS)
  }

  const askNow = () => {
    if (stopped) return
    clearTimeout(timer)
    void ask()
  }

  void ask()
  const stopHearing = onAnyReviewStarted(askNow)
  return {
    askNow,
    stop() {
      stopped = true
      clearTimeout(timer)
      stopHearing()
    },
  }
}
