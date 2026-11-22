/**
 * The part of hobkin's work store that names the tier of a Work run, typed here because hobkin ships plain JavaScript.
 * It merges with the other declarations of the module in `host/src`. hobkin stays the owner of all of it.
 */

declare module 'hobkin/src/cli/work/store.mjs' {
  /** What each project level gives its runs, among them the tier of a look and of a do (`src/cli/work/store.mjs`). */
  export const levels: Record<string, { lookTier: string; doTier: string; [key: string]: unknown }>
}
