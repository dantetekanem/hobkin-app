import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssessmentStatus } from '#shared/review/assessment.ts'
import { runCommand, useHost, type HostState } from '@/lib/host/index.ts'
import { followChangeReview, type ChangeReviewFollow } from './review-follow.ts'

/** The host's last answer, with what it answered: the review, the host, and the commit the card named when it asked. */
interface Answer {
  id: string
  home: HostState['home']
  /** Can be older than the commit the answer is of: the host reviews the commit the branch is at in git. */
  card: string | null
  status: AssessmentStatus
}

/**
 * A finished change's change review, for its card. The host is asked when the card mounts, again when the change moves
 * to another commit or another host answers, and every five seconds while the review is queued or running. With no
 * `id`, as for sample data, nothing is asked. `again` runs the change review once more at the change's commit.
 */
export function useChangeReview(id: string | null, head: string | null): { assessment: AssessmentStatus | undefined; again: () => Promise<void> } {
  const home = useHost((state) => state.home)
  const [last, setLast] = useState<Answer>()
  const follow = useRef<ChangeReviewFollow | null>(null)

  useEffect(() => {
    if (!id) return
    const following = followChangeReview({
      id,
      run: (name, args) => runCommand(name, args),
      onStatus: (status) => setLast(status ? { id, home, card: head, status } : undefined),
    })
    follow.current = following
    return () => {
      following.stop()
      if (follow.current === following) follow.current = null
    }
  }, [id, head, home])

  const again = useCallback(() => follow.current?.again() ?? Promise.reject(new Error('This change has no review to run again.')), [])
  // Render against the card's current commit, even before the next effect starts or if its request fails. The host
  // answers at the commit its branch is at in git, which is newer than the card's while hobkin has not looked at the
  // branch again, so the answer stands for the card it was asked for, whatever commit it is of.
  const matchesCard = last && last.id === id && last.home === home && last.card === head
  const assessment = matchesCard ? last.status : undefined
  return { assessment, again }
}
