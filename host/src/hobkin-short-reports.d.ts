/**
 * hobkin's switch for short reports (051-short-reports), typed here because hobkin ships plain JavaScript. Paths and
 * signatures are those of `~/Poetry/hobkin` on `main`. hobkin stays the owner of the switch and of the short versions.
 */

declare module 'hobkin/src/cli/short-reports.mjs' {
  /** The switch as config.json holds it. Off for a home that never set it, or a config that cannot be read. `since` is when it was turned on. */
  export function readShortReports(root: string): { on: boolean; since: string | null }
  /** Saves the user's word. Turning it on counts from now; turning it on again keeps the time it was first turned on. */
  export function setShortReports(root: string, on: boolean, now?: number): { on: boolean }
}
