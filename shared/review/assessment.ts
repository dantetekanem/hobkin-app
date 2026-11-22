/**
 * The change review of a finished change, as the host tells the window (spec 032): how its run stands, the card's
 * summary once it is ready, and the story with its units for the Review screen. The objects themselves are the
 * change-review package's, which stands apart from this app.
 */
import type { BlindCheck, Effect, Exposure, Level, Progress, Proof, Triage, Undo, Units } from '../../packages/change-review/src/types.ts'

export type { Level, Units, Unit, Triage, Progress, BlindCheck, StoryWords } from '../../packages/change-review/src/types.ts'

/** The card's line: the worst level, whether anything is critical, and how many units sit at each level. */
export interface AssessmentSummary {
  level: Level
  critical: boolean
  /** Units at `high`. */
  needsYou: number
  /** Units at `mid`. */
  worthALook: number
  /** Units at `safe`. */
  safe: number
  /** A model wrote the story's words and checked it, or the facts alone did because no model was asked. */
  storyBy: 'model' | 'host'
  /** When it finished, as an ISO time. */
  at: string
  /** The review's one answer for the whole change. A summary written before the answer existed has none: `deployOf` gives it. */
  deploy?: Deploy
  /** Why, in a sentence or two: what breaks, or what was and was not shown. */
  why?: string
  /** The review of this change before this one, when there was one: its commit, its answer and when it finished. */
  before?: { head: string; deploy: Deploy; at: string }
}

/** The one question a review answers, for the whole change and never for a part of it: is it risky or safe to deploy? */
export type Deploy = 'risky' | 'safe'

/** The answer as the window says it. */
export const DEPLOY_WORDS: Record<Deploy, string> = { risky: 'Risky to deploy', safe: 'Safe to deploy' }

/** A review's answer: risky only when a part of the change can break. What no test showed is no risk. */
export const deployOf = (summary: Pick<AssessmentSummary, 'level' | 'deploy'>): Deploy => summary.deploy ?? (summary.level === 'high' ? 'risky' : 'safe')

/**
 * What happened between the review before this one and this one, in a sentence, so two answers for one change can be
 * told apart: whether the code moved, and whether the answer did. Null for a first review. `head` is this review's commit.
 */
export function sinceLastReview(summary: Pick<AssessmentSummary, 'level' | 'deploy' | 'before'>, head: string | null | undefined): string | null {
  const { before } = summary
  if (!before) return null
  const now = deployOf(summary)
  const sameCode = Boolean(head) && (head!.startsWith(before.head) || before.head.startsWith(head!))
  const answer = now === before.deploy ? `The answer is the same: ${DEPLOY_WORDS[now].toLowerCase()}.` : `The answer went from ${DEPLOY_WORDS[before.deploy].toLowerCase()} to ${DEPLOY_WORDS[now].toLowerCase()}.`
  if (sameCode) return `Reviewed again at the same commit, ${before.head.slice(0, 7)}: no code changed since the last review. ${answer}`
  return `The last review was of ${before.head.slice(0, 7)}${head ? `, and this one is of ${head.slice(0, 7)}` : ''}: the code changed in between. ${answer}`
}

/** Why the answer is what it is: the review's own sentence, else what its counts say. */
export function deployWhy(summary: Pick<AssessmentSummary, 'level' | 'deploy' | 'why' | 'needsYou' | 'worthALook' | 'safe' | 'critical'>): string {
  if (summary.why) return summary.why
  const parts = (count: number) => `${count} part${count === 1 ? '' : 's'}`
  if (deployOf(summary) === 'risky') return `${parts(Math.max(1, summary.needsYou))} can break.${summary.critical ? ' It needs a fix, not only a look.' : ''}`
  if (summary.worthALook > 0) return `Nothing found that breaks. ${parts(summary.worthALook)} ${summary.worthALook === 1 ? 'was' : 'were'} not shown working by a test that ran.`
  return 'Every part is shown to work, or cannot break anything.'
}

/**
 * `idle`: none for this commit and none under way. `queued`: waiting its turn (one runs at a time). `running`: under
 * way, with how far along it is and what it is doing. `ready`: finished, with its summary. `failed`: it stopped, with why.
 */
export type AssessmentState = 'idle' | 'queued' | 'running' | 'ready' | 'failed'

/** What a change review was asked to review, so the window can say it before the review exists. */
export interface AssessmentRequest {
  kind: 'change' | 'pull'
  /** The project, or `owner/repo` for a pull request. */
  project: string
  /** A pull request's number. */
  number?: number
  title: string
  /** The commits compared, in full. */
  base: string
  head: string
  files: number
  added: number
  removed: number
}

/** One line of what a run did, oldest first, as the host's clock tells it. */
export interface AssessmentLogLine {
  /** ISO time. */
  at: string
  /** The step it belongs to, by id, when it belongs to one. */
  step?: string
  text: string
}

export interface AssessmentStatus {
  state: AssessmentState
  /** The commit it is for. */
  head: string | null
  /** What it reviews: the project, the title, the commits and the size of the change. */
  request?: AssessmentRequest
  /** For a run under way or just ended: the latest lines of what it did, oldest first, at most 40. */
  log?: AssessmentLogLine[]
  /** For a run under way: 0 to 100, weighted by each step's estimate. */
  percent?: number
  /** For a run under way: one sentence on what it is doing now. */
  now?: string
  /** For a run under way: seconds left, by the estimates. */
  eta?: number | null
  /** For a run under way: when it started, as an ISO time from the host's clock. */
  startedAt?: string
  /** For a run under way: every step, how it stands, and how long the finished ones took, measured. */
  steps?: { id: string; status: string; done: number; total: number; seconds: number | null; note?: string }[]
  summary?: AssessmentSummary
  error?: string
  /** For a ready review of hobkin's own change that says risky to deploy: what hobkin does about it. */
  fix?: RiskFix
}

/**
 * What hobkin does when the AI review of its own finished change says risky to deploy (spec 032, A37 to A39).
 * `fixing`: an agent of hobkin's is making it safe, or goes to it once work mode runs again (`held`). `fixed`: that
 * agent moved the change to a newer commit, which has a review of its own. `waiting`: hobkin stopped, and the change
 * is the user's: after its rounds, after a round that left it as it was, or because its agent left a step only the user
 * can take.
 */
export interface RiskFix {
  state: 'fixing' | 'fixed' | 'waiting'
  /** The round it is on, or the last one sent, from 1. 0 when none was sent. */
  round: number
  /** The most rounds hobkin sends to one change. */
  rounds: number
  /** Why nothing starts now, in hobkin's words: "work mode is off", "shop is paused". */
  held?: string
  why?: 'rounds' | 'unchanged' | 'left'
  /** The Action Item that says what the user must do, by its id, once hobkin filed it. */
  action?: string
}

const roundOf = ({ round, rounds }: RiskFix) => `round ${Math.max(1, round)} of ${rounds}`

/** What hobkin is doing about a risky answer, in a sentence: "hobkin is fixing it (round 1 of 2)." */
export function riskFixWords(fix: RiskFix): string {
  if (fix.state === 'fixing') return fix.held ? `Nothing starts while ${fix.held}: hobkin fixes it after that (${roundOf(fix)}).` : `hobkin is fixing it (${roundOf(fix)}).`
  if (fix.state === 'fixed') return `hobkin's fix is in a newer commit, which gets its own review (${roundOf(fix)}).`
  if (fix.why === 'left') return "Waiting on you: hobkin's agent left a step only you can take."
  if (fix.why === 'unchanged') return "Still risky: hobkin's fix left it as it was. Waiting on you."
  return `Still risky after ${fix.rounds} rounds: waiting on you.`
}

/** The same, short enough for a card's badge: "Risky: hobkin is fixing it". */
export function riskFixLabel(fix: RiskFix): string {
  if (fix.state === 'fixing') return fix.held ? 'Risky: fix waits for work mode' : 'Risky: hobkin is fixing it'
  if (fix.state === 'fixed') return 'Risky: fixed in a newer commit'
  return fix.why === 'rounds' ? `Still risky after ${fix.rounds} rounds` : 'Still risky: waiting on you'
}

/** A finished change review, for the Review screen to show first. */
export interface ChangeAssessment {
  head: string
  summary: AssessmentSummary
  /** The story, as Markdown, read top to bottom. */
  story: string
  units: Units | null
  triage: Triage | null
  blind: { ran: boolean; check: BlindCheck | null; note?: string } | null
  progress: Progress | null
  /** Every rated definition, where it sits at head, or at base for one the change removed, for laying levels over the graph. Tests are not rated. */
  nodes: RatedNode[]
}

/**
 * One rated definition: its file and lines at head, its level, and the unit it is told in. The rest is what the change
 * review found of it, which decides how much of the reviewer's attention it asks for (spec 053). Each of those is
 * missing on a definition an older host read.
 */
export interface RatedNode {
  id: string
  symbol: string
  path: string
  lines: [number, number]
  level: Level
  critical: boolean
  unit: string | null
  /** The change removed it, so `lines` are its lines at base. */
  removed?: true
  /** What its change does, at its worst: `text` changes only comments or whitespace. */
  effect?: Effect
  /** How far the tests that ran show it working. `none`: no test reaches it. */
  proof?: Proof
  exposure?: Exposure
  undo?: Undo
  /** What the review found of it, by the kind of thing found and who found it: a test it breaks, a reference left dangling. */
  findings?: { rule: string; by: string }[]
  /** How many questions it leaves the reviewer. */
  questions?: number
  /** Its entry in the map could not be checked. */
  unverified?: boolean
  /** How sure the model was of its rating, when it said. */
  confidence?: 'low' | 'medium' | 'high'
  /** Names in it that touch money, sign-in, tenants and the like. */
  sensitive?: string[]
  /** How many places call it, as the scan counted them. */
  callers?: number
  /** What the blind check said of its unit: whether it agreed with the unit's level, and the level it would give. */
  blind?: { agrees: boolean; level?: Level | null }
}

/** The words for a level, as the review page and the card say them. */
export const LEVEL_WORDS: Record<Level, string> = { high: 'High risk', mid: 'Mid risk', safe: 'Safe' }
