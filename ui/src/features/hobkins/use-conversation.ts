import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { HobkinConversation, HobkinSummary } from '#shared/protocol/hobkins.ts'
import { runCommand } from '@/lib/host/client.ts'
import { latestWins, reloadKey, seenToSend } from './conversation.ts'

/**
 * A durable hobkin's conversation, read with `hobkin.read` when its page opens and again whenever its turns, its state or
 * what it said last change. An answer that comes back after a newer one is dropped. Null until the first read answers.
 */
export function useConversation(
  id: string | null,
  hobkin: HobkinSummary | undefined,
  connected: boolean,
): { conversation: HobkinConversation | null; problem: string | null } {
  const [conversation, setConversation] = useState<HobkinConversation | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const reads = useRef(latestWins())
  const key = reloadKey(hobkin)

  useEffect(() => {
    if (!id || !connected || !key) return
    const ticket = reads.current.begin()
    runCommand('hobkin.read', { id }).then(
      (answer) => {
        if (!reads.current.accept(ticket)) return
        setConversation(answer)
        setProblem(null)
      },
      (error: unknown) => {
        if (!reads.current.accept(ticket)) return
        setProblem(error instanceof Error ? error.message : String(error))
      },
    )
  }, [id, connected, key])

  return { conversation, problem }
}

const onVisibility = (changed: () => void) => {
  document.addEventListener('visibilitychange', changed)
  return () => document.removeEventListener('visibilitychange', changed)
}

/** The window is showing, not hidden or minimized. */
function useWindowShown(): boolean {
  return useSyncExternalStore(onVisibility, () => document.visibilityState === 'visible', () => true)
}

/**
 * While the page is on screen and the hobkin waits unseen, tells the host once for that wait, so the main hobkin does not
 * tell the user about a wait they saw.
 */
export function useMarkSeen(hobkin: HobkinSummary | undefined, onPage: boolean, connected: boolean): void {
  const shown = useWindowShown()
  const told = useRef<string | null>(null)
  const wait = connected ? seenToSend({ hobkin, onScreen: onPage && shown, told: told.current }) : null
  const id = hobkin?.id

  useEffect(() => {
    if (!wait || !id) return
    told.current = wait
    // A refusal leaves the wait to the main hobkin, which tells the user in the chat.
    runCommand('hobkin.seen', { id }).catch(() => {})
  }, [wait, id])
}
