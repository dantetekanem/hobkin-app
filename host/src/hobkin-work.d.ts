/**
 * The parts of hobkin's work mode the host calls, typed here because hobkin ships plain JavaScript.
 * Paths and signatures are those of `~/Poetry/hobkin` at commit a78669a. hobkin stays the owner of all of it.
 */

declare module 'hobkin/src/cli/application.mjs' {
  export interface HobkinApplication {
    /**
     * hobkin's work actions, the ones its Work tab and Decisions call (`workAction` in `src/cli/application.mjs`):
     * `start`, `toggle`, `run`, `later`, `back`, `priority`, `prs`, `merge`, `mergePr`, `refreshMerge`, `review`,
     * `ask`, `decline`, `stop`, `group` and more. Each records what the user did and refreshes the snapshot.
     */
    workAction(action: string, slug?: unknown, value?: unknown, extra?: unknown): Promise<unknown>
    /** Cancels a running job the runner owns, as k does on a job in the terminal. False when it was not running. */
    kill(runId: string): Promise<boolean>
    runner: {
      /**
       * `message_check`: with a schedule, hands the message to that running job as steering; without one, lists the
       * running jobs that take messages (`{ running: [{ scheduleId, title }] }`).
       */
      messageCheck(request: { scheduleId?: string; message?: string }): Promise<unknown>
    }
  }
}

declare module 'hobkin/src/cli/work/groups.mjs' {
  export type GroupName = 'merge' | 'refresh' | 'needs'

  /** Finished work in the groups one yes can finish, each in the order it is given within a project. An empty group is left out. */
  export function approvalGroups<Entry extends { slug: string }>(entries: Entry[]): { name: GroupName; rows: Entry[] }[]

  /** How a row lands: refreshed first when it is behind its base, as a PR on its host, or merged on this machine. */
  export function landingWay(entry: { behind?: number | null; pr?: string | null }): 'merge' | 'mergePr' | 'refreshMerge'

  /** The title without a batch's "Review locally:" in front of it. */
  export function shownTitle(title: unknown): string

  export interface GroupWords {
    heading: string
    name: string
    action: (count: number) => string
    underWay: (count: number) => string
    why: (count: number) => string
    question: (count: number) => string
    about: string
  }
  export const groupWords: { merge: GroupWords; refresh: GroupWords; needs: { heading: string } }

  export function groupPlan(
    name: 'merge' | 'refresh',
    entries: { slug: string; project?: string; title: string }[],
  ): { name: string; about: string; projects: { slug: string; project: string; steps: { number: number; title: string; note: string }[] }[] }
}

declare module 'hobkin/src/cli/work/store.mjs' {
  export const grades: readonly string[]
  export const prModes: readonly string[]
  /** P0 first. The sort is stable, so projects of one priority stay in the order they came in. */
  export function byPriority(left: { priority?: string }, right: { priority?: string }): number
  /** Proposals in the order the look for projects ranked them. */
  export function byRank(left: { rank?: number }, right: { rank?: number }): number
  /** The most agents work mode will ever run at once, whatever is asked for. */
  export const MAX_AGENTS: number
  /** How many agents may run at once, as `hobkin work agents <n>` sets it. Throws for a number out of range. */
  export function setAgents(root: string, agents: number): { agents: number; [key: string]: unknown }
  /** The tokens work mode may spend in a day, as `hobkin work tokens <n>` sets it. Throws for a number that is not positive. */
  export function setDailyTokens(root: string, tokens: number): { dailyTokens: number; [key: string]: unknown }
  /** Work mode's switch and settings, as saved in the home. */
  export function readMode(root: string): { enabled: boolean; folder: string | null; autoPick: boolean; [key: string]: unknown }
  /** Takes a project: a known one by slug, or a folder by its absolute path. */
  export function chooseProject(root: string, reference: string, level?: string): { slug: string; [key: string]: unknown }
  /** hobkin's slug for a project's name: lowercase, with dashes. */
  export function slugOf(name: string): string
  /** Every project work mode knows, in any state, with the path it was found at. */
  export function readProjects(root: string): { slug: string; name?: string; path?: string; remote?: string; state?: string; [key: string]: unknown }[]
  /** Offers a project in Work for the user to take or skip. A known project that is not a proposal is answered as it is, unchanged. */
  export function proposeProject(
    root: string,
    proposal: { name: string; path: string; level: string; summary?: string; reason?: string; first?: unknown[] },
  ): { slug: string; state?: string; [key: string]: unknown }
  /**
   * Saves the folder work mode starts from, only while work mode is off. A running work mode keeps what it has and
   * answers `changed: false` with it, which is null for one running without a folder. Throws `Not a folder: <path>`.
   */
  export function setFolder(root: string, requested: string): { folder: string | null; changed: boolean }
  /** Turns work mode on from a folder, or the one it keeps. `autoPick` is `start --auto`: it starts on taken projects by itself. */
  export function startWork(root: string, requested?: string, options?: { autoPick?: boolean }): { enabled: boolean; folder: string | null; autoPick: boolean; [key: string]: unknown }
  export function setProjectPriority(root: string, slug: string, priority: string): unknown
  export function setProjectPrMode(root: string, slug: string, prMode: string): unknown
}

declare module 'hobkin/src/cli/work/commands.mjs' {
  /** `hobkin work` and its commands. With no command it is work mode's whole status, as the snapshot's `work` holds it. */
  export function runWorkCommand(root: string, args: string[]): Promise<unknown>
}

declare module 'hobkin/src/cli/work/reads.mjs' {
  /** Only a review that rated this very commit below safe holds work back. */
  export function heldByItsGrade(entry: { safety?: { grade: string; stale?: boolean } | null }): boolean
}

declare module 'hobkin/src/cli/work/yolo.mjs' {
  /**
   * The user's word on YOLO mode, which no `hobkin work` command changes. A value left out keeps what it was. Turning
   * it on merges nothing and files each project's readiness work, named in `filed`. Throws for a rate outside 6 to 10.
   */
  export function setYolo(root: string, change: { on?: boolean; rate?: number }): { on: boolean; rate: number; filed: { slug: string; id: string; title: string }[] }
}
