/**
 * Whether the first-run setup has been seen. Kept in the app's own storage for now, so it is per window profile,
 * not per hobkin home. See _specs/025-onboarding.
 */

export const SETUP_KEY = 'hobkin-client-setup'
const SEEN = 'seen'

/** The setup opens on the first run, and whenever the address asks for it with `?setup=1`, as in a browser tab. */
export function setupWanted(stored: string | null, search: string): boolean {
  if (new URLSearchParams(search).get('setup') === '1') return true
  return stored !== SEEN
}

/** Whether to open the setup as the window loads. */
export function setupWantedNow(): boolean {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(SETUP_KEY)
  } catch {
    // Storage can be unavailable. Then every load is a first run, which only shows the setup again.
  }
  return setupWanted(stored, location.search)
}

/** Marks the setup seen, finished or skipped, so it does not open by itself again. */
export function markSetupSeen(): void {
  try {
    localStorage.setItem(SETUP_KEY, SEEN)
  } catch {
    // As above: without storage nothing is kept, and the next load opens the setup again.
  }
}
