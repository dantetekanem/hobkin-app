/**
 * The user's questions of every AI review (spec 058, from spec 049): do tests cover the change, were tests added or
 * changed to prove it, does it risk the deploy or data, would a regression show in the monitoring, and how fast it
 * rolls back. Each is a whole number from 1 to 10 with a line of evidence. With them: the kind of change, what proof is
 * still missing, the general rate and the floors by hobkin's own formula when they can be worked out, the commit they
 * were made at, and who made them: the change review, or hobkin's own scored run. Read without trust, so a window can
 * take them from any host.
 */
import { isCleanProse } from './prose.ts'

/** The five questions, in the order hobkin asks them (`CRITERIA` in hobkin's `classified.mjs`). */
export const NEED_NAMES = ['coverage', 'proof', 'safety', 'visibility', 'rollback'] as const
export type NeedName = (typeof NEED_NAMES)[number]

/** The kinds of change hobkin names (`KINDS` in hobkin's `classified.mjs`). */
export const NEED_KINDS = ['performance', 'bug-fix', 'state-machine', 'package-update', 'small-change', 'feature', 'unclear'] as const
export type NeedKind = (typeof NEED_KINDS)[number]

/** One answer: a whole number from 1 to 10, and the one line of evidence it rests on. */
export interface NeedScore {
  score: number
  evidence: string
}

export interface ReviewNeeds {
  /** The kind of change. Missing when none was given. */
  kind?: NeedKind
  /**
   * Each answer that was given. One can be missing: visibility, when nothing is known of the project's monitoring, as
   * for most pull requests.
   */
  scores: Partial<Record<NeedName, NeedScore>>
  /** What proof is still wanted, in a line. */
  missing?: string
  /** hobkin's general rate of the five, only when all five are there. */
  rate?: number
  /** The answers under hobkin's floor for them, which hold the change whatever the rate: each with the number it needs. */
  floors?: { name: NeedName; score: number; needs: number }[]
  /** The full commit they were made at. */
  head: string
  /** Who made them: this change review, from its Reviewer's one answer, or hobkin's own scored run. */
  by: 'change-review' | 'hobkin'
  /** When they were made, as an ISO time. */
  at?: string
}

/** The most characters a line of evidence, or of what is missing, has: hobkin's own limit. */
export const NEED_LINE_LIMIT = 400

const COMMIT = /^[0-9a-f]{40}$/
const record = (value: unknown): Record<string, unknown> | undefined => (value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)
const isScore = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 10
const isLine = (value: unknown): value is string => isCleanProse(value, NEED_LINE_LIMIT) && value.trim() !== '' && !/[\r\n]/.test(value.trim())
const isName = (value: unknown): value is NeedName => NEED_NAMES.includes(value as NeedName)

function scoreOf(value: unknown): NeedScore | undefined {
  const answer = record(value)
  return answer && isScore(answer.score) && isLine(answer.evidence) ? { score: answer.score, evidence: answer.evidence.trim() } : undefined
}

function floorOf(value: unknown): NonNullable<ReviewNeeds['floors']>[number][] {
  const floor = record(value)
  return floor && isName(floor.name) && isScore(floor.score) && isScore(floor.needs) ? [{ name: floor.name, score: floor.score, needs: floor.needs }] : []
}

/** A review's ratings as a host sent them, or undefined when they cannot be placed: no full commit, or no maker. */
export function readNeeds(value: unknown): ReviewNeeds | undefined {
  const sent = record(value)
  if (!sent || typeof sent.head !== 'string' || !COMMIT.test(sent.head) || (sent.by !== 'change-review' && sent.by !== 'hobkin')) return undefined
  const given = record(sent.scores)
  const scores: ReviewNeeds['scores'] = {}
  for (const name of NEED_NAMES) {
    const answer = scoreOf(given?.[name])
    if (answer) scores[name] = answer
  }
  const kind = NEED_KINDS.includes(sent.kind as NeedKind) ? (sent.kind as NeedKind) : undefined
  const rate = typeof sent.rate === 'number' && Number.isFinite(sent.rate) && sent.rate >= 1 && sent.rate <= 10 ? sent.rate : undefined
  return {
    ...(kind ? { kind } : {}),
    scores,
    ...(isLine(sent.missing) ? { missing: sent.missing.trim() } : {}),
    ...(rate != null ? { rate } : {}),
    ...(Array.isArray(sent.floors) ? { floors: sent.floors.flatMap(floorOf) } : {}),
    head: sent.head,
    by: sent.by,
    ...(typeof sent.at === 'string' && !Number.isNaN(Date.parse(sent.at)) ? { at: sent.at } : {}),
  }
}

/** Every rating a host sent for a review, each read without trust; none from a host that sends none. */
export function readNeedsList(value: unknown): ReviewNeeds[] {
  return Array.isArray(value) ? value.flatMap((entry) => readNeeds(entry) ?? []) : []
}
