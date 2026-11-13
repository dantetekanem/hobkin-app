import { useMemo } from 'react'
import { useSessionStore } from '../state/context.tsx'
import { askHobkin, type AskCommand } from './ask.ts'

/**
 * Asks hobkin from the review, as the review's input, the panel and the code panel do: about the step, and the node
 * given, else the one the reviewer is on. hobkin's chat comes into view to answer, and the keyboard stays in the
 * review. Null where hobkin is not connected, as in a sample review.
 */
export function useAskHobkin(ask: AskCommand | null, node?: string | null): ((text: string) => Promise<boolean>) | null {
  const store = useSessionStore()
  return useMemo(() => (ask ? (text: string) => askHobkin(store, ask, text, { node }) : null), [ask, node, store])
}
