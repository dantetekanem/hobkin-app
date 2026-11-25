import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { hobkinAgentId } from '#shared/protocol/hobkins.ts'
import { focusInput } from '@/app/focus.ts'
import { useView } from '@/app/view-store.ts'
import { pressEnd, type Ending } from '@/features/hobkins/conversation.ts'
import { hostStore, runCommand } from '@/lib/host/index.ts'
import { runExecution } from './store.ts'
import { endTarget, type EndTarget } from './talk.ts'

/**
 * Ending an agent from its page, after asking once (`034-durable-hobkins`, `019-keyboard`): End on the page and
 * Control+X go through this one state, so a key after a click, or a click after a key, confirms. A durable hobkin ends
 * and leaves the list; a run is force stopped and its page stays to read. Leaving the page takes the ask back.
 */
interface EndState {
  /** The agent being asked about or ended, by the window's id for it. */
  agent: string | null
  ending: Ending
  /** Why the last try to end it failed, in the host's words. */
  problem: string | null
}

// Kept on the page, so a hot update of this file keeps an ask that is open instead of starting a second store.
const held = globalThis as { __hobkinEndAgent?: UseBoundStore<StoreApi<EndState>> }

export const useEnding = (held.__hobkinEndAgent ??= create<EndState>(() => ({ agent: null, ending: 'no', problem: null })))

/** Where ending this agent stands. */
export const endingOf = (state: EndState, agentId: string): Ending => (state.agent === agentId ? state.ending : 'no')

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Puts the keyboard on one of the page's End controls once the page has drawn it. */
function focusSoon(control: 'agent' | 'keep', agentId: string): void {
  const selector = `[data-end-${control}="${CSS.escape(agentId)}"]`
  requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }))
}

/** End, or Control+X: the first press asks, a second while it asks ends the agent. False when there is nothing to end. */
export function pressEndOf(agentId: string | null): boolean {
  if (!agentId) return false
  const target = endTarget(hostStore.getState(), agentId)
  if (!target) return false
  const step = pressEnd(endingOf(useEnding.getState(), agentId))
  if (step === 'ask') {
    useEnding.setState({ agent: agentId, ending: 'asking', problem: null })
    // As the ask opens the keyboard goes to Keep it, where Escape takes the ask back.
    focusSoon('keep', agentId)
  } else if (step === 'end') void endAgent(agentId, target)
  return true
}

/** The ask is taken back, unless it is ending already. `refocus` puts the keyboard on End again, as Keep it and Escape do. */
export function takeBackEnd(agentId: string, refocus: boolean): void {
  const state = useEnding.getState()
  if (state.agent !== agentId || state.ending === 'busy') return
  useEnding.setState({ agent: null, ending: 'no', problem: null })
  if (refocus) focusSoon('agent', agentId)
}

async function endAgent(agentId: string, target: EndTarget): Promise<void> {
  useEnding.setState({ agent: agentId, ending: 'busy', problem: null })
  try {
    if (target.kind === 'hobkin') await runCommand('hobkin.end', { id: target.id })
    else await runExecution(target.control, 'force')
  } catch (error) {
    // Still there: the ask stays, with the host's reason.
    if (useEnding.getState().agent === agentId) useEnding.setState({ ending: 'asking', problem: message(error) })
    return
  }
  if (useEnding.getState().agent === agentId) useEnding.setState({ agent: null, ending: 'no', problem: null })
  if (target.kind === 'run') return
  // An ended hobkin has left the list: its page leaves too, and the keyboard goes home.
  const view = useView.getState()
  if (view.screen === 'agent' && view.openAgent === hobkinAgentId(target.id)) view.closeAgentCanvas()
  focusInput()
}
