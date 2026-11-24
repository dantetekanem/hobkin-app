/**
 * Work mode as the Work screen draws it. The host reads it from hobkin's snapshot (`work` and `waiting`) with
 * hobkin's own rules (`src/cli/work/groups.mjs`), so the screen draws it and adds no rule of its own.
 * See _specs/011-work.
 */

/**
 * What hobkin's own scored review gave a finished change (049-yolo-mode), in the Work card's words. A score says how well
 * a question is answered, never the review's level, which is the risk of a break.
 */
export interface ChangeScores {
  /** Its kind, as the card says it: "Bug fix", "Feature". */
  kind: string
  /** The general rate. */
  rate: number
  /** The five scores in the card's order, each with its number (null when the review gave none) and its line of evidence. */
  scores: { name: string; score: number | null; evidence: string }[]
  /** The floors that hold the change whatever the rate: the score's name, its number and the number it needs. */
  floors: { name: string; score: number; needs: number }[]
  /** The scores are for an older commit than the change is at. */
  stale: boolean
}

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

/**
 * What a project is to work mode (059-new-project). `code` is a git repository: its work finishes on a branch for the
 * user's yes. `goal` is something to reach, kept in a folder that need not be a repository: work mode works toward the
 * user's own words there, in the folder itself, with no branch, pull request, review or merge.
 */
export type ProjectKind = 'code' | 'goal'

export const PROJECT_KINDS: readonly ProjectKind[] = ['code', 'goal']

/** What is at a path the user named for a new project. */
export type FolderFound = 'folder' | 'file' | 'missing'

/** What hobkin sees at the folder the user named for a new project (`work.project.look`). It only reads. */
export interface FolderLook {
  /** The folder as it was typed. */
  typed: string
  /** The folder as it is on disk, with `~` and links resolved. Null when there is no folder there. */
  folder: string | null
  found: FolderFound
  /** It holds a git repository of its own, so it can be a code project. */
  git: boolean
  /** The name the project would get: the folder's own. Null when there is no folder there. */
  name: string | null
  /** The project work mode already has for this very folder. */
  known: { slug: string; name: string; state: ProjectState } | null
  /** Where the project work mode already has under this folder's name lives, when that is another folder. */
  namesake: string | null
}

/** A project the user added with New project (`work.project.new`), with hobkin's own line about what happens next. */
export interface NewProjectDone {
  slug: string
  name: string
  kind: ProjectKind
  message: string
}

/** The folder the user picked in the Mac's own chooser (`work.folder.pick`), or null when they closed it. */
export interface FolderPicked {
  folder: string | null
}

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
  /** Code or a goal (059-new-project). A hobkin older than goals does not send it, and then it is code. */
  kind?: ProjectKind
  /** How many of its steps are done, in all (hobkin's count of its `done` items). Sent for a goal only. */
  done?: number
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

/**
 * A finished change's place in a stack: finished branches built one on the other, which land bottom first
 * (060-make-it-a-stack). hobkin reads it from the branches themselves, so it needs no push and no pull request.
 */
export interface StackPlace {
  /** The stack, named by its bottom layer's item. */
  id: string
  /** This layer counted from the bottom, which is 1 and lands next. */
  layer: number
  /** How many layers of the stack have not landed. */
  of: number
  /** What it is a stack of, in the words its maker gave. Null when it gave none. */
  name: string | null
  /** The item of the layer under this one, which lands first. Null for the bottom. */
  below: string | null
  /** The commit the layer under this one is at, where this layer's own change starts. Null for the bottom. */
  base: string | null
}

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
  /** Its place in a stack, when its branch is built on another finished branch or one is built on it. A hobkin older than stacks does not send it. */
  stack?: StackPlace
  /** On a "Left for you" card, the note its run left for the user, whole. */
  left?: string | null
  /**
   * What its review scored it, in one line: its kind, its general rate and the five scores (049-yolo-mode). A score says
   * how well a question is answered, never the risk of a break, which is the review's level. Null with no scores.
   */
  scores?: string | null
  /** The same scores in parts, for the review: each with its evidence line. A hobkin or host older than this does not send it. */
  scoring?: ChangeScores | null
  /** The TLA+ models that cover what it changes, and what hobkin's own runs at its head say of each. A hobkin older than them does not send it. */
  models?: ModelFact[]
  /** When hobkin's own model checks at its head wrote the proof score's evidence, rather than the review: that line, and the run it names. */
  proofCheck?: { line: string; run: string } | null
  /**
   * When hobkin last wrote its item, as an ISO time (the item's `updatedAt`, which hobkin sends as its ready row's `at`). That is when it finished
   * unless hobkin wrote to it since, such as a review's scores, the user's note or a refresh, so it can be later than the finish. Missing for an
   * item hobkin never updated, and from an older host.
   */
  at?: string
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
  /** On the deploy part, false when nothing deploys on the project. */
  deploys?: boolean
}

/**
 * What one YOLO rule is set to (063-yolo-settings-and-grades): a switch, a number, a choice, a list of words, or null for
 * "none" where the rule allows no limit. The names and ranges are the runtime's (`yolo-rules.mjs`), which checks every value.
 */
export type YoloRuleValue = number | boolean | string | string[] | null

/** Every rule by its name, as the runtime holds it. */
export type YoloRules = Record<string, YoloRuleValue>

const isRuleValue = (value: unknown): value is YoloRuleValue =>
  value === null ||
  typeof value === 'boolean' ||
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (Array.isArray(value) && value.every((word) => typeof word === 'string'))

/** The rules a runtime sent, or undefined for a runtime that has none or sent something else. A rule whose value is not one the page can show is left out. */
export function readYoloRules(value: unknown): YoloRules | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, YoloRuleValue] => isRuleValue(entry[1]))
  return Object.fromEntries(entries)
}

/** A list of names (the rules a project sets for itself), or undefined when the runtime sent none. */
export function readYoloNames(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((name) => typeof name === 'string') ? [...value] : undefined
}

/** A finished change waiting on a project, as YOLO mode reads it (`yoloStatus` in hobkin's `src/cli/work/yolo-report.mjs`). */
export interface YoloChange {
  item: string
  title: string
  /** What its review calls it, in hobkin's words ("a bug fix"), and its general rate. Null with no review yet. */
  kind: string | null
  rate: number | null
  /** Why it keeps asking the user, in hobkin's words, or null when it merges by itself on the next pass. On a project still getting ready, what it would meet once ready. */
  why: string | null
  /** The name of the YOLO rule that holds it, so the page can open that setting. A hobkin older than rules does not send it. */
  setting?: string | null
}

/** A change YOLO mode merged by itself, from its ledger. */
export interface YoloMerge {
  /** When it merged, as an ISO time. */
  at: string
  item: string
  title: string
  kind: string
  rate: number
  /** The commit it merged at, short. */
  head: string
  /** What became of its deploy, in hobkin's words: with the main agent, nothing deployed and why, or what the monitoring showed after it. */
  deploy: string
  /** Whether the latest reading after its deploy held: false on a regression, null with no reading yet. */
  held: boolean | null
}

/** One project's place in YOLO mode: whether changes may merge there by themselves, and what holds it back when not. */
export interface YoloProject {
  slug: string
  name: string
  /**
   * Whether YOLO mode works on this project, by its own switch, which only the window sets (`work.yolo.project`). YOLO mode's
   * main switch still decides first. A hobkin older than this does not send it, and then the project has no switch of its own.
   */
  on?: boolean
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
  /** The finished changes waiting on it, in the order hobkin weighs them. A hobkin older than this does not send it. */
  changes?: YoloChange[]
  /** What YOLO mode merged by itself here, newest first. A hobkin older than this does not send it. */
  merged?: YoloMerge[]
  /** The rules in force on this project, its own over the rest. A hobkin older than rules does not send them. */
  rules?: YoloRules
  /** The names of the rules this project sets for itself, which differ from the rest. */
  overrides?: string[]
  /** The names of the switches that hold the whole project, none when nothing does. */
  holds?: string[]
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
  /** Why nothing merges by itself anywhere, while work mode is off or paused, in hobkin's words. A hobkin older than this does not send it. */
  waits?: string | null
  /**
   * Whether YOLO mode takes a change waiting on its own pull request at all, by a switch in hobkin's code that ships off. A hobkin
   * older than this does not send it, and then it takes none.
   */
  pullRequests?: boolean
  /** The rules for every project that does not set its own (063-yolo-settings-and-grades). A hobkin older than rules does not send them. */
  rules?: YoloRules
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

/**
 * Which pull requests get an AI review by themselves: none, the user's own, those waiting for the user's review, or both.
 * hobkin keeps the setting (`REVIEW_PULLS` in its `src/cli/work/store.mjs`) and the host's reviews act on it.
 */
export type ReviewPulls = 'none' | 'mine' | 'waiting' | 'both'
export const REVIEW_PULLS: readonly ReviewPulls[] = ['none', 'mine', 'waiting', 'both']

/** A window of local time, each end as `HH:MM`. It crosses midnight when `to` comes before `from`, as 22:00 to 06:00. */
export interface WorkHours {
  from: string
  to: string
}

/**
 * How much automated work runs, as the user set it (053-work-control-room, `workloadOf` in hobkin's `src/cli/work/store.mjs`).
 * Each setting reads as hobkin's default until the user sets it: 2 agents, no cap, 100M tokens, always, ship first on at 8,
 * no scoring and no pull request reviewed by itself. `work.workload` changes them, and `work.agents` and `work.tokens` change those two.
 */
export interface Workload {
  agents: number
  /** Off: only what the user starts runs, and work on finished changes. */
  autoPick: boolean
  /** The most item runs that start in a local day, the user's picks among them. Past it only a pick starts until midnight. Null for no cap. */
  changesADay: number | null
  /** Fresh tokens a day, the user's own number. Today's limit, raised or not, is `dailyTokens` on the state. */
  dailyTokens: number
  /** Outside these local hours nothing new starts by itself and running agents finish. Null for always. */
  hours: WorkHours | null
  /** Whether new work holds while `shipFirstAt` or more finished changes wait for the user. */
  shipFirst: boolean
  shipFirstAt: number
  /** Whether hobkin scores each finished change by itself (`hobkin work reviews`). */
  reviewOnFinish: boolean
  reviewPulls: ReviewPulls
}

/**
 * The one thing that holds work mode (`holdingOf` in hobkin's `src/cli/work/plan.mjs`): work mode is off, paused by hand or to
 * protect the subscription, held by a usage limit, out of today's tokens or this hour's share, outside the user's hours, with every
 * agent busy, with nothing queued, with auto-pick off, shipping first, or at the day's cap on changes.
 */
export type HoldingKind =
  | 'off'
  | 'paused'
  | 'usage-limit'
  | 'tokens'
  | 'hourly-share'
  | 'hours'
  | 'agents-busy'
  | 'nothing-queued'
  | 'auto-pick-off'
  | 'ship-first'
  | 'cap'
export const HOLDING_KINDS: readonly HoldingKind[] = ['off', 'paused', 'usage-limit', 'tokens', 'hourly-share', 'hours', 'agents-busy', 'nothing-queued', 'auto-pick-off', 'ship-first', 'cap']

export interface WorkHolding {
  kind: HoldingKind
  /** When it ends by itself, as an ISO time. Null when only the user, or a run that finishes, ends it. */
  until: string | null
  /** What holds it, in one sentence of hobkin's. */
  line: string
}

/** What the forecast sees for the rest of today (`forecastAndOutlook` in hobkin's `src/cli/work/forecast.mjs`), counted in item runs, as the cap counts them. */
export interface WorkOutlook {
  /** Item runs that started today, running ones among them. */
  startedToday: number
  /** About how many more start before midnight. */
  moreToday: number
  /** When the next one starts, as an ISO time, or null when the forecast sees none in the next 8 hours or the rest of today. */
  nextAt: string | null
}

/** hobkin's open request to raise today's token limit, made once the day's tokens are spent. `work.allowance` answers it by its `at`. */
export interface AllowanceRequest {
  /** When hobkin asked, as an ISO time. It names the request. */
  at: string
  /** Today's limit when it asked, what it was raising it to, today's amount added again, and what was spent. */
  limit: number
  proposed: number
  used: number
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
  /** Why work mode runs fewer than the user's own number now, in hobkin's words. Null or missing while it runs their number. */
  agentsHeld?: string | null
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
  /** The user's workload as it stands. A host or hobkin older than it does not send it. */
  workload?: Workload
  /** What holds work mode and until when. Null while something starts, or only a row's own turn or the gap between starts holds it. Not sent by an older one. */
  holding?: WorkHolding | null
  /** How many changes start in the rest of today, and when the next one does. Not sent by an older one. */
  outlook?: WorkOutlook | null
  /** hobkin's open request to raise today's tokens, while work mode is on. Null with none open. Not sent by an older one. */
  allowance?: AllowanceRequest | null
}

/** One row of a group's yes, as hobkin's `mergeGroup` takes it. */
export interface GroupRow {
  slug: string
  item: string
  how: Landing
  head?: string
}

/** Every row of hobkin's queue, in hobkin's order with the skipped rows last, where the status keeps only its first rows. */
export interface WholeQueue {
  rows: QueueRow[]
  /** How many of them wait to start: all but the skipped ones, the paused projects' rows included. */
  queued: number
}
