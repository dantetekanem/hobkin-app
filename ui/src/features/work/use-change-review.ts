import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssessmentStatus } from '#shared/review/assessment.ts'
import { runCommand, useHost } from '@/lib/host/index.ts'
import { followChangeReview, type ChangeReviewFollow } from './review-follow.ts'

/**
 * A finished change's change review, for its card. The host is asked when the card mounts, again when the change moves
 * to another commit or another host answers, and every five seconds while the review is queued or running. With no
 * `id`, as for sample data, nothing is asked. `again` runs the change review once more at the change's commit.
 */
export function useChangeReview(id: string | null, head: string | null): { assessment: AssessmentStatus | undefined; again: () => Promise<void> } {
  const home = useHost((state) => state.home)
  const [last, setLast] = useState<{ id: string; home: typeof home; status: AssessmentStatus }>()
  const follow = useRef<ChangeReviewFollow | null>(null)

  useEffect(() => {
    if (!id) return
    const following = followChangeReview({
      id,
      run: (name, args) => runCommand(name, args),
      onStatus: (status) => setLast(status ? { id, home, status } : undefined),
    })
    follow.current = following
    return () => {
      following.stop()
      if (follow.current === following) follow.current = null
    }
  }, [id, head, home])

  const again = useCallback(() => follow.current?.again() ?? Promise.reject(new Error('This change has no review to run again.')), [])
  // Render against the current commit, even before the next effect starts or if its request fails. A card that knows
  // no commit, such as a stack's layer hobkin did not list, takes the review as the host has it.
  const matchesCard = last && last.id === id && last.home === home && (head === null || last.status.head === head)
  const assessment = matchesCard ? last.status : undefined
  return { assessment, again }
}
