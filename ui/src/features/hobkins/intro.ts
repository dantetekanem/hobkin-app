/**
 * Whether the New hobkin sheet has explained what a durable hobkin is. The first Command+N explains before it asks
 * anything, and later ones open on the form. Kept in the window's own storage, as the first-run setup keeps its own
 * (`onboarding/first-run.ts`). See _specs/034-durable-hobkins.
 */

export const INTRO_KEY = 'hobkin-client-hobkin-intro'
const SEEN = 'seen'

type Kept = Pick<Storage, 'getItem' | 'setItem'>

/** The window's storage, or nothing where there is none. */
const windowStorage = (): Kept | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage)

/** True once the explanation has been shown. Without storage it is never kept, so it shows again, which does no harm. */
export function introSeen(storage: Kept | undefined = windowStorage()): boolean {
  try {
    return storage?.getItem(INTRO_KEY) === SEEN
  } catch {
    return false
  }
}

/** Marks the explanation seen, so the next sheet opens on the form. */
export function markIntroSeen(storage: Kept | undefined = windowStorage()): void {
  try {
    storage?.setItem(INTRO_KEY, SEEN)
  } catch {
    // As above: nothing is kept, and the next sheet explains again.
  }
}
