/**
 * The parts of hobkin's GitHub issue work the host calls, typed here because hobkin ships plain JavaScript. Paths and signatures are those of
 * `~/Poetry/hobkin` on branch client/background-work at commit 7c028b9. hobkin stays the owner of all of it.
 */

declare module 'hobkin/src/cli/work/issues.mjs' {
  /** The project whose repository on GitHub is `owner/name`, in any case, from its folder's origin or the remote hobkin clones. Null when hobkin knows none. */
  export function projectOfRepo(root: string, repo: string): Promise<{ slug: string; name?: string; state?: string; [key: string]: unknown } | null>
  /**
   * The `issue` work action: files the issue on the project, first in the queue when it is taken. Added again it changes nothing and says so.
   * Throws for an unknown project, or an issue without its repository, number or title.
   */
  export function addIssue(
    root: string,
    slug: string,
    issue: { repo: string; number: number; title: string; body?: string; url?: string; labels?: string[] },
    now?: number,
  ): { ok: true; message: string; slug: string; id: string }
}

declare module 'hobkin/src/cli/work/store.mjs' {
  /** The `issues` work action: which of a project's open GitHub issues it files as work by itself. Throws for another word or an unknown project. */
  export function setProjectIssues(root: string, slug: string, issues: string): unknown
}
