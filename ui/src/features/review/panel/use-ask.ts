import { useMemo } from 'react'
import { reviewMemory, useSession, useSessionStore } from '../state/context.tsx'
import { askHobkin, type AskCommand } from './ask.ts'
import type { ThreadEntry } from './thread.ts'

/**
 * Asks hobkin from the review, as every part of the panel and the code panel does: about the step, and the node given,
 * else the one the reviewer is on. The review keeps the message as soon as hobkin has it, so its conversation has it
 * when the review opens again. Null where hobkin is not connected, as in a sample review.
 */
export function useAskHobkin(ask: AskCommand | null, node?: string | null): ((text: string) => Promise<boolean>) | null {
  const store = useSessionStore()
  const review = useSession((session) => session.review)
  return useMemo(() => {
    if (!ask) return null
    const keep = (entry: ThreadEntry) => reviewMemory.getState().keepThread(review, [entry])
    return (text: string) => askHobkin(store, ask, text, { node, keep })
  }, [ask, node, review, store])
}
