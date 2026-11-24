/**
 * The user's five questions on a review (spec 058, A12): the change review's own answers as its graph.json holds them,
 * with hobkin's general rate and floors worked out here by hobkin's own formula (`classified.mjs`), and the lines of
 * hobkin's readiness record the Reviewer is handed about the project's monitoring and its way back. The rate needs all
 * five; a review with no visibility, because nothing is known of the monitoring, has the floors of the four there and
 * no rate. Nothing is ever guessed: a review whose answers did not hold is not rated.
 */
import { brokenFloors, generalRate } from 'hobkin/src/cli/work/classified.mjs'
import { NEED_NAMES, readNeeds, type NeedName, type ReviewNeeds } from '#shared/review/needs.ts'
import type { ChangeRating, ReviewTurn } from '#shared/review/status.ts'

/** The readiness parts that say whether a regression would show, and how the change comes back out: what the Reviewer is told. */
const TOLD_PARTS = ['errors', 'slowQueries', 'performance', 'logs', 'alerts', 'rollback', 'deploy'] as const
/** The most lines, and characters a line, the engine takes of them. */
const MOST_LINES = 12
const LONGEST_LINE = 200

/** A score no floor holds, for the answers that are missing when hobkin's floors are worked out over all five. */
const NO_FLOOR = 10

/** The ratings with hobkin's general rate, when all five are there, and its floors of those that are. */
export function withHobkinRate(needs: ReviewNeeds): ReviewNeeds {
  const given = NEED_NAMES.filter((name) => needs.scores[name] != null)
  const all = Object.fromEntries(NEED_NAMES.map((name) => [name, { score: needs.scores[name]?.score ?? NO_FLOOR }])) as Record<NeedName, { score: number }>
  const floors = brokenFloors(all)
    .filter(({ criterion }) => given.includes(criterion))
    .map(({ criterion, score, needs: wanted }) => ({ name: criterion, score, needs: wanted }))
  const rate = given.length === NEED_NAMES.length ? generalRate(all) : undefined
  const { rate: _rate, floors: _floors, ...answered } = needs
  return { ...answered, ...(rate != null ? { rate } : {}), floors }
}

/**
 * The change review's ratings as its graph.json holds them, or undefined when the review is not rated. The engine sends
 * no rate and no floors; any it sent would not be read, since hobkin's formula is worked out here.
 */
export function engineNeeds(graph: unknown): ReviewNeeds | undefined {
  const sent = graph != null && typeof graph === 'object' ? (graph as { needs?: unknown }).needs : undefined
  const read = readNeeds(sent)
  return read?.by === 'change-review' ? withHobkinRate(read) : undefined
}

/** hobkin's readiness record of a project, as far as its monitoring and its way back go. `at` is null before any record. */
export interface Readiness {
  at: string | null
  parts: Record<string, { state: string; line?: string } | undefined>
}

/**
 * What hobkin's readiness record says of a project's monitoring and its way back, one line for each part, as the
 * Reviewer is handed it. Undefined for a project never recorded: then nothing is known of its monitoring.
 */
export function monitoringLines(readiness: Readiness | null, words: Readonly<Record<string, string>>): string[] | undefined {
  if (!readiness?.at) return undefined
  const lines = TOLD_PARTS.flatMap((name) => {
    const part = readiness.parts[name]
    if (!part?.line) return []
    const said = part.state === 'done' ? part.line : `not in place: ${part.line}`
    return [`${words[name] ?? name}: ${said}`.slice(0, LONGEST_LINE)]
  })
  return lines.length ? lines.slice(0, MOST_LINES) : undefined
}

/** What a change's rating state is made from. `head` is the commit the change is at. */
export interface RatingFacts {
  head: string | null
  /** The ratings known for the change, from any commit. */
  needs: readonly ReviewNeeds[]
  /** Its change review is building now. */
  running: boolean
  /** Where it waits in its repository's line, when it does. */
  turn?: ReviewTurn
  /** What the last review at this commit said of its ratings not holding, and the tries made. */
  notRated?: { tries: number; why: string }
  /** The tries the rules allow. */
  tries: number
  /** The try the engine is on, when it says so while a review runs again. */
  tryNow?: number
  /** The change only edits Markdown, so there is nothing to rate. */
  nothingToRate?: boolean
}

const short = (head: string) => head.slice(0, 7)
const firstSentence = (text: string) => /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text

/**
 * Where a change's ratings stand (spec 063): rated at its commit, rating now, waiting its turn, rating again, or not rated
 * after the tries with why, and never a blank. A rating made at another commit is shown beside it, marked older, and
 * is never the change's own: YOLO mode does not use it.
 */
export function ratingOf({ head, needs, running, turn, notRated, tries, tryNow, nothingToRate }: RatingFacts): ChangeRating {
  if (nothingToRate) return { state: 'nothing', text: 'Nothing to rate: it only edits Markdown.' }
  const own = needs.filter((entry) => entry.by === 'change-review')
  const here = head ? own.find((entry) => entry.head === head && entry.rate != null) : undefined
  if (here) return { state: 'rated', text: `Rated at ${short(here.head)}: ${here.rate}`, head: here.head, rate: here.rate! }

  const elsewhere = own.find((entry) => entry.head !== head && entry.rate != null)
  const older = elsewhere && head ? { older: { head: elsewhere.head, rate: elsewhere.rate!, text: `Rated at ${short(elsewhere.head)}: ${elsewhere.rate}, older: the change is at ${short(head)} now.` } } : {}

  if (running && notRated) return { state: 'again', text: tryNow ? `Rating again, try ${tryNow} of ${tries}` : 'Rating again', ...(tryNow ? { tries: tryNow } : {}), of: tries, ...older }
  if (notRated) return { state: 'not-rated', text: `Not rated after ${notRated.tries} ${notRated.tries === 1 ? 'try' : 'tries'}: ${notRated.why}`, tries: notRated.tries, ...older }
  if (running) return { state: 'rating', text: 'Rating now', ...older }
  if (turn) return { state: 'waits', text: turn.ahead > 0 ? `Waits its turn: ${turn.ahead} ahead` : `Waits its turn: ${firstSentence(turn.why)}`, ahead: turn.ahead, ...older }
  return { state: 'waits', text: 'Waits its turn', ...older }
}
