/**
 * Work mode as the Work screen draws it. The host reads it from hobkin's snapshot (`work` and `waiting`) with
 * hobkin's own rules (`src/cli/work/groups.mjs`), so the screen draws it and adds no rule of its own.
 * See _specs/011-work.
 */

export type Grade = 'P0' | 'P1' | 'P2' | 'P3'

/** Where a project's finished work goes: a local branch with its description, a draft PR, or a PR. hobkin's `prModes`. */
export type PrMode = 'off' | 'draft' | 'published'

export const GRADES: readonly Grade[] = ['P0', 'P1', 'P2', 'P3']
export const PR_MODES: readonly PrMode[] = ['off', 'draft', 'published']

/** One row of hobkin's queue, in hobkin's order (`plan` in its `workStatus`). */
export interface QueueRow {
  /** hobkin's key for the row, such as `item:storefront:3fa9c1`, `look:storefront` or `discover`. Actions name the row by it. */
  key: string
  /** `item`, `look`, `study`, `ideas`, `signals`, `watch` or `discover`. */
  kind: string
  slug: string | null
  project: string
  /** The item's id, for a row that is an item. */
  item: string | null
  title: string
  grade: Grade | null
  /** Why it is in the queue, in hobkin's words. */
  why: string | null
  /** What it waits for before it can start, in hobkin's words. Null when nothing holds it. */
  waiting: string | null
  skipped: boolean
  /** The user put it first. */
  picked: boolean
  /** About how many fresh tokens it takes, when hobkin can say. */
  tokens: number | null
}

/** A project work mode works on. */
export interface WorkProject {
  slug: string
  name: string
  priority: Grade
  prMode: PrMode
  /** `casual`, `important`, `critical` or `max`: the model and how hard it thinks. */
  level: string
  paused: boolean
  /** Items to do, open PRs, finished branches, steps left for the user, and branches not merged yet. */
  open: number
  prs: number
  branches: number
  left: number
  unmerged: number
  /** When hobkin looks at it again, as an ISO time. */
  nextLookAt: string | null
  /** Why its last look failed, in hobkin's words. */
  lookError: string | null
}

/** hobkin's three groups of finished work: it merges as it is, it refreshes and then merges, or it needs the user. */
export type FinishedGroupName = 'merge' | 'refresh' | 'needs'

/** How a change lands: merged on this machine, merged on GitHub as a PR, or brought up to date by an agent and then merged. */
export type Landing = 'merge' | 'mergePr' | 'refreshMerge'

/**
 * What a card offers, in hobkin's words and order (`cardChoices` in its `src/cli/ui.mjs`). `diff` is the terminal's
 * "Show the diff", which here opens the change in Change Review. `open` opens the PR.
 */
export type ChangeChoice = Landing | 'rebase' | 'diff' | 'open' | 'review' | 'decline'

export interface FinishedChange {
  /** `slug:item` */
  key: string
  slug: string
  project: string
  item: string
  title: string
  grade: Grade | null
  branch: string | null
  /** The commit the card shows. A yes lands it at this commit or not at all. */
  head: string | null
  /** The pull request's address, when the change is a PR. */
  pr: string | null
  /** What the change did, in its own words. */
  about: string | null
  /** How it was shown to work. Null when nothing recorded shows it. */
  proof: string | null
  /** Whether a review vouches for this commit, in hobkin's words. */
  review: string
  /** What a yes does, to which branch and where, in hobkin's words. */
  yes: string
  /** Why it is in its group. */
  reason: string
  safety: { grade: string; rating: string; stale: boolean } | null
  /** Lines and files it changes, when the survey read them. */
  size: { lines: number; files: number } | null
  /** Commits its base moved on by since it was made. */
  behind: number
  /** True when it conflicts with its base, null when nobody has checked yet. */
  conflict: boolean | null
  /** How the group's one yes lands it. */
  landing: Landing
  choices: { value: ChangeChoice; label: string }[]
}

/** Every row a group's yes carries out, numbered in the order they go, under their projects (`groupPlan` in hobkin). */
export interface GroupPlan {
  name: string
  about: string
  projects: { slug: string; project: string; steps: { number: number; title: string; note: string }[] }[]
}

export interface FinishedGroup {
  name: FinishedGroupName
  /** "Ready to merge", "Refresh then merge" or "Needs you". */
  heading: string
  /** Why its changes are together. Null for "Needs you", where each card says why. */
  why: string | null
  /** The one yes for the whole group, its question, the plan it asks about, and what it says while it is carried out. Null for "Needs you". */
  action: { label: string; question: string; plan: GroupPlan; underWay: string } | null
  changes: FinishedChange[]
}

export interface WorkState {
  enabled: boolean
  /** The folder work mode looks for projects in. Turning it on the first time needs one. */
  folder: string | null
  /** With auto-pick off, only what the user starts runs. */
  autoPick: boolean
  /** Why nothing new starts, in hobkin's words: a pause, or what it waits on. Null while work can start. */
  held: string | null
  /** About how much work mode starts in the next hours, and what holds it down, in hobkin's words. */
  forecast: string | null
  /** How many agents may run at once. */
  agents: number
  queue: QueueRow[]
  /** How many rows are queued in all. `queue` holds the first of them, then the skipped ones. */
  queued: number
  projects: WorkProject[]
  finished: FinishedGroup[]
}

/** One row of a group's yes, as hobkin's `mergeGroup` takes it. */
export interface GroupRow {
  slug: string
  item: string
  how: Landing
  head?: string
}
