import { createStore } from 'zustand/vanilla'
import type { SchedulePause, ScheduleTarget } from '#shared/protocol/schedules.ts'

/**
 * What a live row of the schedules list does: Run now, Pause or Resume at once, and Cancel, which asks in place. The
 * first press of Cancel says "Click again to confirm", a second within ten seconds cancels, and after that it goes
 * back, as the review's verdicts do. A refusal from the host stays on the row until the next press. Pure, so it is
 * tested without a window or a host.
 */

export const CANCEL_CONFIRM_MS = 10_000

export type ScheduleAction = 'run' | 'pause' | 'resume' | 'cancel'

export type ScheduleCommand = 'schedule.cancel' | 'schedule.pause' | 'schedule.run'

/** Sends one of the window's schedule commands to the host, and settles with its answer or rejects with its reason. */
export type ScheduleSend = (name: ScheduleCommand, args: ScheduleTarget | SchedulePause) => Promise<unknown>

export interface ScheduleActionState {
  /** Cancel was pressed once and waits for the second press. */
  armed: boolean
  /** The action on its way to the host. */
  busy: ScheduleAction | null
  /** Why the host refused the last one. */
  refused: string | null
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createScheduleActions({ id, send }: { id: string; send: ScheduleSend }) {
  const store = createStore<ScheduleActionState>(() => ({ armed: false, busy: null, refused: null }))
  let waiting: ReturnType<typeof setTimeout> | undefined

  const disarm = () => {
    clearTimeout(waiting)
    waiting = undefined
    if (store.getState().armed) store.setState({ armed: false })
  }

  const commandOf = (action: Exclude<ScheduleAction, 'cancel'> | 'confirm'): [ScheduleCommand, ScheduleTarget | SchedulePause] => {
    if (action === 'run') return ['schedule.run', { id }]
    if (action === 'confirm') return ['schedule.cancel', { id }]
    return ['schedule.pause', { id, paused: action === 'pause' }]
  }

  const press = async (action: ScheduleAction): Promise<void> => {
    if (store.getState().busy) return
    if (action === 'cancel' && !store.getState().armed) {
      store.setState({ armed: true, refused: null })
      waiting = setTimeout(disarm, CANCEL_CONFIRM_MS)
      return
    }
    disarm()
    store.setState({ busy: action, refused: null })
    try {
      await send(...commandOf(action === 'cancel' ? 'confirm' : action))
    } catch (error) {
      store.setState({ refused: messageOf(error) })
    } finally {
      store.setState({ busy: null })
    }
  }

  return Object.assign(store, { press, disarm, dispose: disarm })
}

export type ScheduleActions = ReturnType<typeof createScheduleActions>
