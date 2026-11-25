/**
 * hobkin's reports catch-up (069-report-catch-up), typed here because hobkin ships plain JavaScript. The names are the
 * spec's contract with hobkin's `src/cli/catch-up.mjs`, which is newer than some hobkin, so the host looks them up on
 * the module. hobkin stays the owner of the settings, the run and what it covers.
 */

declare module 'hobkin/src/cli/catch-up.mjs' {
  import type { CatchUpState } from '#shared/protocol/reports.ts'

  /** The settings as hobkin keeps them, whether one is running, when the last finished, and how many unread reports wait. */
  export function readCatchUp(root: string): CatchUpState | Promise<CatchUpState>
  /** Saves the user's word and answers the settings as they now are. Throws hobkin's refusal for a bad time or a count under 1. */
  export function setCatchUp(root: string, change: { daily?: string | null; pileUp?: number | null }): CatchUpState | Promise<CatchUpState>
  /** Starts one now on hobkin's application, or starts nothing when nothing is uncovered and unread. Says which in hobkin's words. */
  export function startCatchUp(root: string, app: unknown): { message: string } | Promise<{ message: string }>
}
