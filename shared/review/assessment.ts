/**
 * The change review of a finished change, as the host tells the window (spec 032): how its run stands, the card's
 * summary once it is ready, and the story with its units for the Review screen. The objects themselves are the
 * change-review package's, which stands apart from this app.
 */
import type { BlindCheck, Level, Progress, Triage, Units } from '../../packages/change-review/src/types.ts'

export type { Level, Units, Unit, Triage, Progress, BlindCheck } from '../../packages/change-review/src/types.ts'

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
  /** Every rated definition, where it sits at head, for laying levels over the graph. Tests are not rated. */
  nodes: RatedNode[]
}

/** One rated definition: its file and lines at head, its level, and the unit it is told in. */
export interface RatedNode {
  id: string
  symbol: string
  path: string
  lines: [number, number]
  level: Level
  critical: boolean
  unit: string | null
}

/** The words for a level, as the review page and the card say them. */
export const LEVEL_WORDS: Record<Level, string> = { high: 'Needs you', mid: 'Worth a look', safe: 'Safe' }
