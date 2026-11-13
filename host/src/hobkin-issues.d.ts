/**
 * The parts of hobkin's GitHub issue work the host calls, typed here because hobkin ships plain JavaScript. Paths and signatures are those of
 * `~/Poetry/hobkin` on branch client/background-work at commit 7c028b9. hobkin stays the owner of all of it.
 */

declare module 'hobkin/src/cli/work/issues.mjs' {
  /**
   * What hobkin has filed for GitHub issues, from one read of every project's items: the item filed for an issue and its project, or null
   * for an issue with nothing filed (commit d1f474a).
   */
  export function filedIssues(
    root: string,
  ): (issue: { repo: string; number: number }) => { project: { slug: string; name?: string }; item: { id: string; state: string; pr?: string | null } } | null
  /** `owner/name` of a remote on github.com, however it is written: https, ssh or `git@github.com:`. Null for anywhere else, or nothing. */
  export function githubRepoOf(remote: unknown): string | null
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
  /** The runs work mode has going, as its owner last wrote them, and whether an owner holds the home now. With no owner nothing runs. */
  export function ownerView(root: string, now?: number): { owner: boolean; running: { id: string; slug?: string | null; item?: string | null; [key: string]: unknown }[] }
  /** What the owner has going, written where commands in other processes read it. Tests stand in for an owner with it. */
  export function writeOwnerView(root: string, view: { running: { id: string; slug?: string; item?: string; [key: string]: unknown }[] }): void
  /** Changes an item, keeping what it had: the last change to each field wins. Throws for an item hobkin does not know. */
  export function updateItem(root: string, slug: string, id: string, change: Record<string, unknown>, now?: number): { id: string; state: string; [key: string]: unknown }
}
