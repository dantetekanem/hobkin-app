/**
 * What the YOLO rules say of the reviews (spec 063): how many a repository keeps current, how many tries the five
 * ratings get, and which pull requests are rated by themselves. Read without trust: a runtime older than rules sends
 * none, and a value the rules would not hold is no setting, so the defaults stand.
 */
import { REVIEW_PULLS, type ReviewPulls, type YoloRules } from '#shared/protocol/work.ts'

/** The most tries the rules allow, as the runtime's range does. */
const MOST_TRIES = 10

/** A cap the rules name: a whole number from 1, null for none (no limit), undefined when they name none that holds. */
export function capOf(rules: YoloRules | undefined, name: 'keptCurrent'): number | null | undefined {
  const value = rules?.[name]
  if (value === null) return null
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined
}

/** The tries to get all five ratings, a whole number from 1 to 10, or undefined for the engine's own. */
export function triesOf(rules: YoloRules | undefined): number | undefined {
  const value = rules?.tries
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MOST_TRIES ? value : undefined
}

/** Which pull requests are rated by themselves: the rules' word, else the workload's, else none. */
export function pullsOf(rules: YoloRules | undefined, workload: ReviewPulls | undefined): ReviewPulls {
  const value = rules?.reviewPulls
  return REVIEW_PULLS.includes(value as ReviewPulls) ? (value as ReviewPulls) : (workload ?? 'none')
}
