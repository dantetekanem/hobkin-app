/**
 * Work numbers as the window draws them (_specs/053-work-control-room): what work mode did on each day, folded from
 * records hobkin and the host already keep (items, events, the YOLO ledger, reviews, proof runs), so the charts have
 * history from the first day. Read with `work.metrics`. Every field a newer host adds is optional, so an older window
 * still works.
 */

/** The most days one read covers. */
export const METRICS_DAYS_MAX = 180
/** The days a read covers when it names none. */
export const METRICS_DAYS_DEFAULT = 30

/** One local day, of one project or of all of them. Each count is of things that happened on that day. */
export interface MetricsDay {
  /** The local day, as `YYYY-MM-DD`. */
  day: string
  /** Work runs that started. */
  started: number
  /** Changes that reached Finished changes. */
  finished: number
  /** Changes hobkin merged with no yes, in YOLO mode. */
  mergedByItself: number
  /** Changes merged on the user's yes, wherever it was given. */
  mergedByYou: number
  /** Changes the user said no to. */
  declined: number
  /** Times a change was sent back for more work. */
  sentBack: number
  /** Of the changes merged or declined that day, those never sent back before. */
  firstPass: number
  /** AI reviews that ended with "safe to deploy". */
  reviewsSafe: number
  /** AI reviews that ended with "risky to deploy". */
  reviewsRisky: number
  /** AI reviews that stopped before an answer. */
  reviewsFailed: number
  /** Model checks and proofs that ended with every rule holding. */
  proofsHold: number
  /** Model checks and proofs that ended broken. */
  proofsBroken: number
  /** Questions hobkin asked the user about work. */
  questions: number
  /** Runs the user stopped. */
  stops: number
  /** Fresh tokens work mode spent. */
  tokens: number
  /** Changes merged by themselves whose reading after their deploy regressed. */
  regressed: number
}

/** How long something took over the whole period, in milliseconds. Null with nothing to measure. */
export interface MetricsSpan {
  median: number | null
  p90: number | null
  /** How many were measured. */
  count: number
}

export interface MetricsSpans {
  /** From a change reaching Finished changes to the user's yes or no. */
  waitForYou: MetricsSpan
  /** From a change's first run starting to its merge. */
  startToMerge: MetricsSpan
  /** From an AI review starting to its answer. */
  aiReview: MetricsSpan
}

export interface MetricsSeries {
  /** Every day of the period, oldest first, with zeros where nothing happened. */
  days: MetricsDay[]
  spans: MetricsSpans
}

export interface ProjectMetrics extends MetricsSeries {
  slug: string
  name: string
}

export interface WorkMetrics {
  /** The first and last local day covered. */
  from: string
  to: string
  /** When it was folded, as an ISO time. */
  at: string
  /** Every project together. */
  all: MetricsSeries
  /** Each project work mode has taken, by name. */
  projects: ProjectMetrics[]
  /** What could not be read, in plain words. The rest still counts. */
  gaps: string[]
}

/** A day with nothing in it. */
export const emptyMetricsDay = (day: string): MetricsDay => ({
  day,
  started: 0,
  finished: 0,
  mergedByItself: 0,
  mergedByYou: 0,
  declined: 0,
  sentBack: 0,
  firstPass: 0,
  reviewsSafe: 0,
  reviewsRisky: 0,
  reviewsFailed: 0,
  proofsHold: 0,
  proofsBroken: 0,
  questions: 0,
  stops: 0,
  tokens: 0,
  regressed: 0,
})

/**
 * The rates the pages show, over any run of days. Each is null when its base is zero, so a page says "no data yet"
 * and never 0% or 100% of nothing.
 */
export interface MetricsRates {
  merged: number
  /** Of everything merged, the share hobkin merged by itself. */
  byItselfShare: number | null
  /** Of the changes merged or declined, the share never sent back first. */
  firstPassRate: number | null
  /** Times sent back for each change merged. */
  sentBackPerMerged: number | null
  /** Of the AI reviews that gave an answer, the share that said risky. */
  riskyShare: number | null
  /** Of the changes merged by themselves, the share that regressed after their deploy. */
  regressedShare: number | null
  /** Fresh tokens for each change merged. */
  tokensPerMerged: number | null
}

const share = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null)

export function ratesOf(days: readonly MetricsDay[]): MetricsRates {
  const sum = (pick: (day: MetricsDay) => number) => days.reduce((total, day) => total + pick(day), 0)
  const byItself = sum((day) => day.mergedByItself)
  const merged = byItself + sum((day) => day.mergedByYou)
  const decided = merged + sum((day) => day.declined)
  const answered = sum((day) => day.reviewsSafe + day.reviewsRisky)
  return {
    merged,
    byItselfShare: share(byItself, merged),
    firstPassRate: share(sum((day) => day.firstPass), decided),
    sentBackPerMerged: share(sum((day) => day.sentBack), merged),
    riskyShare: share(sum((day) => day.reviewsRisky), answered),
    regressedShare: share(sum((day) => day.regressed), byItself),
    tokensPerMerged: share(sum((day) => day.tokens), merged),
  }
}
