/**
 * hobkin's fold of work's numbers (`src/cli/work/metrics.mjs`), typed here because hobkin ships plain JavaScript. Paths
 * and signatures are those of `~/Poetry/hobkin` on `main`. hobkin stays the owner of all of it.
 */

declare module 'hobkin/src/cli/work/metrics.mjs' {
  import type { MetricsSpan, WorkMetrics } from '#shared/protocol/metrics.ts'

  /**
   * What work mode did on each local day of the last `days` (30 unless asked, 180 at most) up to today, for all projects
   * and for each project it took, from hobkin's own records. The AI review counts and their span are left at nothing
   * for the host to fill. What could not be read is named in `gaps`. `decided` lists each change merged or declined in
   * the period, newest first, `DECIDED_MAX` at most, from the same records as the day counts.
   */
  export function workMetrics(root: string, options?: { days?: number; now?: number }): WorkMetrics
  /** The most decided changes one read lists. */
  export const DECIDED_MAX: number
  /** The median and 90th percentile of what was measured, in whole milliseconds, or nulls with nothing measured. */
  export function spanOf(durations: readonly number[]): MetricsSpan
  /** A local day, as `YYYY-MM-DD`. */
  export function dayOf(time: string | number | Date): string
}
