import type { CatchUpState } from '#shared/protocol/reports.ts'
import { Unavailable, type HostHandlers } from './commands.ts'

/**
 * The reports catch-up (069-report-catch-up): when hobkin writes one short report over the unread reports no catch-up
 * has covered, and the press that starts one now. All three are hobkin's own functions in `catch-up.mjs`; the host only
 * passes them on.
 */

/** hobkin's functions for the catch-up. Only a hobkin that has them has them. */
export interface CatchUpRuntime {
  readCatchUp?: (root: string) => Promise<CatchUpState> | CatchUpState
  setCatchUp?: (root: string, change: { daily?: string | null; pileUp?: number | null }) => Promise<CatchUpState> | CatchUpState
  startCatchUp?: (root: string, app: unknown) => Promise<{ message: string }> | { message: string }
}

/**
 * Loaded when asked, never at start, so an older hobkin without the module still lets the host start. The functions are
 * looked up on the module, not imported by name, so a module without one of them still loads.
 */
export async function loadHobkinCatchUp(): Promise<CatchUpRuntime> {
  try {
    return (await import('hobkin/src/cli/catch-up.mjs')) as CatchUpRuntime
  } catch {
    return {}
  }
}

/** The part of hobkin's application the catch-up needs: its home's folder, and a fresh read of its state. */
export interface CatchUpApp {
  runtime: { directory: string }
  refresh?: () => Promise<unknown>
}

export interface CatchUpSeat {
  /** hobkin's application. Throws, with the reason, while hobkin is not open in this host. */
  app: () => CatchUpApp
  runtime?: () => Promise<CatchUpRuntime> | CatchUpRuntime
}

const UNAVAILABLE = 'This hobkin cannot write a catch-up yet. Update hobkin.'

export function catchUpHandlers({ app, runtime = loadHobkinCatchUp }: CatchUpSeat): Pick<HostHandlers, 'reports.catchup.read' | 'reports.catchup.set' | 'reports.catchup.run'> {
  // The window shows the change at once. Without the read it catches up at hobkin's next change.
  const refresh = (current: CatchUpApp) => current.refresh?.().catch(() => {})
  return {
    'reports.catchup.read': async () => {
      const { readCatchUp } = await runtime()
      if (!readCatchUp) throw new Unavailable(UNAVAILABLE)
      return readCatchUp(app().runtime.directory)
    },
    'reports.catchup.set': async (change) => {
      const { setCatchUp } = await runtime()
      if (!setCatchUp) throw new Unavailable(UNAVAILABLE)
      const current = app()
      // hobkin's refusal is passed on as it said it.
      const saved = await setCatchUp(current.runtime.directory, change)
      await refresh(current)
      return saved
    },
    'reports.catchup.run': async () => {
      const { startCatchUp } = await runtime()
      if (!startCatchUp) throw new Unavailable(UNAVAILABLE)
      const current = app()
      const started = await startCatchUp(current.runtime.directory, current)
      await refresh(current)
      return { message: started.message }
    },
  }
}
