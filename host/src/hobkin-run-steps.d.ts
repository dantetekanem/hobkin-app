/**
 * hobkin's reader of a run's steps from its saved Pi session (`src/cli/run-steps.mjs`), for what the run's live feed let
 * go. Typed here because hobkin ships plain JavaScript. Paths and signatures are those of `packages/hobkin` at commit
 * acda3b0.
 */

declare module 'hobkin/src/cli/run-steps.mjs' {
  import type { ActivityEntry } from '#shared/protocol/activity.ts'

  /**
   * A run that shares its session with other turns, as a durable hobkin's turns share its conversation: only what was saved
   * from `since` to `until`, in milliseconds, either open, is the run's, numbered from `since` as the run's own feed was.
   */
  interface Bounds {
    since?: number | null
    until?: number | null
  }
  /** Every step of the saved run, oldest first, in the feed's own shape. Throws when the file is missing or is not a Pi session. */
  export function runSteps(file: string, bounds?: Bounds): readonly ActivityEntry[]
  /**
   * The `most` steps right before the step `before` (a feed entry's id), newest last, or the newest when `before` is
   * null. `at`, a time in milliseconds, places a step the session numbers otherwise. `more` says older steps remain,
   * and `found` whether the step asked about is there.
   */
  export function runStepsBefore(file: string, options?: Bounds & { before?: string | null; at?: number | null; most?: number }): { steps: ActivityEntry[]; more: boolean; found: boolean }
  /** A tool step's whole output and its length, or null when no such tool result is saved. */
  export function runStepOutput(file: string, id: string): { id: string; output: string; length: number } | null
}
