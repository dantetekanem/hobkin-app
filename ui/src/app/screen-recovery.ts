/**
 * What a canvas screen does when it fails to draw (`ScreenBoundary`). A screen never stays dead on its first failure:
 * it is drawn afresh by itself, which mends a draw that broke on what was mounted, as when a hot update changes a part's
 * hooks under it. Only a screen that fails again right after that shows what went wrong.
 */

/** A screen is drawn afresh by itself this many times within this long, and after that it shows the failure. */
export const RECOVERY = { tries: 1, withinMs: 5000 } as const

/**
 * What to do with a screen that failed to draw at `now`, given when it failed lately: `again` to draw it afresh, or not,
 * to show the failure. The failures it hands back are the ones still lately, with this one.
 */
export function afterFailure(failedAt: readonly number[], now: number): { again: boolean; failedAt: number[] } {
  const lately = failedAt.filter((at) => now - at < RECOVERY.withinMs)
  return { again: lately.length < RECOVERY.tries, failedAt: [...lately, now] }
}

/** The net's own name, where a failure's way out of the screen ends. */
const NET = 'ScreenBoundary'

// A frame of React's component stack, as this window's engine writes it (`Name@address`) and as a browser's does
// (`at Name (address)`). A tag such as `div` has no capital and is no part of the app.
const FRAME = /^\s*(?:at\s+)?([A-Z][\w$.]*)(?=@|\s|$)/

/**
 * The parts of the app a failure came through, the innermost first, from React's component stack: at most `most`,
 * and none from the net that caught it or above. They say where to look.
 */
export function failedIn(componentStack: string | null | undefined, most = 3): string[] {
  const parts: string[] = []
  for (const line of (componentStack ?? '').split('\n')) {
    const name = FRAME.exec(line)?.[1]
    if (!name) continue
    if (name === NET) break
    if (parts.length < most) parts.push(name)
  }
  return parts
}
