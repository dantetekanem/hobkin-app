/**
 * The parts of hobkin's work store the review reads, typed here because hobkin ships plain JavaScript.
 * They merge with the declarations in `host/src/hobkin-work.d.ts`. hobkin stays the owner of all of it.
 */

declare module 'hobkin/src/cli/work/store.mjs' {
  /** A project as hobkin keeps it. `path` is the folder it was chosen from, when it was chosen from one. */
  export function readProject(root: string, slug: string): { slug: string; name?: string; path?: string; [key: string]: unknown } | null
  /** Every project hobkin keeps, each as `readProject` gives it. */
  export function readProjects(root: string): { slug: string; name?: string; path?: string; [key: string]: unknown }[]
  /**
   * A project's items as hobkin keeps them. A merged one has `mergedAt` and, unless it shipped hobkin itself, `landed`
   * with the commit it landed as; one the user said to refresh and merge has `mergeWhenFresh` until it merges.
   */
  export function readItems(
    root: string,
    slug: string,
  ): { id: string; state: string; title?: string; mergedAt?: string | null; landed?: { sha?: string | null; at?: string | null } | null; mergeWhenFresh?: { at?: string } | null; [key: string]: unknown }[]
  /** Where hobkin keeps a project's files. `clone` is its own copy of the repository, for a project that has no folder. */
  export const paths: (root: string, slug: string) => { directory: string; clone: string; [key: string]: string }
}

declare module 'hobkin/src/cli/client-notices.mjs' {
  /**
   * Saves a line hobkin posts in Chat as its own notice, with no model turn. `key` names the news, so posting it again
   * adds nothing; `review` names the review it is about. Answers whether it was new. Throws on a bad key or an empty line.
   */
  export function postClientNotice(root: string, notice: { key: string; line: string; tone?: 'critical' | 'blocked' | 'useful' | 'quiet'; review?: string }, now?: number): boolean
}

declare module 'hobkin/src/cli/work/tree.mjs' {
  /** The branch everything starts from, read from what is already in the repository, with no network. */
  export function defaultBranch(repo: string): Promise<string>
}
