import type { ReviewList } from '#shared/review/status.ts'
import { groupOf } from './ai-reviews.ts'

/**
 * Following the host's list of AI reviews (`review.list`) while a screen shows it: asked at once, again every two
 * seconds while a review runs, so its percent moves, and every ten otherwise, so one that starts shows up. Without
 * React, so it is tested alone; the screens' hook around it is `use-review-list.ts`.
 */

const ASK_WHILE_RUNNING_MS = 2_000
const ASK_OTHERWISE_MS = 10_000

export interface ReviewListFollow {
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
      running = list.reviews.some((item) => groupOf(item) === 'running')
      onList(list)
    } catch (error) {
      if (stopped || asked !== turn) return
      // What the screen shows stays, and the next turn asks again.
      onError(error instanceof Error ? error.message : String(error))
    }
    timer = setTimeout(() => void ask(), running ? ASK_WHILE_RUNNING_MS : ASK_OTHERWISE_MS)
  }

  void ask()
  return {
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}
