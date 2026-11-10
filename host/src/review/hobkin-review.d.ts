/**
 * The parts of hobkin's work store the review reads, typed here because hobkin ships plain JavaScript.
 * They merge with the declarations in `host/src/hobkin-work.d.ts`. hobkin stays the owner of all of it.
 */

declare module 'hobkin/src/cli/work/store.mjs' {
  /** A project as hobkin keeps it. `path` is the folder it was chosen from, when it was chosen from one. */
  export function readProject(root: string, slug: string): { slug: string; name?: string; path?: string; [key: string]: unknown } | null
  /** Where hobkin keeps a project's files. `clone` is its own copy of the repository, for a project that has no folder. */
  export const paths: (root: string, slug: string) => { directory: string; clone: string; [key: string]: string }
}

declare module 'hobkin/src/cli/work/tree.mjs' {
  /** The branch everything starts from, read from what is already in the repository, with no network. */
  export function defaultBranch(repo: string): Promise<string>
}
