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

declare module 'hobkin/src/cli/work/proofs.mjs' {
  /** A run as `hobkin proof check` wrote its `result.json`, without its state graph. */
  export interface StoredProofRun {
    id: string
    project?: string
    item?: string
    spec: string
    head?: string
    specHash?: string
    outcome: 'holds' | 'broken' | 'error' | 'stopped'
    stats?: { distinct?: number; depth?: number }
    rules?: { name: string; kind: 'invariant' | 'property' | 'deadlock'; status: string; words?: string }[]
    actions?: { name: string; count?: number }[]
    broken?: string
    traceLength?: number
    message?: string
    [key: string]: unknown
  }
  /** Every run that ended in hobkin's home, newest first. */
  export function readRuns(root: string): StoredProofRun[]
  /** The specs at a commit that model a changed file or that it edits, with the changed files each names in `\* models:` (`covers`). */
  export function modelsAt(repo: string, head: string, changed?: readonly string[]): Promise<{ spec: string; sha256: string; changed: boolean; covers: string[] }[]>
  /** What the runs say of each spec at that head, matched to the spec as committed there: a broken run first, then one that counts. */
  export function modelFacts(
    runs: readonly StoredProofRun[],
    change: { slug: string; head: string; specs: readonly { spec: string; sha256: string; changed?: boolean }[] },
  ): { spec: string; state: 'holds' | 'broken' | 'unproven' | 'unchecked'; run?: string; why?: string; line?: string; changed?: boolean }[]
}

declare module 'hobkin/src/cli/work/controls.mjs' {
  /** Why work mode starts nothing on a project now, in hobkin's words: "work mode is off", "shop is paused". Null while it runs. */
  export function whyProjectWaits(root: string, project: { slug: string; name?: string; [key: string]: unknown }, now?: number): string | null
}

declare module 'hobkin/src/cli/work/classified.mjs' {
  /** hobkin's five questions, in the order a card says them. */
  export const CRITERIA: readonly ('coverage' | 'proof' | 'safety' | 'visibility' | 'rollback')[]
  /** The average of the five, cut to one decimal and never rounded up. Every one of the five must be there. */
  export function generalRate(scores: Record<'coverage' | 'proof' | 'safety' | 'visibility' | 'rollback', { score: number }>): number
  /** The scores that hold a change whatever its average, each with what it needed. Every one of the five must be there. */
  export function brokenFloors(scores: Record<'coverage' | 'proof' | 'safety' | 'visibility' | 'rollback', { score: number }>): { criterion: 'coverage' | 'proof' | 'safety' | 'visibility' | 'rollback'; score: number; needs: number }[]
}

declare module 'hobkin/src/cli/work/yolo.mjs' {
  /** A project's readiness for YOLO mode as its last record and its readiness work say: each part with its state and line. `at` is null before any record. */
  export function readinessOf(root: string, slug: string): { ready: boolean; needs: string[]; parts: Record<string, { state: string; line?: string; [key: string]: unknown }>; at: string | null; item: string | null }
}

declare module 'hobkin/src/cli/work/yolo-parts.mjs' {
  /** Each readiness part in the words hobkin shows it by: "Error tracking", "Rollback". */
  export const partWords: Record<string, string>
}
