import type { HobkinSnapshot } from 'hobkin/src/cli/application.mjs'
import { approvalGroups, groupPlan, groupWords, landingWay, shownTitle, type GroupName } from 'hobkin/src/cli/work/groups.mjs'
import { heldByItsGrade } from 'hobkin/src/cli/work/reads.mjs'
import { byPriority, byRank, currentRequest, dailyLimit, grades, MAX_AGENTS, readMode, setAgents, setDailyTokens } from 'hobkin/src/cli/work/store.mjs'
import * as hobkinStore from 'hobkin/src/cli/work/store.mjs'
import { setYolo } from 'hobkin/src/cli/work/yolo.mjs'
import * as hobkinYolo from 'hobkin/src/cli/work/yolo.mjs'
import {
  GRADES,
  HOLDING_KINDS,
  ISSUE_PICKUPS,
  PR_MODES,
  REVIEW_PULLS,
  type AllowanceRequest,
  type ChangeChoice,
  type ChangeScores,
  type FinishedChange,
  type StackPlace,
  type FinishedGroup,
  type Grade,
  type IssuePickup,
  type ModelFact,
  type PrMode,
  type HoldingKind,
  type ProjectState,
  type QueueRow,
  type ReviewPulls,
  type Workload,
  type WorkHolding,
  type WorkHours,
  type WorkOutlook,
  type WorkProject,
  type WorkState,
  type YoloState,
} from '#shared/protocol/work.ts'
import { readNeeds, type ReviewNeeds } from '#shared/review/needs.ts'
import { Unavailable, type HostHandlers } from './commands.ts'
import { NO_YOLO_RULES, rulesAnswered, yoloFrom, type YoloRulesRuntime } from './work-yolo.ts'

/**
 * Work mode for the Work screen: read from hobkin's own snapshot with hobkin's own rules, and every action the
 * screen takes carried out by one of hobkin's own work actions. Nothing here decides anything hobkin does not.
 * Spec: 011-work.
 */

/** What the host needs of hobkin's application for work mode (`workAction` in its `src/cli/application.mjs`). */
export interface WorkApp {
  workAction(action: string, slug?: unknown, value?: unknown, extra?: unknown): Promise<unknown>
  /** Reads hobkin's state again, so the window sees a change made outside a work action at once. */
  refresh(): Promise<unknown>
}

interface Safety {
  grade: string
  rating: string
  stale?: boolean
}

/**
 * One score and its evidence. When hobkin's own model checks at the change's head wrote the proof score's evidence, it
 * is marked `by: 'hobkin'` with the run that says so (`withModelChecks` in its `src/cli/work/classified.mjs`).
 */
interface Score {
  score: number
  evidence?: string
  by?: string
  run?: string
}

/** What a review scored a change, with the rate and the broken floors hobkin worked out (`scoresOf` in its `src/cli/work/classified.mjs`). */
interface ReviewScores {
  kind: string
  rate: number
  scores: Record<string, Score>
  floors: { criterion: string; score: number; needs: number }[]
  stale?: boolean
  /** What proof the review still wanted, in a line, and the commit it scored. */
  missing?: string | null
  head?: string
  /** Who gave them: `change-review` for Change Review's own grades, kept by hobkin (spec 063). An older hobkin sends none. */
  by?: string
}

/** A finished change as hobkin lists it: one of its `readyItems` or `pullRequestRows` (`src/cli/work/reads.mjs`). */
interface ReadyRow {
  slug: string
  project?: string
  item: string
  title: string
  grade?: string | null
  branch?: string | null
  head?: string | null
  pr?: string | null
  about?: string | null
  summary?: string | null
  proof?: string | null
  left?: string | null
  behind?: number | null
  conflict?: boolean | null
  size?: { additions: number; deletions: number; files: number } | null
  safety?: Safety | null
  review?: ReviewScores | null
  gap?: string
  holds?: number
  proved?: boolean
  unread?: string | null
  /** The TLA+ models that cover it, and what hobkin's own runs at its head say of each. */
  models?: ModelFact[]
  /** When hobkin last wrote its item: its `updatedAt`. */
  at?: string | null
  /** Its place in a stack, read without trust: a hobkin older than stacks sends none. */
  stack?: unknown
}

/** A row of hobkin's queue (`planRow` in its `src/cli/work/commands.mjs`). */
interface PlanRow {
  key: string
  kind: string
  slug?: string | null
  project?: string
  item?: string | null
  title: string
  grade?: string | null
  why?: string | null
  waiting?: string | null
  skipped?: boolean
  picked?: boolean
  estimate?: { fresh?: number } | null
}

interface ProjectStatus {
  slug: string
  name?: string
  state?: string
  /** A proposal's place among the others, as the look for projects ranked them. */
  rank?: number
  priority?: string
  prMode?: string
  issues?: string
  level?: string
  paused?: boolean
  /** `goal` for a project worked toward the user's words in its own folder. A record with no kind is code. */
  kind?: string
  /** How many of a goal's steps are done. */
  done?: number
  open?: number
  prs?: number
  branches?: number
  left?: number
  unmerged?: number
  merged?: number
  nextLookAt?: string | null
  lookError?: string | null
  /** Its TLA+ models on the default branch and hobkin's latest run of each. */
  models?: ModelFact[]
}

/** hobkin's `workStatus`, as the snapshot's `work` holds it. */
interface WorkStatus {
  enabled?: boolean
  folder?: string | null
  autoPick?: boolean
  agents?: number
  agentsAllowed?: number
  /** Whether hobkin has read the subscription's usage. Until it has, work mode runs one agent at a time. */
  subscription?: { known?: boolean } | null
  /** The day's limit, and what has been spent of it so far, in fresh tokens. */
  dailyTokens?: number
  tokensToday?: number
  pause?: { line?: string } | null
  waitingOn?: string | null
  forecast?: { line?: string } | null
  queued?: number
  plan?: PlanRow[]
  projects?: ProjectStatus[]
  /** YOLO mode and each project's readiness, from a hobkin that has it. */
  yolo?: YoloState | null
  /** The user's workload, what holds work mode, the rest of today and an open request for more tokens, from a hobkin that has them (053-work-control-room). */
  workload?: Record<string, unknown>
  holding?: { kind?: string; until?: string | null; line?: string } | null
  outlook?: { startedToday?: number; moreToday?: number; nextAt?: string | null } | null
  allowanceRequest?: { at?: string; limit?: number; proposed?: number; used?: number } | null
}

/**
 * The workload's functions, which only a hobkin with the workload has (053-work-control-room). They are looked up on the module, never imported by
 * name, so the host still loads with an older hobkin, whose state then leaves the workload out and whose `work.workload` says it has none.
 */
export interface WorkloadRuntime {
  setWorkload?: (root: string, change: Parameters<typeof hobkinStore.setWorkload>[1]) => Record<string, unknown>
  workloadOf?: (mode: Record<string, unknown>) => Workload
}
const newerStore = hobkinStore as Partial<typeof hobkinStore>
const HOBKIN_WORKLOAD: WorkloadRuntime = { setWorkload: newerStore.setWorkload, workloadOf: newerStore.workloadOf }

/** Each project's own YOLO mode switch, which only a hobkin that has it can set. Looked up on the module, as the workload is. */
export interface YoloRuntime extends YoloRulesRuntime {
  setYoloProject?: typeof hobkinYolo.setYoloProject
}
const HOBKIN_YOLO: YoloRuntime = {
  setYoloProject: (hobkinYolo as Partial<typeof hobkinYolo>).setYoloProject,
  setYoloRules: (hobkinYolo as unknown as YoloRulesRuntime).setYoloRules,
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1

/** The workload's hours, or null, for always, when either end is missing. */
function hoursFrom(value: unknown): WorkHours | null {
  const hours = value as { from?: unknown; to?: unknown } | null
  if (typeof hours?.from !== 'string' || typeof hours.to !== 'string') return null
  return { from: hours.from, to: hours.to }
}

/** The workload as hobkin sends it. Its own `workloadOf` made it, so this only keeps the window from a shape it cannot draw. */
function workloadFrom(value: Record<string, unknown>): Workload | null {
  const { agents, autoPick, changesADay, dailyTokens, hours, shipFirst, shipFirstAt, reviewOnFinish, reviewPulls } = value
  if (!isCount(agents) || !isCount(dailyTokens) || !isCount(shipFirstAt)) return null
  if (!REVIEW_PULLS.includes(reviewPulls as ReviewPulls)) return null
  return {
    agents,
    autoPick: autoPick === true,
    changesADay: isCount(changesADay) ? changesADay : null,
    dailyTokens,
    hours: hoursFrom(hours),
    shipFirst: shipFirst !== false,
    shipFirstAt,
    reviewOnFinish: reviewOnFinish === true,
    reviewPulls: reviewPulls as ReviewPulls,
  }
}

/** What holds work mode, as hobkin says it. One of a kind the window does not know is left out, so the window says nothing wrong. */
function holdingFrom(holding: WorkStatus['holding']): WorkHolding | null {
  if (!holding || !HOLDING_KINDS.includes(holding.kind as HoldingKind)) return null
  return { kind: holding.kind as HoldingKind, until: holding.until ?? null, line: holding.line ?? '' }
}

function outlookFrom(outlook: WorkStatus['outlook']): WorkOutlook | null {
  if (!outlook) return null
  return {
    startedToday: outlook.startedToday ?? 0,
    moreToday: outlook.moreToday ?? 0,
    nextAt: outlook.nextAt ?? null,
  }
}

function allowanceFrom(asked: WorkStatus['allowanceRequest']): AllowanceRequest | null {
  if (!asked?.at) return null
  return {
    at: asked.at,
    limit: asked.limit ?? 0,
    proposed: asked.proposed ?? 0,
    used: asked.used ?? 0,
  }
}

/** The four, each only when hobkin sends it, since every field the window reads of them is optional. */
function workloadPartsOf(work: WorkStatus): Partial<WorkState> {
  const workload = work.workload ? workloadFrom(work.workload) : null
  return {
    ...(workload ? { workload } : {}),
    ...('holding' in work ? { holding: holdingFrom(work.holding) } : {}),
    ...('outlook' in work ? { outlook: outlookFrom(work.outlook) } : {}),
    ...('allowanceRequest' in work ? { allowance: allowanceFrom(work.allowanceRequest) } : {}),
  }
}

const gradeOf = (value: unknown): Grade | null => (GRADES.includes(value as Grade) ? (value as Grade) : null)
const count = (amount: number, noun: string) => `${amount} ${noun}${amount === 1 ? '' : 's'}`
const sentence = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}${/[.!?]$/.test(words) ? '' : '.'}`

/** Why work mode runs fewer agents than the user chose, as hobkin's terminal says it (`subscriptionLine` in its `src/cli/ui.mjs`). */
function agentsHeldBy({ agents = 0, agentsAllowed = agents, subscription }: WorkStatus): string | null {
  if (agents >= agentsAllowed) return null
  if (subscription?.known === false) return 'Subscription: not known yet, so one agent runs at a time.'
  return `Work mode runs ${count(agents, 'agent')} at a time for now.`
}

/*
 * What an approval card says and offers, in hobkin's terminal words: `reviewLine`, `mergeLine`, `mergeWords` and
 * `cardChoices` in its `src/cli/ui.mjs`, which does not export them. They are written out here as they are there,
 * until hobkin exports them.
 */

const LONGEST_CARD_LINE = 280
/** hobkin sends a proof whole up to this, and a card shows a few lines of it and all of it on Show all (`LONGEST_PROOF` in its `src/cli/work/reads.mjs`). */
const LONGEST_PROOF = 2000
/** One line whatever an agent wrote, and short enough to read at a glance. A longer one ends at its last whole word, with an ellipsis. */
const cardLine = (text: string | null | undefined, most = LONGEST_CARD_LINE): string | null => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return null
  if (flat.length <= most) return flat
  const room = flat.slice(0, most - 1)
  const whole = flat[most - 1] === ' ' ? room : room.replace(/\s*\S*$/, '')
  return `${(whole || room).replace(/[\s,;:]+$/, '')}…`
}

const rated = ({ safety }: ReadyRow) => Boolean(safety) && !safety!.stale
const risky = ({ safety }: ReadyRow) => safety?.grade === 'risky' && !safety.stale

function reviewLine({ safety }: ReadyRow): string {
  if (!safety) return 'Not reviewed. Get it reviewed runs one first, about $2 and 14 minutes.'
  const grade = `${safety.grade} ${safety.rating}`
  return safety.stale ? `Reviewed on an older commit (${grade}), not this one.` : `Reviewed: ${grade} at this commit.`
}

const KIND_WORDS: Record<string, string> = {
  performance: 'Performance work',
  'bug-fix': 'Bug fix',
  'state-machine': 'State machine fix',
  'package-update': 'Package update',
  'small-change': 'Small change',
  feature: 'Feature',
  unclear: 'Unclear kind',
}
/** The five scores in the order hobkin asks them, in the card's words. */
const SCORE_WORDS = [
  ['coverage', 'coverage'],
  ['proof', 'proof'],
  ['safety', 'deploy and data'],
  ['visibility', 'visibility'],
  ['rollback', 'rollback'],
] as const

/**
 * What a review scored the change, in one line. A score says how well a question is answered and is never the review's
 * level, which is the risk of a break. A floor hobkin holds a change by is named, and scores for an older commit say so.
 */
function scoreLine({ review }: ReadyRow): string | null {
  if (!review) return null
  const each = SCORE_WORDS.map(([criterion, words]) => `${words} ${review.scores[criterion]?.score ?? '?'}`).join(', ')
  const floors = review.floors.map(({ criterion, needs }) => `${SCORE_WORDS.find(([name]) => name === criterion)?.[1] ?? criterion} is under ${needs}`)
  const held = floors.length ? ` Held whatever the rate: ${floors.join(', ')}.` : ''
  const older = review.stale ? ' Scored on an older commit, not this one.' : ''
  return `${KIND_WORDS[review.kind] ?? review.kind}, general rate ${review.rate}: ${each}.${held}${older}`
}

/**
 * hobkin's own scores as a review's ratings (spec 058): by hobkin, with what proof is still missing and the commit they
 * were made at, both of which the card's words leave out. Undefined with no scores, or scores of no known commit.
 */
export function hobkinNeedsOf({ review }: ReadyRow): ReviewNeeds | undefined {
  if (!review) return undefined
  // Change Review's own grades, which hobkin keeps for YOLO mode, are the review's ratings already: nothing of hobkin's to show beside them.
  if (review.by === 'change-review') return undefined
  const floors = review.floors.map(({ criterion, score, needs }) => ({ name: criterion, score, needs }))
  return readNeeds({ kind: review.kind, scores: review.scores, missing: review.missing ?? undefined, rate: review.rate, floors, head: review.head, by: 'hobkin' })
}

/** The card's scores, with hobkin's as a review's ratings beside them for the review host to read (`needs`). */
export type HobkinScoring = ChangeScores & { needs?: ReviewNeeds }

/** The same scores in parts, for the review: the card's words for the kind and each score, with its evidence. */
function scoringOf(entry: ReadyRow): HobkinScoring | null {
  const { review } = entry
  if (!review) return null
  const needs = hobkinNeedsOf(entry)
  return {
    ...(needs ? { needs } : {}),
    kind: KIND_WORDS[review.kind] ?? review.kind,
    rate: review.rate,
    scores: SCORE_WORDS.map(([criterion, name]) => ({ name, score: review.scores[criterion]?.score ?? null, evidence: review.scores[criterion]?.evidence ?? '' })),
    floors: review.floors.map(({ criterion, score, needs }) => ({ name: SCORE_WORDS.find(([key]) => key === criterion)?.[1] ?? criterion, score, needs })),
    stale: Boolean(review.stale),
  }
}

/**
 * The layer a stacked change waits for, in words: hobkin lands a stack bottom first and refuses a layer while the one
 * under it has not landed (060-make-it-a-stack). Null for a change that waits for no layer.
 */
function layerItWaitsFor(entry: ReadyRow): string | null {
  if (entry.gap !== 'stacked') return null

  const place = stackOf(entry.stack)
  return place ? `layer ${place.layer - 1} of its stack` : 'the layer under it'
}

function mergeLine(entry: ReadyRow): string {
  const waitsFor = layerItWaitsFor(entry)
  if (waitsFor) return `It cannot merge until ${waitsFor} has landed.`

  const { branch, size, pr, conflict, behind } = entry
  const named = branch ?? 'its branch'
  if (pr) return `It is the PR ${pr}, and merging it merges it on GitHub.`
  if (conflict) return 'It conflicts with the default branch, so it cannot merge until an agent rebases it.'
  if ((behind ?? 0) > 0) return `Refresh and merge brings ${named} up to date with the default branch first and runs its proof again, then merges it on this machine. Nothing is pushed.`
  const lines = size ? ` (${count(size.additions + size.deletions, 'line')})` : ''
  return `Merge it puts ${named}${lines} into the default branch on this machine. Nothing is pushed.`
}

function mergeWords(entry: ReadyRow): string {
  const merge = (entry.behind ?? 0) > 0 ? `Refresh and merge ${entry.pr ? 'the PR' : 'it'}` : entry.pr ? 'Merge the PR on GitHub' : 'Merge it'
  return risky(entry) ? `${merge} anyway: it is rated risky` : merge
}

/** Merge first, its review first when a review rated this commit risky, and an agent to rebase it instead of a merge when it conflicts. */
function choicesOf(entry: ReadyRow): FinishedChange['choices'] {
  const choice = (value: ChangeChoice, label: string) => ({ value, label })
  const diff = choice('diff', 'Show the diff')
  const merge = choice(landingWay(entry), mergeWords(entry))
  const opens = entry.pr ? [choice('open', 'Open the PR in the browser')] : []
  const review = choice('review', rated(entry) ? 'Review it again' : 'Get it reviewed')
  const cancel = choice('decline', 'Cancel it')
  // A layer that waits for the one under it can be read, reviewed and cancelled, and has no yes of its own yet.
  if (layerItWaitsFor(entry)) return [diff, ...opens, review, cancel]
  if (entry.conflict) return [choice('rebase', 'Have an agent rebase it'), diff, ...opens, review, cancel]
  return risky(entry) ? [review, diff, ...opens, merge, cancel] : [merge, diff, ...opens, review, cancel]
}

/**
 * Why a change is in its group. For one that needs the user, the first thing that stands in the way of one yes,
 * in the order hobkin checks them (`oneYesCarries` in `src/cli/work/groups.mjs`), in its own words where it has them.
 */
function reasonOf(entry: ReadyRow, group: GroupName): string {
  const waitsFor = layerItWaitsFor(entry)
  if (waitsFor) return sentence(`${waitsFor} lands first`)
  if (group === 'merge') return groupWords.merge.why(1)
  if (group === 'refresh') return `${count(entry.behind ?? 0, 'commit')} behind its base, so an agent brings it up to date first.`
  if (entry.unread) return sentence(entry.unread)
  if (entry.conflict) return 'It conflicts with the default branch.'
  if (entry.conflict !== false) return 'It has not been checked for conflicts yet.'
  if (!entry.head) return 'The last survey did not read its branch, so there is no commit to pin a yes to.'
  if (entry.proved === false) return 'No proof: nothing recorded shows it works.'
  if (heldByItsGrade(entry)) return `It is rated ${entry.safety!.grade} ${entry.safety!.rating} at this commit.`
  if (entry.left) return `Left for you: ${cardLine(entry.left)}`
  if (entry.holds) return `It brings ${entry.holds} earlier ${entry.holds === 1 ? 'branch' : 'branches'} with it, so one yes would cover more than this card.`
  return 'It needs you to open it.'
}

/** The proof score's evidence and run, when hobkin's own model checks wrote it rather than the review. */
function proofCheckOf({ review }: ReadyRow): FinishedChange['proofCheck'] {
  const proof = review?.scores.proof
  if (proof?.by !== 'hobkin' || !proof.run) return null
  return { line: proof.evidence ?? '', run: proof.run }
}

const isWhole = (value: unknown): value is number => Number.isInteger(value)
const isText = (value: unknown): value is string => typeof value === 'string'
const textOrNull = (value: unknown) => value === null || isText(value)

/** A row's place in a stack when every field is as it should be, else none. */
function stackOf(value: unknown): StackPlace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { id, layer, of, name, below, base } = value as Record<string, unknown>
  if (!isText(id) || id === '') return undefined
  if (!isWhole(layer) || !isWhole(of)) return undefined
  if (of < 2 || layer < 1 || layer > of) return undefined
  if (!textOrNull(name) || !textOrNull(below) || !textOrNull(base)) return undefined
  return { id, layer, of, name, below, base } as StackPlace
}

export function changeOf(entry: ReadyRow, group: GroupName): FinishedChange {
  const stack = stackOf(entry.stack)
  const size = entry.size ? { lines: entry.size.additions + entry.size.deletions, files: entry.size.files } : null
  return {
    key: `${entry.slug}:${entry.item}`,
    slug: entry.slug,
    project: entry.project ?? entry.slug,
    item: entry.item,
    title: shownTitle(entry.title),
    grade: gradeOf(entry.grade),
    branch: entry.branch ?? null,
    head: entry.head ?? null,
    pr: entry.pr ?? null,
    about: cardLine(entry.about ?? entry.summary),
    proof: cardLine(entry.proof, LONGEST_PROOF),
    review: reviewLine(entry),
    yes: mergeLine(entry),
    reason: reasonOf(entry, group),
    safety: entry.safety ? { grade: entry.safety.grade, rating: entry.safety.rating, stale: Boolean(entry.safety.stale) } : null,
    scores: scoreLine(entry),
    scoring: scoringOf(entry),
    ...(entry.models ? { models: entry.models } : {}),
    ...(stack ? { stack } : {}),
    proofCheck: proofCheckOf(entry),
    ...(entry.at ? { at: entry.at } : {}),
    size,
    behind: entry.behind ?? 0,
    conflict: entry.conflict ?? null,
    landing: landingWay(entry),
    choices: choicesOf(entry),
  }
}

/** The kinds of finished work that ask for a yes, as the terminal's Decisions sorts them (`branchType` in its `src/cli/ui.mjs`). */
const asksForAYes = ({ gap = 'land' }: ReadyRow) => !['unlanded', 'elsewhere', 'yours'].includes(gap)
/** The most urgent first. The sort is stable, so rows of one grade keep the order that puts the easiest yes first. */
const urgency = ({ grade }: ReadyRow) => (grades.includes(grade ?? '') ? grades.indexOf(grade!) : grades.length)

/** Finished work in hobkin's groups: what merges as it is, what refreshes first, and what needs the user. */
function finishedFrom(rows: readonly ReadyRow[]): FinishedGroup[] {
  const approval = rows.filter(asksForAYes).toSorted((first, second) => urgency(first) - urgency(second))
  return approvalGroups(approval).map(({ name, rows: entries }) => {
    const changes = entries.map((entry) => changeOf(entry, name))
    if (name === 'needs') return { name, heading: 'Needs you', why: null, action: null, changes }
    const words = groupWords[name]
    return {
      name,
      heading: words.name,
      why: words.why(entries.length),
      action: { label: words.action(entries.length), question: words.question(entries.length), plan: groupPlan(name, entries), underWay: words.underWay(entries.length) },
      changes,
    }
  })
}

/** The layers of a stack in the order they land. */
const bottomFirst = (first: FinishedChange, second: FinishedChange) => (first.stack?.layer ?? 0) - (second.stack?.layer ?? 0)

/**
 * A stack stands whole, in the group its bottom layer is in (060-make-it-a-stack). hobkin files a layer that waits
 * for the one under it with what needs the user, but it needs nothing from the user yet, so it goes under its bottom
 * layer, bottom first, after what that group already held. A waiting layer whose bottom is in no group stays where it
 * was, and a group left with nothing is not sent.
 */
export function stacksTogether(groups: readonly FinishedGroup[]): FinishedGroup[] {
  const groupOf = new Map<string, FinishedGroup['name']>()
  for (const group of groups) {
    for (const change of group.changes) groupOf.set(change.key, group.name)
  }

  /** The group a waiting layer belongs in, when that is another group than the one it is in. */
  const homeOf = (change: FinishedChange, here: FinishedGroup['name']): FinishedGroup['name'] | null => {
    const waits = change.stack && change.stack.below !== null
    if (!waits) return null

    const home = groupOf.get(`${change.slug}:${change.stack!.id}`)
    return home && home !== here ? home : null
  }

  const leaving = groups.flatMap((group) => group.changes.flatMap((change) => {
    const home = homeOf(change, group.name)
    return home ? [{ change, home }] : []
  }))
  if (!leaving.length) return [...groups]

  const gone = new Set(leaving.map(({ change }) => change.key))
  return groups
    .map((group) => {
      const staying = group.changes.filter(({ key }) => !gone.has(key))
      const arriving = leaving.filter(({ home }) => home === group.name).map(({ change }) => change).toSorted(bottomFirst)
      return { ...group, changes: [...staying, ...arriving] }
    })
    .filter(({ changes }) => changes.length > 0)
}

const queueRowOf = (row: PlanRow): QueueRow => ({
  key: row.key,
  kind: row.kind,
  slug: row.slug ?? null,
  project: row.project ?? row.slug ?? '',
  item: row.item ?? null,
  title: row.title,
  grade: gradeOf(row.grade),
  why: row.why || null,
  waiting: row.waiting || null,
  skipped: Boolean(row.skipped),
  picked: Boolean(row.picked),
  tokens: row.estimate?.fresh ?? null,
})

const PROJECT_STATES: readonly ProjectState[] = ['chosen', 'proposed', 'skipped', 'dropped']

const projectOf = (project: ProjectStatus): WorkProject => ({
  slug: project.slug,
  name: project.name ?? project.slug,
  state: PROJECT_STATES.includes(project.state as ProjectState) ? (project.state as ProjectState) : 'proposed',
  priority: gradeOf(project.priority) ?? 'P2',
  prMode: PR_MODES.includes(project.prMode as PrMode) ? (project.prMode as PrMode) : 'off',
  issues: ISSUE_PICKUPS.includes(project.issues as IssuePickup) ? (project.issues as IssuePickup) : 'off',
  level: project.level ?? 'important',
  paused: Boolean(project.paused),
  ...(project.kind === 'goal' ? { kind: 'goal' as const, ...(Number.isInteger(project.done) ? { done: project.done } : {}) } : {}),
  open: project.open ?? 0,
  prs: project.prs ?? 0,
  branches: project.branches ?? 0,
  left: project.left ?? 0,
  unmerged: project.unmerged ?? 0,
  merged: project.merged ?? 0,
  nextLookAt: project.nextLookAt ?? null,
  lookError: project.lookError ?? null,
  ...(project.models ? { models: project.models } : {}),
})

/**
 * Every project work mode knows: the ones taken, by priority as the terminal's Work tab lists them, then the
 * proposals in the order the look ranked them, then the ones left alone. Each sort keeps the order of equals.
 */
function projectsFrom(projects: readonly ProjectStatus[]): WorkProject[] {
  const inState = (state: ProjectState) => projects.filter((project) => project.state === state)
  return [
    ...inState('chosen').toSorted(byPriority),
    ...inState('proposed').toSorted(byRank),
    ...inState('skipped'),
    ...inState('dropped'),
  ].map(projectOf)
}

/**
 * Work mode as the Work screen draws it, from hobkin's snapshot: its switch, its queue in its order, the projects it
 * knows, and the finished changes in the groups one yes can finish, as the terminal's Decisions lists them.
 * Null for a snapshot with no work mode in it, such as the view the terminal saved.
 */
export function workFrom(snapshot: HobkinSnapshot): WorkState | null {
  const work = snapshot.work as WorkStatus | undefined
  if (!work || typeof work !== 'object') return null
  const waiting = snapshot.waiting as { branches?: ReadyRow[] } | null | undefined
  return {
    enabled: work.enabled === true,
    folder: work.folder ?? null,
    autoPick: work.autoPick === true,
    held: work.pause?.line ?? work.waitingOn ?? null,
    forecast: work.forecast?.line ?? null,
    agents: work.agents ?? 0,
    agentsAllowed: work.agentsAllowed ?? work.agents ?? 0,
    agentsHeld: agentsHeldBy(work),
    maxAgents: MAX_AGENTS,
    dailyTokens: typeof work.dailyTokens === 'number' ? work.dailyTokens : null,
    tokensToday: typeof work.tokensToday === 'number' ? work.tokensToday : null,
    queue: (work.plan ?? []).map(queueRowOf),
    queued: work.queued ?? 0,
    projects: projectsFrom(work.projects ?? []),
    finished: stacksTogether(finishedFrom(waiting?.branches ?? [])),
    yolo: yoloFrom(work.yolo),
    ...workloadPartsOf(work),
  }
}

export interface WorkSeat {
  /** hobkin's application. Throws, with the reason, while hobkin is not open in this host. */
  app: () => WorkApp
  /** The folder the home's data is in. */
  root: () => string
  /** hobkin's workload functions, when it has them. The ones hobkin's store exports unless a test says otherwise. */
  workload?: WorkloadRuntime
  /** hobkin's setter of one project's YOLO mode switch, when it has one. hobkin's own unless a test says otherwise. */
  yolo?: YoloRuntime
}

type WorkCommand =
  | 'work.mode'
  | 'work.queue'
  | 'work.project'
  | 'work.proposal'
  | 'work.agents'
  | 'work.tokens'
  | 'work.workload'
  | 'work.allowance'
  | 'work.yolo'
  | 'work.yolo.ready'
  | 'work.yolo.project'
  | 'work.yolo.rules'
  | 'work.change'
  | 'work.group'

/** y and n on a proposal in the terminal: take it, or leave it alone. */
const PROPOSAL_ANSWERS = { take: 'choose', skip: 'skip' } as const

/** The terminal's keys on a queue row: Enter runs it next, s skips it, and s on a skipped row puts it back. Start now has no key there. */
const QUEUE_ACTIONS = { run: 'run', now: 'now', skip: 'later', back: 'back' } as const
const CHANGE_ACTIONS = { merge: 'merge', 'merge-pr': 'mergePr', 'refresh-merge': 'refreshMerge', review: 'review', ask: 'ask', decline: 'decline', done: 'done' } as const

interface Reply {
  message?: unknown
  told?: { line?: unknown; heard?: boolean }[] | { line?: unknown }
}

const messageOf = (result: unknown) => String((result as Reply | null)?.message ?? '')

/** The Work screen's commands. Each is one of hobkin's own work actions, and a refusal comes back in hobkin's words. */
export function workHandlers({ app, root, workload = HOBKIN_WORKLOAD, yolo = HOBKIN_YOLO }: WorkSeat): Pick<HostHandlers, WorkCommand> {
  const done = { ok: true } as const
  return {
    'work.mode': async ({ on, folder }) => {
      if (on) {
        // hobkin's own switch, from the folder given or the one it keeps. It files what to start first for the user and starts nothing.
        await app().workAction('start', folder)
        return { enabled: true }
      }
      // `toggle` would turn work mode back on if it were already off, so it is asked only while it is on.
      if (readMode(root()).enabled) await app().workAction('toggle')
      return { enabled: false }
    },
    'work.queue': async ({ row, action }) => {
      const said = await app().workAction(QUEUE_ACTIONS[action], row)
      const message = messageOf(said)
      // Start now says whether the row started, or what still holds it.
      return message ? { ...done, message } : done
    },
    'work.project': async ({ slug, priority, prs, issues, paused }) => {
      if (priority) await app().workAction('priority', slug, priority)
      else if (prs) await app().workAction('prs', slug, prs)
      else if (paused !== undefined) await app().workAction(paused ? 'pauseProject' : 'resumeProject', slug)
      else await app().workAction('issues', slug, issues)
      return done
    },
    'work.proposal': async ({ slug, answer }) => {
      await app().workAction(PROPOSAL_ANSWERS[answer], slug)
      return done
    },
    'work.agents': async ({ agents }) => {
      // hobkin's work actions have no key for this. It is `hobkin work agents`, which writes work mode's own file.
      const mode = setAgents(root(), agents)
      await app().refresh()
      return { agents: mode.agents }
    },
    'work.tokens': async ({ tokens }) => {
      // Also not a work action: `hobkin work tokens` writes work mode's own file, and the plan reads the limit from it at its next tick.
      const mode = setDailyTokens(root(), tokens)
      await app().refresh()
      return { tokens: mode.dailyTokens }
    },
    'work.workload': async (change) => {
      const { setWorkload, workloadOf } = workload
      if (!setWorkload || !workloadOf) throw new Unavailable('This hobkin keeps no workload yet. Update hobkin to set it from here.')
      // Not a work action either: hobkin's own setter checks every value before it writes any, and the plan reads them at its next tick.
      const mode = setWorkload(root(), change)
      await app().refresh()
      return workloadOf(mode)
    },
    'work.allowance': async ({ at }) => {
      // Once for a request: the window names the request it saw, so a second click, or one on a request since answered or replaced, raises nothing.
      const open = currentRequest(readMode(root()))
      if (open?.at !== at) throw new Error('That request for more tokens today is answered already, so nothing was raised.')
      // hobkin's own yes to its request, which adds today's amount again until midnight.
      await app().workAction('allow')
      return { tokens: dailyLimit(readMode(root())) }
    },
    'work.yolo': async ({ on, rate }) => {
      // The user's click and nothing else: no work action and no `hobkin work` command changes YOLO mode, so the host
      // calls the runtime's own function. Turning it on merges nothing and files each project's readiness work.
      const yolo = setYolo(root(), { ...(on === undefined ? {} : { on }), ...(rate === undefined ? {} : { rate }) })
      await app().refresh()
      return { on: yolo.on, rate: yolo.rate }
    },
    // hobkin's own work action, which starts the readiness run the way Start now starts a queue row. It merges nothing.
    'work.yolo.ready': async ({ slug }) => {
      const said = await app().workAction('ready', slug)
      return { message: messageOf(said) }
    },
    'work.yolo.project': async ({ slug, on }) => {
      // The user's click alone, as with the main switch, so the host calls the runtime's own setter.
      const { setYoloProject } = yolo
      if (!setYoloProject) throw new Unavailable('This hobkin has no YOLO mode switch for each project yet. Update hobkin to set one from here.')
      const set = setYoloProject(root(), slug, on)
      await app().refresh()
      return { slug: set.slug, on: set.on }
    },
    'work.yolo.rules': async ({ slug, rules, clear }) => {
      // The user's click alone: the command is outside, and hobkin has no `hobkin work` command for it, so the host calls the
      // runtime's own setter, which checks every value before it writes any and refuses in its own words.
      const { setYoloRules } = yolo
      if (!setYoloRules) throw new Unavailable(NO_YOLO_RULES)
      const answer = setYoloRules(root(), slug ?? null, { ...rules, ...(clear ? { same: clear } : {}) })
      await app().refresh()
      return { slug: slug ?? null, rules: rulesAnswered(answer) }
    },
    'work.change': async ({ slug, item, action, head, note }) => {
      const named = CHANGE_ACTIONS[action]
      const lands = named === 'merge' || named === 'mergePr' || named === 'refreshMerge'

      let said: unknown
      if (named === 'ask') said = await app().workAction(named, slug, item, note ?? '')
      // A landing is pinned to the commit the card showed, so a change that moved since is refused.
      else if (lands) said = await app().workAction(named, slug, item, head ? { head } : {})
      else said = await app().workAction(named, slug, item)

      return { message: messageOf(said) }
    },
    'work.group': async ({ rows }) => {
      const result = (await app().workAction('group', rows)) as Reply | null
      // Each row is told the way its own card would be, and the line that sums them up is the message.
      const told = Array.isArray(result?.told) ? result.told : []
      return { message: messageOf(result), lines: told.filter(({ heard }) => !heard).map(({ line }) => String(line ?? '')) }
    },
  }
}
