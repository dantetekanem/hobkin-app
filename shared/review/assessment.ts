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

export interface AssessmentStatus {
  state: AssessmentState
  /** The commit it is for. */
  head: string | null
  /** For a run under way: 0 to 100, weighted by each step's estimate. */
  percent?: number
  /** For a run under way: one sentence on what it is doing now. */
  now?: string
  /** For a run under way: seconds left, by the estimates. */
  eta?: number | null
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
