import { COMPUTER_KINDS, type ComputerKind } from '#shared/protocol/setup.ts'

/**
 * Whether the first-run setup has been seen. Kept in the app's own storage for now, so it is per window profile,
 * not per hobkin home. See _specs/025-onboarding.
 *
 * `seen`: finished or skipped. `unfinished`, or `unfinished:work` with whose computer it is: told to the end with no
 * account, so the next launch opens it again at the account step.
 */

export const SETUP_KEY = 'hobkin-client-setup'
const SEEN = 'seen'
const UNFINISHED = 'unfinished'

/** The setup opens on the first run, while it is unfinished, and whenever the address asks for it with `?setup=1`, as in a browser tab. */
export function setupWanted(stored: string | null, search: string): boolean {
  if (new URLSearchParams(search).get('setup') === '1') return true
  return stored !== SEEN
}

/** How a setup ended: told to the end, or skipped. */
export type Ended = 'done' | 'skipped'

/** Told to the end with no account, it is unfinished. Skipping it, or ending it with an account, finishes it. */
export const endedAs = (ended: Ended, account: boolean): 'finished' | 'unfinished' => (ended === 'done' && !account ? 'unfinished' : 'finished')

/** The tour starts only for a setup that was told to the end and is finished. */
export const tourFollows = (ended: Ended, as: 'finished' | 'unfinished'): boolean => ended === 'done' && as === 'finished'

/** What is kept for how the setup ended. An unfinished one keeps whether the computer is personal or work. */
export function setupMark(as: 'finished' | 'unfinished', computer: ComputerKind | undefined): string {
  if (as === 'finished') return SEEN
  return computer ? `${UNFINISHED}:${computer}` : UNFINISHED
}

/** Where an unfinished setup starts again: at the account step, with the kind of computer it was. Null for any other mark. */
export function unfinishedStart(stored: string | null): { computer: ComputerKind | null } | null {
  if (stored === UNFINISHED) return { computer: null }
  const computer = stored?.startsWith(`${UNFINISHED}:`) ? COMPUTER_KINDS.find((kind) => stored === `${UNFINISHED}:${kind}`) : undefined
  return computer ? { computer } : null
}

function storedMark(): string | null {
  try {
    return localStorage.getItem(SETUP_KEY)
  } catch {
    // Storage can be unavailable. Then every load is a first run, which only shows the setup again.
    return null
  }
}

/** Whether to open the setup as the window loads. */
export function setupWantedNow(): boolean {
  return setupWanted(storedMark(), location.search)
}

/** The unfinished setup the window loaded with, or null. */
export function unfinishedNow(): { computer: ComputerKind | null } | null {
  return unfinishedStart(storedMark())
}

/** Keeps how the setup ended, so a finished or skipped one does not open by itself again and an unfinished one does. */
export function markSetupEnded(as: 'finished' | 'unfinished', computer?: ComputerKind): void {
  try {
    localStorage.setItem(SETUP_KEY, setupMark(as, computer))
  } catch {
    // As above: without storage nothing is kept, and the next load opens the setup again.
  }
}

/** Marks the setup seen, finished or skipped, so it does not open by itself again. */
export function markSetupSeen(): void {
  markSetupEnded('finished')
}
