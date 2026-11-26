/**
 * The part of hobkin's merge bookkeeping the host uses to settle a pull request merged outside the app, typed here
 * because hobkin ships plain JavaScript. Paths and signatures are those of `packages/hobkin` on `main`.
 */

declare module 'hobkin/src/cli/work/unmerged.mjs' {
  /** The default branch tip that deploy approval would select from the local refs. */
  export function landingTip(repo: string, base: string): Promise<string | null>
  /** A pull request as hobkin's survey reads it from GitHub. */
  export interface SurveyPull {
    number?: number
    title?: string
    url?: string
    state?: string
    createdAt?: string
    mergedAt?: string | null
    mergeCommit?: { oid?: string } | null
    additions?: number
    deletions?: number
    changedFiles?: number
    headRefName?: string
    [key: string]: unknown
  }
  /** Closes an item as merged, the way a merge done from the app does, from the pull request GitHub reports. */
  export function closeMergedPull(root: string, slug: string, item: { id: string; [key: string]: unknown }, pull: SurveyPull | null, now?: number): { id: string; state: string; [key: string]: unknown }
}
