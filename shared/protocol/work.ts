/**
 * Work mode as the Work screen draws it. The host reads it from hobkin's snapshot (`work` and `waiting`) with
 * hobkin's own rules (`src/cli/work/groups.mjs`), so the screen draws it and adds no rule of its own.
 * See _specs/011-work.
 */

export type Grade = 'P0' | 'P1' | 'P2' | 'P3'

/** Where a project's finished work goes: a local branch with its description, a draft PR, or a PR. hobkin's `prModes`. */
export type PrMode = 'off' | 'draft' | 'published'

/** Which of a project's open GitHub issues it files as work by itself: none, only those labeled `hobkin`, or every one. hobkin's `issueModes`. */
export type IssuePickup = 'off' | 'labeled' | 'all'

export const GRADES: readonly Grade[] = ['P0', 'P1', 'P2', 'P3']
export const PR_MODES: readonly PrMode[] = ['off', 'draft', 'published']
export const ISSUE_PICKUPS: readonly IssuePickup[] = ['off', 'labeled', 'all']

/** The GitHub issue a piece of work was filed from, as hobkin keeps it on the item (`issue` in its `src/cli/work/store.mjs`). */
export interface WorkIssue {
  /** `owner/name` */
  repo: string
  number: number
  url: string
}

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
  /** The GitHub issue its item was filed from, and its pull request once it has one. A host older than these does not send them. */
  issue?: WorkIssue | null
  pr?: string | null
}

/**
 * Where a project stands with work mode, in hobkin's words: `chosen` is taken and worked on, `proposed` waits for
 * the user to take it, and `skipped` and `dropped` are left alone until the user takes them again.
 */
export type ProjectState = 'chosen' | 'proposed' | 'skipped' | 'dropped'

/** A project work mode knows. */
/**
 * What hobkin's own runs say of one TLA+ model (050-tla-proofs, `factOf` in its `src/cli/work/proofs.mjs`): it holds,
 * it broke, it ran and is no evidence (it ended otherwise, or an action never fired), or nothing checked it. On the
 * default branch it is the latest run of the spec committed there; on a finished change, a run at the change's head.
 */
export interface ModelFact {
  /** The spec's path in the project, such as `_specs/tla/WorkItem.tla`. */
  spec: string
  state: 'holds' | 'broken' | 'unproven' | 'unchecked'
  /** On a finished change: the change edits the spec itself. */
  changed?: boolean
  /** The run that says so, for its page. None while nothing checked it. */
  run?: string
  /** Why it is not evidence: the rule that broke, the actions that never fired, or how the run ended. */
  why?: string
  /** What the run showed, in hobkin's line: "TLC: 4 of 4 hold in 48,211 states · at 3f1a9c2". */
  line?: string
}

export interface WorkProject {
  slug: string
  name: string
  state: ProjectState
  priority: Grade
  prMode: PrMode
  /** Which of its open GitHub issues it picks up by itself. A host older than this setting does not send it, and then it is off. */
  issues?: IssuePickup
  /** `casual`, `important`, `critical` or `max`: the model and how hard it thinks. */
  level: string
  paused: boolean
  /** Items to do, open PRs, finished branches, steps left for the user, and branches not merged yet. */
  open: number
  prs: number
  branches: number
  left: number
  unmerged: number
  /** How many of its changes have merged, in all (hobkin's count of its `merged` items). A host older than this count does not send it. */
  merged?: number
  /** When hobkin looks at it again, as an ISO time. */
  nextLookAt: string | null
  /** Why its last look failed, in hobkin's words. */
  lookError: string | null
  /**
   * Its repository on GitHub, `owner/name`, as hobkin finds it (`repoOfProject`): its folder's origin, or the remote hobkin clones.
   * Null for one that is not on github.com. Sent only for the projects hobkin works on, and not by a host older than this.
   */
  repo?: string | null
  /** Its TLA+ models on the default branch, when it has any. A hobkin older than them does not send it. */
  models?: ModelFact[]
}

/**
 * hobkin's three groups of finished work: it merges as it is, it refreshes and then merges, or it needs the user. And
 * `left`: finished work whose run left the user a note, which hobkin lists apart from its groups, so no yes carries it.
 */
export type FinishedGroupName = 'merge' | 'refresh' | 'needs' | 'left'

/** How a change lands: merged on this machine, merged on GitHub as a PR, or brought up to date by an agent and then merged. */
export type Landing = 'merge' | 'mergePr' | 'refreshMerge'

/**
 * What a card offers, in hobkin's words and order (`cardChoices` in its `src/cli/ui.mjs`). `diff` is the terminal's
 * "Show the diff", which here opens the change in Change Review. `open` opens the PR. `done` is hobkin's own done,
 * "Close without merging": the item is closed and its branch, or PR, stays as it is, unmerged.
 */
export type ChangeChoice = Landing | 'rebase' | 'diff' | 'open' | 'review' | 'decline' | 'done'

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
  /** The GitHub issue its item was filed from. A host older than this does not send it. */
  issue?: WorkIssue | null
  /** On a "Left for you" card, the note its run left for the user, whole. */
  left?: string | null
  /**
   * What its review scored it, in one line: its kind, its general rate and the five scores (049-yolo-mode). A score says
   * how well a question is answered, never the risk of a break, which is the review's level. Null with no scores.
   */
  scores?: string | null
  /** The TLA+ models that cover what it changes, and what hobkin's own runs at its head say of each. A hobkin older than them does not send it. */
  models?: ModelFact[]
  /** When hobkin's own model checks at its head wrote the proof score's evidence, rather than the review: that line, and the run it names. */
  proofCheck?: { line: string; run: string } | null
}

/**
 * Where a project's readiness work stands (`workOf` in hobkin's `src/cli/work/yolo.mjs`): none filed yet, queued to run,
 * running, waiting for the user's yes on its branch, landed, or closed without landing.
 */
export type YoloWork = 'none' | 'queued' | 'running' | 'waiting' | 'landed' | 'closed'

/**
 * Where one part of a project's readiness stands (`partsOf` in hobkin's `src/cli/work/yolo-parts.mjs`): done, its change in a
 * PR (or on a branch whose PR could not open) for the user's merge, waiting on a step only the user can take, in progress,
 * or still to do.
 */
export type YoloPartState = 'done' | 'pr' | 'user' | 'doing' | 'todo'

/** One part of a project's readiness: tests, the five kinds of monitoring, rollback, deploy, or its models. */
export interface YoloPart {
  name: string
  /** hobkin's name for it: "Tests", "Error tracking". */
  label: string
  state: YoloPartState
  /** How it works, what its branch sets up, the step the user is asked for, or what is still to do, in hobkin's words. */
  line: string
  /** Part of the bar YOLO mode needs: tests, rollback and models. The rest are improvements. */
  needed: boolean
  /** Whether it holds YOLO mode back on this project now. */
  blocks: boolean
  /** The PR its change is in, once open. */
  pr?: string
  /** The branch its change is on. */
  branch?: string
  /** The work item that holds that branch, whose card is on Work. */
  item?: string
  /** Why its PR did not open, while the branch waits without one. */
  problem?: string
  /** The Action Item for the step only the user can take. */
  action?: string
}

/** One project's place in YOLO mode: whether changes may merge there by themselves, and what holds it back when not. */
export interface YoloProject {
  slug: string
  name: string
  ready: boolean
  needs: string[]
  /** Every part as it stands. A hobkin older than them does not send it. */
  parts?: YoloPart[]
  /** Where its readiness work stands. A hobkin older than this does not send it. */
  work?: YoloWork
  /** Its readiness work's item, so the window can find the branch that waits for the user's yes. A hobkin older than this does not send it. */
  item?: string | null
  /** When its readiness was last recorded, as an ISO time, and null before its first check. A hobkin older than this does not send it. */
  checkedAt?: string | null
  /** Its TLA+ models on the default branch, the readiness part YOLO mode needs to hold, when it has any. A hobkin older than them does not send it. */
  models?: ModelFact[]
}

/**
 * YOLO mode as hobkin reports it (`yoloView` in its `src/cli/work/yolo.mjs`, 049-yolo-mode): the user's switch, the
 * lowest general rate a change may have to merge by itself with the range hobkin takes, and each chosen project's readiness.
 */
export interface YoloState {
  on: boolean
  rate: number
  lowest: number
  highest: number
  /** How many of `projects` are ready. */
  ready: number
  projects: YoloProject[]
}

/** What the user said yes to that has not merged yet: an agent brings it up to date first, and hobkin merges it once that run ends well. */
export interface MergingRow {
  /** `slug:item` */
  key: string
  slug: string
  project: string
  item: string
  title: string
  branch: string | null
  issue: WorkIssue | null
  pr: string | null
  /** When the user said yes, as an ISO time, when hobkin recorded it. */
  since: string | null
  /** The main agent's session does it, because work mode was off or paused when the user said yes. */
  handedOff: boolean
}

/** Every row a group's yes carries out, numbered in the order they go, under their projects (`groupPlan` in hobkin). */
export interface GroupPlan {
  name: string
  about: string
  projects: { slug: string; project: string; steps: { number: number; title: string; note: string }[] }[]
}

export interface FinishedGroup {
  name: FinishedGroupName
  /** "Ready to merge", "Refresh then merge", "Needs you" or "Left for you". */
  heading: string
  /** Why its changes are together. Null for "Needs you", where each card says why. */
  why: string | null
  /** The one yes for the whole group, its question, the plan it asks about, and what it says while it is carried out. Null for "Needs you" and "Left for you". */
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
  /** How many agents may run at once now. Work mode can hold it below the user's own number. */
  agents: number
  /** The user's own number of agents that may run at once (`hobkin work agents`), and the most hobkin allows. */
  agentsAllowed: number
  maxAgents: number
  /** The fresh tokens work mode may spend today, and what it has spent. Null, or missing, from a host that does not report them. */
  dailyTokens?: number | null
  tokensToday?: number | null
  queue: QueueRow[]
  /** How many rows are queued in all. `queue` holds the first of them, then the skipped ones. */
  queued: number
  /** Every project work mode knows: the ones taken, by priority, then the proposals, then the ones left alone. */
  projects: WorkProject[]
  finished: FinishedGroup[]
  /** What the user said yes to that is still being brought up to date before it merges. A host older than this does not send it. */
  merging?: MergingRow[]
  /** YOLO mode and each project's readiness for it. A host older than this does not send it. */
  yolo?: YoloState | null
}

/** One row of a group's yes, as hobkin's `mergeGroup` takes it. */
export interface GroupRow {
  slug: string
  item: string
  how: Landing
  head?: string
}
