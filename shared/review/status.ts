/**
 * How a review's preparation stands, and what a verdict will do, as the host tells the window.
 * See _specs/005-review-model and _specs/009-review-notes.
 */
import type { ChangeScores } from '../protocol/work.ts'
import type { AssessmentStatus, ChangeAssessment } from './assessment.ts'
import type { ReviewNeeds } from './needs.ts'
import type { NoteEntry, NoteIntent } from './notes.ts'
import { isCleanProse } from './prose.ts'
import type { NodeIO, NodeKind, NodeStatus, Review, ReviewPath } from './types.ts'
import type { PullReviewPost, Verdict } from './verdict.ts'

/**
 * Whether a review opens now. `ready`: one does, even while a newer one is prepared. `preparing`: none yet, and one is
 * on its way. `failed`: none could be prepared. `idle`: none, and nothing is under way.
 */
export type PrepareState = 'idle' | 'preparing' | 'ready' | 'failed'

/** What the preparation under way is doing: waiting its turn, reading the change, arranging its story with the agent, or checking the result. */
export type PreparePhase = 'queued' | 'reading' | 'arranging' | 'checking'

export interface ReviewStatus {
  id: string
  state: PrepareState
  /** Null when nothing is under way. */
  phase: PreparePhase | null
  /** While a preparation is queued or under way: when it was asked for, as an ISO time from the host's clock. */
  startedAt?: string
  /** The commit the change is at, when known. */
  head: string | null
  /** A review is ready, for an older commit than the change is at now. It opens, and a new one is on its way. */
  stale: boolean
  /** When the ready review was prepared, as an ISO time. */
  preparedAt: string | null
  /** Why the last preparation failed, in plain words. A ready review can carry one: the newer one could not be prepared. */
  error: string | null
  /** Who wrote the storyline: the agent with the change-review skill, or the host alone when no model was asked. */
  storyBy: 'agent' | 'host' | null
  /** Where hobkin last moved the reviewer's view: a step, by its number from 1, or a node. The window follows a newer one. */
  cursor?: ReviewCursor
  /** When hobkin last left a note, so the window fetches the notes again. */
  notesAt?: number
  /**
   * For a finished change, or a pull request the user asked to review: how its change review (spec 032) stands at the
   * commit the change is at.
   */
  assessment?: AssessmentStatus
  /** For a finished change the user said yes to: being brought up to date to merge, or merged. A state, never an error. */
  landing?: ReviewLanding
  /** A merge the user asked for that has not happened: still on its way, or refused. Gone once it merges. */
  mergeAsked?: MergeAsked
  /**
   * For a pull request whose review recorded it: who opened it, and whether it is the user's. Only the user's own is
   * merged or closed from here. A review prepared before this was recorded has none, and reads as someone else's.
   */
  owner?: PullOwner
  /** For a finished change that opened a pull request: that pull request's page, as its card gives the address. */
  pr?: string
  /** For a finished change hobkin's own scored review scored: its kind, general rate and five scores. A pull request has none. */
  scores?: ChangeScores
  /**
   * The user's five questions answered (spec 058): the change review's own ratings at the commit they were made at, and
   * hobkin's scored run's when it has some, each saying who made it. Missing from an older host.
   */
  needs?: ReviewNeeds[]
  /** Where the change stands in its repository's line of reviews, when the background is not building it now (spec 058). */
  turn?: ReviewTurn
  /** Where its ratings stand, always, for a finished change (spec 063). A host older than this does not send it. */
  rating?: ChangeRating
  /** The review was carried to this commit from an older one, not built again (spec 058). */
  carried?: ReviewCarried
  /**
   * Review again was asked with nothing changed since the review (spec 058, A6): it was not built, because that costs
   * a whole review, and `why` says so. Asking again soon builds it.
   */
  again?: { why: string }
  /**
   * For a finished change this host looked up: the commit the change starts from, at the commit it is at. A review
   * built from another start does not show the change as it is.
   */
  startsAt?: string
  /**
   * Whether the change's code is stale: how many commits it is behind the branch it merges into, whether it conflicts
   * with it, and that branch's name. Each is null when not known. The window offers a refresh when `behind` is above 0
   * or `conflict` is true.
   */
  code?: { behind: number | null; conflict: boolean | null; base: string | null }
}

/** A person a pull request names: their name, and their profile when it is known. */
export interface ReviewPerson {
  name: string
  url?: string
}

/** Who a pull request is from: its author, and who it is for when an agent opened it because they asked. */
export interface ReviewPeople {
  author: ReviewPerson | null
  for?: ReviewPerson
}

/** Whose a pull request is: its author as its host names them, and whether it is the user's own. */
export interface PullOwner {
  author: string | null
  mine: boolean
}

/**
 * A merge the user asked for, kept until it happens, so a yes that did not land is never lost from sight. `waiting`:
 * something runs first, as when its branch is brought up to date. `failed`: it was refused, and `why` is the reason given.
 */
export interface MergeAsked {
  /** When the user said merge, as an ISO time. */
  at: string
  state: 'waiting' | 'failed'
  why?: string
  /** For a merge a code host does in its own time: what it does once asked, in the code host file's words. */
  message?: string
  /** The confirmation the merge was asked with, so the same yes again asks nothing more. */
  confirm?: string
}

/**
 * Where a finished change stands after the user's yes. `refreshing`: an agent brings it up to date with its default
 * branch, and hobkin merges it once that run ends well; its head moving meanwhile is that, not a new change to review.
 * `merged`: it landed, as `sha`, into `into`.
 */
export interface ReviewLanding {
  state: 'refreshing' | 'merged'
  /** The commit it landed as. */
  sha?: string
  /** When the refresh was asked for, or when it merged, as an ISO time. */
  at?: string
  /** The branch it merges into. */
  into?: string
  /** What happened, in plain words. */
  message?: string
}

export interface ReviewCursor {
  step?: number
  node?: string
  /** When it was set, in milliseconds. */
  at: number
}

export interface ReviewNotes {
  entries: NoteEntry[]
  draft: { intent: 'comment' | 'question'; text: string; editing?: string } | null
}

export interface OpenedReview {
  review: Review
  notes: ReviewNotes
  status: ReviewStatus
  /** For a finished change or a pull request: its change review (spec 032), once one is ready for the review's commit; null until then. */
  assessment?: ChangeAssessment | null
}

/** Exactly what a verdict will do, shown before it is done. `confirm` must come back unchanged for it to go. */
export interface VerdictPreview {
  verdict: Verdict
  /** What will happen, in plain words, line by line. */
  lines: string[]
  /** For a pull request: the review GitHub will get. */
  post?: PullReviewPost
  /** For a finished hobkin change: the note hobkin's agent will get when changes are asked for. */
  note?: string
  /**
   * For a pull request: the corrections the grammar check did not make, since they could change what the user meant.
   * The user takes one in by changing their own words, as pi-coder asks the user for each.
   */
  suggested?: { original: string; suggestion: string }[]
  confirm: string
}

/** A review as hobkin reads it: every node, wire, path and step, and its notes, without code ranges or hashes. */
export interface ReviewMap {
  id: string
  title: string
  summary: string
  /** The commit the review was built for. */
  head: string
  /** The change has moved on since. The review still opens, and a rebuild brings it up to date. */
  outdated: boolean
  notices: string[]
  nodes: { id: string; kind: NodeKind; title: string; path?: string; summary: string; io?: NodeIO; status?: NodeStatus; warning?: string }[]
  wires: { id: string; from: string; to: string; kind: string; label?: string; proposed?: true }[]
  paths: ReviewPath[]
  steps: { step: number; title: string; focus: string[]; path?: string }[]
  notes: { id: string; step: number; about: string; intent: NoteIntent; author: 'user' | 'hobkin'; text: string; sent: boolean }[]
}

/** The lines of one node, numbered, by the side of the change they are on. */
export interface ReviewCode {
  node: string
  title: string
  path?: string
  parts: { side: 'added' | 'deleted'; startLine: number; endLine: number; text: string }[]
}

/** One review the host knows, for the list of AI reviews: what it is about, how it stands, and when it last changed. */
export interface ReviewListItem {
  id: string
  kind: 'change' | 'pull'
  title: string
  /** The project, or `owner/repo` for a pull request. */
  project: string
  head: string | null
  state: PrepareState
  phase: PreparePhase | null
  /** While a preparation is queued or under way: when it was asked for, as an ISO time. */
  startedAt?: string
  error: string | null
  /** For a finished change or a pull request: how its change review stands, without its steps. */
  assessment?: AssessmentStatus
  /** A merge the user asked for that has not happened. */
  mergeAsked?: MergeAsked
  /** For a pull request whose review recorded it: who opened it, and whether it is the user's. */
  owner?: PullOwner
  /** For a finished change that opened a pull request: that pull request's page, as its card gives the address. */
  pr?: string
  /** For a finished change hobkin's own scored review scored: its general rate. */
  rate?: number
  /** The user's five questions answered, as on the review's status (spec 058). Missing from an older host. */
  needs?: ReviewNeeds[]
  /** Why the background does not build it now, and how many are ahead of it in its repository's line (spec 058). */
  turn?: ReviewTurn
  /** Where its five ratings stand (spec 063). A host older than this does not send it. */
  rating?: ChangeRating
  /** The review is of an older commit than the change is at, and waits its turn to be built again (spec 058). */
  outdated?: { builtFor: string }
  /** The review was carried to the change's commit from an older one, not built again (spec 058). */
  carried?: ReviewCarried
  /**
   * A finished change the background prepares when its turn comes: nothing has started at its commit yet, or what started
   * was cut short and starts again. A host older than this does not send it.
   */
  waiting?: true
  /** The changed lines (additions plus deletions) of the change its review was built from. Missing for a review never built. */
  lines?: number
  /** When any of it last changed, as an ISO time. */
  updatedAt: string
}

/**
 * Where a change's five ratings stand (spec 063): one of these always, and `text` says it in the row's words. An
 * `older` rating was made at another commit, which it names, and is not the change's own.
 */
export interface ChangeRating {
  state: 'rated' | 'rating' | 'waits' | 'again' | 'not-rated' | 'nothing'
  text: string
  /** Rated: the commit and the general rate. */
  head?: string
  rate?: number
  /** Not rated: the tries made. Rating again: the try it is on, when the engine said. */
  tries?: number
  /** Rating again: the tries the rules allow. */
  of?: number
  /** Waits its turn: how many are ahead. */
  ahead?: number
  older?: { head: string; rate: number; text: string }
}

/** Where a change stands in its repository's line: how many are ahead of it, and why it waits, in plain words. */
export interface ReviewTurn {
  ahead: number
  /** Such as "Waits its turn: 3 ahead in shop." or "It conflicts, so it is reviewed after its rebase." */
  why: string
}

/** A review carried to a newer commit: the commit it was built for, and why it still holds, in plain words. */
export interface ReviewCarried {
  from: string
  why: string
}

/** One repository's line above its rows (spec 058): its reviews current, waiting and outdated, and this week's cost. */
export interface ReviewRepoLine {
  /** The project, or `owner/repo` for pull requests. */
  project: string
  current: number
  waiting: number
  outdated: number
  /** Reviews built in the last seven days. */
  builtThisWeek: number
  /** About how many model tokens they took, once they are recorded. */
  tokensThisWeek?: number
}

export interface ReviewList {
  /** Newest first. */
  reviews: ReviewListItem[]
  /** A line for each repository with rows (spec 058). Missing from an older host. */
  repos?: ReviewRepoLine[]
}

const FULL_COMMIT = /^[0-9a-f]{40}$/
const asRecord = (value: unknown): Record<string, unknown> | undefined => (value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const isWords = (value: unknown): value is string => isCleanProse(value, 300) && value.trim() !== ''

/** A row's place in its repository's line, as a host sent it, or undefined. */
export function readTurn(value: unknown): ReviewTurn | undefined {
  const turn = asRecord(value)
  return turn && isCount(turn.ahead) && isWords(turn.why) ? { ahead: turn.ahead, why: turn.why } : undefined
}

/** A row's outdated mark, as a host sent it, or undefined. */
export function readOutdated(value: unknown): ReviewListItem['outdated'] {
  const outdated = asRecord(value)
  return outdated && typeof outdated.builtFor === 'string' && FULL_COMMIT.test(outdated.builtFor) ? { builtFor: outdated.builtFor } : undefined
}

/** Where a carried review came from, as a host sent it, or undefined. */
export function readCarried(value: unknown): ReviewCarried | undefined {
  const carried = asRecord(value)
  return carried && typeof carried.from === 'string' && FULL_COMMIT.test(carried.from) && isWords(carried.why) ? { from: carried.from, why: carried.why } : undefined
}

/** The list's line for each repository, each read without trust; none from a host that sends none. */
export function readRepoLines(value: unknown): ReviewRepoLine[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): ReviewRepoLine[] => {
    const line = asRecord(entry)
    if (!line || !isWords(line.project)) return []
    const { current, waiting, outdated, builtThisWeek, tokensThisWeek } = line
    if (![current, waiting, outdated, builtThisWeek].every(isCount)) return []
    return [{ project: line.project, current: current as number, waiting: waiting as number, outdated: outdated as number, builtThisWeek: builtThisWeek as number, ...(isCount(tokensThisWeek) ? { tokensThisWeek } : {}) }]
  })
}

/**
 * Whether the review list shows a review as a row: something of it ran, runs or waits its turn, or a merge the user
 * asked for failed. A merge that waits has no row: the user gave their yes, and it is not theirs to act on until it
 * fails. One that is only known, as a review the user stopped before anything ran, is no row.
 */
export function shownAsRow(item: ReviewListItem): boolean {
  if (item.mergeAsked) return item.mergeAsked.state === 'failed'
  if (item.waiting) return true
  if (item.state !== 'idle') return true
  const assessment = item.assessment?.state
  return assessment != null && assessment !== 'idle'
}

export const IDLE_STATUS = (id: string): ReviewStatus => ({ id, state: 'idle', phase: null, head: null, stale: false, preparedAt: null, error: null, storyBy: null })
