import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { HobkinConversation, HobkinSummary } from '#shared/protocol/hobkins.ts'
import { runCommand } from '@/lib/host/client.ts'
import { reloadKey, seenToSend } from './conversation.ts'
import { pageShownId } from './page-shown.ts'
import { askOnce, keepPage, pageTickets, useKeptPage } from './page-store.ts'

/** What a read of the conversation came to: kept, outrun by a later read, or refused. */
type Answered = 'read' | 'stale' | { problem: string }

/**
 * Reads a hobkin's conversation for `key`, once however many pages ask while it is out, and keeps the answer with its
 * page unless a later read has answered first.
 */
function readConversation(id: string, key: string): Promise<Answered> {
  return askOnce(`read\n${id}\n${key}`, () => {
    const tickets = pageTickets(id)
    const ticket = tickets.begin()
    return runCommand('hobkin.read', { id }).then(
      (answer): Answered => {
        if (!tickets.accept(ticket)) return 'stale'
        keepPage(id, (page) => ({ ...page, conversation: answer, readAt: key }))
        return 'read'
      },
      (error: unknown): Answered => (tickets.accept(ticket) ? { problem: error instanceof Error ? error.message : String(error) } : 'stale'),
    )
  })
}

/**
 * A durable hobkin's conversation, read with `hobkin.read` when its page opens and again whenever its turns, its state or
 * what it said last change. It is kept with the page (`page-store.ts`), so a page opened again shows it at once and reads
 * it only if one of those changed since. An answer that comes back after a newer one is dropped. Null until the first
 * read answers.
 */
export function useConversation(
  id: string | null,
  hobkin: HobkinSummary | undefined,
  connected: boolean,
): { conversation: HobkinConversation | null; problem: string | null } {
  const { conversation, readAt } = useKeptPage(id)
  const [problem, setProblem] = useState<string | null>(null)
  const key = reloadKey(hobkin)

  useEffect(() => {
    if (!id || !connected || !key || readAt === key) return
    void readConversation(id, key).then((answered) => {
      if (answered !== 'stale') setProblem(answered === 'read' ? null : answered.problem)
    })
  }, [id, connected, key, readAt])

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
 * While the page is on screen and the hobkin waits unseen, tells the host once for that wait, so the agents list and the
 * notifications stop marking a wait the user saw.
 */
export function useMarkSeen(hobkin: HobkinSummary | undefined, onPage: boolean, connected: boolean): void {
  const shown = useWindowShown()
  const told = useRef<string | null>(null)
  const wait = connected ? seenToSend({ hobkin, onScreen: onPage && shown, told: told.current }) : null
  const id = hobkin?.id

  useEffect(() => {
    if (!wait || !id) return
    told.current = wait
    // A refusal leaves the wait marked unseen.
    runCommand('hobkin.seen', { id }).catch(() => {})
  }, [wait, id])
}

/**
 * While the page is on screen, the window is showing and the hobkin waits on Pi, tells the host, which starts that
 * hobkin's Pi process if none is kept (spec 034). It says so each time that becomes true again: the page opens, the
 * window shows again, or a turn ends. A refusal changes nothing.
 */
export function usePageShown(hobkin: HobkinSummary | undefined, onPage: boolean, connected: boolean): void {
  const shown = useWindowShown()
  const id = connected ? pageShownId({ onPage, windowShowing: shown, hobkin: hobkin ?? null }) : null
  useEffect(() => {
    if (id) runCommand('hobkin.shown', { id }).catch(() => {})
  }, [id])
}
