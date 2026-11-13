import { create } from 'zustand'
import { hobkinAgentId } from '#shared/protocol/hobkins.ts'
import { focusInput } from '@/app/focus.ts'
import { useView } from '@/app/view-store.ts'
import { hostStore, runCommand } from '@/lib/host/index.ts'
import { pressEnd, type Ending } from './conversation.ts'

/**
 * Ending a durable hobkin, after asking once (`034-durable-hobkins`). The End control on its page and Control+X go
 * through this one state, so a key after a click, or a click after a key, confirms. Leaving the page takes the ask back.
 */
interface EndState {
  /** The hobkin being asked about or ended. */
  id: string | null
  ending: Ending
  /** Why the last try to end it failed, in the host's words. */
  problem: string | null
}

export const useEnding = create<EndState>(() => ({ id: null, ending: 'no', problem: null }))

/** Where ending this hobkin stands. */
export const endingOf = (state: EndState, id: string): Ending => (state.id === id ? state.ending : 'no')

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Puts the keyboard on one of the page's End controls once the page has drawn it. */
function focusSoon(selector: string): void {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }))
}

/** End, or Control+X: the first press asks, a second while it asks ends it. False when the hobkin is not there to end. */
export function pressEndOf(id: string): boolean {
  if (!hostStore.getState().snapshot.hobkins?.some((hobkin) => hobkin.id === id)) return false
  const step = pressEnd(endingOf(useEnding.getState(), id))
  if (step === 'ask') {
    useEnding.setState({ id, ending: 'asking', problem: null })
    // As the ask opens the keyboard goes to Keep it, where Escape takes the ask back.
    focusSoon(`[data-end-keep="${id}"]`)
  } else if (step === 'end') void endHobkin(id)
  return true
}

/** The ask is taken back, unless it is ending already. `refocus` puts the keyboard on End again, as Keep it and Escape do. */
export function takeBackEnd(id: string, refocus: boolean): void {
  const state = useEnding.getState()
  if (state.id !== id || state.ending === 'busy') return
  useEnding.setState({ id: null, ending: 'no', problem: null })
  if (refocus) focusSoon(`[data-end-hobkin="${id}"]`)
}

async function endHobkin(id: string): Promise<void> {
  useEnding.setState({ id, ending: 'busy', problem: null })
  try {
    await runCommand('hobkin.end', { id })
  } catch (error) {
    // Still there: the ask stays, with the host's reason.
    if (useEnding.getState().id === id) useEnding.setState({ ending: 'asking', problem: message(error) })
    return
  }
  if (useEnding.getState().id === id) useEnding.setState({ id: null, ending: 'no', problem: null })
  // Ended, it has left the list: the page leaves too, and the keyboard goes home.
  const view = useView.getState()
  if (view.screen === 'agent' && view.openAgent === hobkinAgentId(id)) view.closeAgentCanvas()
  focusInput()
}
