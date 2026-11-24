import type { StoreApi } from 'zustand'
import type { NudgeAction, NudgeScreen } from '#shared/protocol/nudge.ts'
import { useChat } from '@/features/chat/chat-store.ts'
import { isPartScreen } from '@/integration/screens.ts'
import { hostStore } from '@/lib/host/client.ts'
import type { HostState } from '@/lib/host/state.ts'
import { travel } from './location.ts'
import { useView } from './view-store.ts'

/**
 * Carries out the one-shot instructions hobkin gives the window (`view.open`, `view.spotlight`, `view.back`,
 * `conversation.draft`): it moves the window or puts words in the composer, and never sends anything. Each
 * instruction has an id, so the window does each one once and nothing on a reconnect (`shared/protocol/nudge.ts`).
 */

/** Opens a screen the way the user reaches it: an integration's screens and the two overlays through their own openers, the rest straight. */
function openScreen(screen: string): void {
  const view = useView.getState()
  if (isPartScreen(screen)) return view.openPartScreen(screen)
  // Settings and Integrations are overlays that toggle, so open one only when it is not already the one showing.
  if (screen === 'settings') {
    if (view.screen !== 'settings') view.toggleSettings()
    return
  }
  if (screen === 'integrations') {
    if (view.screen !== 'integrations') view.toggleIntegrations()
    return
  }
  view.openScreen(screen as NudgeScreen)
}

/** Does one instruction. Navigation only moves the view; a draft only fills the composer, it is never sent. */
export function applyNudge(action: NudgeAction): void {
  switch (action.kind) {
    case 'open':
      openScreen(action.screen)
      return
    case 'spotlight':
      useView.getState().openSpotlight()
      return
    case 'back':
      travel(-1)
      return
    case 'draft':
      // 'typed' replaces the draft text and sends nothing. Sending stays a thing only the user does.
      useChat.getState().change({ type: 'typed', text: action.text })
      return
  }
}

/** Watches the host for new instructions and carries out each id once. A new connection starts the count over. */
export function watchNudge(host: Pick<StoreApi<HostState>, 'getState' | 'subscribe'>): () => void {
  let appliedId = 0
  let epoch: number | undefined
  const receive = () => {
    const { nudge, epoch: now } = host.getState()
    // A reconnect clears the instruction and restarts its ids, so the window never replays an old move or draft.
    if (epoch !== now) {
      appliedId = 0
      epoch = now
    }
    if (!nudge || nudge.id <= appliedId) return
    appliedId = nudge.id
    applyNudge(nudge.action)
  }
  const unsubscribe = host.subscribe(receive)
  receive()
  return unsubscribe
}

const stop = watchNudge(hostStore)
import.meta.hot?.dispose(stop)
