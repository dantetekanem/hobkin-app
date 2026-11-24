/**
 * "Your questions" (spec 058 A13): the user's five questions of every AI review, a finished change and a pull request
 * alike, each with its number out of 10 and its one line of evidence, in the user's own order and words; then the kind
 * of change, the general rate, any floor that holds it, what is still missing, and who rated it at which commit. The
 * numbers are the review's own, read without trust from what the host sends (`needs`); hobkin's own scored run, where a
 * finished change has one, is told apart under them. The evidence is what the user reads: a number the facts capped says
 * so in its evidence, as the engine wrote it. Pure.
 */
import type { ChangeScores } from '#shared/protocol/work.ts'
import { NEED_KINDS, NEED_NAMES, readNeedsList, type NeedKind, type NeedName, type NeedScore, type ReviewNeeds } from '#shared/review/needs.ts'

/** The five questions, in the user's order and words. */
export const QUESTIONS: Readonly<Record<NeedName, string>> = {
  coverage: 'Do tests cover the change?',
  proof: 'Were tests added or changed to prove it, and what is missing?',
  safety: 'Does it risk the deploy or data?',
  visibility: 'Would a regression show in the monitoring?',
  rollback: 'What is the risk and the time to roll back?',
}

/** A short word for each, for a row of the list where there is room for little more than the number. */
export const NEED_WORDS: Readonly<Record<NeedName, string>> = { coverage: 'Cover', proof: 'Proof', safety: 'Deploy', visibility: 'Watch', rollback: 'Undo' }

/** Each question's name in a sentence, as hobkin's floors name it. */
const NAME_WORDS: Readonly<Record<NeedName, string>> = { coverage: 'coverage', proof: 'proof', safety: 'deploy and data', visibility: 'visibility', rollback: 'rollback' }

const KIND_WORDS: Readonly<Record<NeedKind, string>> = {
  performance: 'Performance',
  'bug-fix': 'Bug fix',
  'state-machine': 'State machine',
  'package-update': 'Package update',
  'small-change': 'Small change',
  feature: 'Feature',
  unclear: 'Kind unclear',
}

/** What the visibility row says when nothing is known of the repository's monitoring, as for most pull requests. */
export const NO_MONITORING = 'Monitoring is not known for this repository.'
/** The number of a question with no answer. */
const NONE = '–'

const short = (commit: string) => commit.slice(0, 7)

/** The ratings of a review: its own, and hobkin's own scored run's. Either can be missing. */
export interface Ratings {
  yours: ReviewNeeds | null
  hobkins: ReviewNeeds | null
}

/** The names hobkin's older scores give the five questions, as the Work card says them. */
const SCORE_NAMES: Readonly<Record<string, NeedName>> = { coverage: 'coverage', proof: 'proof', 'deploy and data': 'safety', visibility: 'visibility', rollback: 'rollback' }

/** hobkin's older scores in the ratings' shape: its kind and its names read back, and no commit when they are for an older one. */
function fromScores(scores: ChangeScores, head: string): ReviewNeeds {
  const kind = scores.kind.toLowerCase().replaceAll(' ', '-')
  const answers: ReviewNeeds['scores'] = {}
  for (const { name, score, evidence } of scores.scores) {
    const known = SCORE_NAMES[name]
    if (known && score != null) answers[known] = { score, evidence }
  }
  const floors = scores.floors.flatMap(({ name, score, needs }) => {
    const known = SCORE_NAMES[name]
    return known ? [{ name: known, score, needs }] : []
  })

  return {
    ...(NEED_KINDS.includes(kind as NeedKind) ? { kind: kind as NeedKind } : {}),
    scores: answers,
    rate: scores.rate,
    floors,
    head: scores.stale ? '' : head,
    by: 'hobkin',
  }
}

/** Of several ratings by the same maker, the one made at the commit shown, else the newest. */
function pick(list: readonly ReviewNeeds[], head: string): ReviewNeeds | null {
  const at = list.find((needs) => needs.head === head)
  if (at) return at
  const newestFirst = [...list].sort((a, b) => Date.parse(b.at ?? '') - Date.parse(a.at ?? ''))
  return newestFirst[0] ?? null
}

/**
 * A status's ratings, read without trust: the review's own, the one made at the commit shown first; and hobkin's own,
 * from its ratings, else from the older scores it sends. None from a host that sends none.
 */
export function ratingsOf(status: { needs?: unknown; scores?: ChangeScores | null } | null | undefined, head: string): Ratings {
  const sent = readNeedsList(status?.needs)
  const yours = pick(sent.filter((needs) => needs.by === 'change-review'), head)
  const hobkins = pick(sent.filter((needs) => needs.by === 'hobkin'), head) ?? (status?.scores ? fromScores(status.scores, head) : null)
  return { yours, hobkins }
}

/** `rated`: all five, or all but visibility with monitoring known. `unwatched`: no visibility, as with no monitoring known. */
export type QuestionsState = 'rated' | 'unwatched' | 'older' | 'pending' | 'unrated'

export interface QuestionRow {
  name: NeedName
  question: string
  /** Its number out of 10, or a dash with none. */
  number: string
  /** Its one line of evidence, as the review wrote it. Empty with no answer. */
  evidence: string
}

export interface QuestionsView {
  state: QuestionsState
  /** Always the five, in the user's order. The panel draws them only for a review that was rated. */
  rows: QuestionRow[]
  /** The kind of change and the general rate, or that it is not rated. */
  lead: string
  /** The floors that hold it whatever the rate, in a line. */
  floors: string | null
  /** What proof is still missing, or why there are no ratings. */
  note: string | null
  /** Who rated it and at which commit. */
  by: string | null
}

const lineOf = (parts: readonly (string | null)[]) => {
  const said = parts.filter((part): part is string => Boolean(part)).join(' · ')
  return said.charAt(0).toUpperCase() + said.slice(1)
}

function rowsOf(needs: ReviewNeeds | null, unwatched: boolean): QuestionRow[] {
  return NEED_NAMES.map((name) => {
    const answer: NeedScore | undefined = needs?.scores[name]
    const evidence = answer?.evidence ?? (needs && name === 'visibility' && unwatched ? NO_MONITORING : '')
    return { name, question: QUESTIONS[name], number: answer ? String(answer.score) : NONE, evidence }
  })
}

function floorsOf(needs: ReviewNeeds): string | null {
  if (!needs.floors?.length) return null
  const held = needs.floors.map(({ name, score, needs: wanted }) => `${NAME_WORDS[name]} is ${score}, needs ${wanted}`)
  return `Held whatever the rate: ${held.join('; ')}.`
}

/**
 * The review's own ratings as its panel opens with them. With none, a line says whether they are coming with the review
 * being built, or why there are none, and the panel draws no rows.
 */
export function questionsView({ yours, head, underWay }: { yours: ReviewNeeds | null; head: string; underWay: boolean }): QuestionsView {
  if (!yours) {
    return underWay
      ? { state: 'pending', rows: rowsOf(null, false), lead: 'Not rated yet: the review is being built.', floors: null, note: 'Its ratings come with its answer.', by: null }
      : { state: 'unrated', rows: rowsOf(null, false), lead: 'Not rated. Review again rates it.', floors: null, note: 'This review is older than the ratings, or its answer gave none.', by: null }
  }

  const unwatched = notWatched(yours)
  // The host says when they were made at another commit than the one shown, as for a carried review, in its own words.
  const older = yours.atOtherCommit != null || yours.head !== head
  const kind = yours.kind ? KIND_WORDS[yours.kind] : null
  const rate = yours.rate != null ? `general rate ${yours.rate}` : unwatched ? 'no general rate without monitoring' : null
  const by = older ? (yours.atOtherCommit ?? `Rated at ${short(yours.head)}, an older commit than this review shows`) : `Rated by this review at ${short(yours.head)}`
  return {
    state: older ? 'older' : unwatched ? 'unwatched' : 'rated',
    rows: rowsOf(yours, unwatched),
    lead: lineOf([kind, rate]),
    floors: floorsOf(yours),
    note: yours.missing ? `Still missing: ${yours.missing}` : null,
    by,
  }
}

/** No visibility, because nothing is known of the repository's monitoring: not a visibility the review left out. */
const notWatched = (needs: ReviewNeeds) => needs.scores.visibility == null && needs.monitoring !== 'given'

/** `none`: hobkin has not scored it. `agrees`: within a point of the review's on every question both answer, so it folds. */
export type HobkinState = 'none' | 'agrees' | 'differs' | 'alone'

export interface HobkinView {
  state: HobkinState
  lead: string
  rows: (QuestionRow & { differs: string | null })[]
  floors: string | null
  /** Set when its scores are for an older commit than the one shown. */
  older: string | null
}

/** Two numbers agree when they are at most a point apart. */
const AGREE = 1

/**
 * hobkin's own scored run, told apart under the review's own: folded when both are there and agree within a point on
 * every question both answer, open with each difference marked when they do not, and open alone when the review has no
 * ratings of its own. `head` is the commit shown, when its scores are to be checked against it.
 */
export function hobkinView(yours: ReviewNeeds | null, hobkins: ReviewNeeds | null, head?: string): HobkinView {
  if (!hobkins) return { state: 'none', lead: 'It has not scored this change.', rows: [], floors: null, older: null }

  const rows = rowsOf(hobkins, false).map((row) => {
    const mine = hobkins.scores[row.name]?.score
    const theirs = yours?.scores[row.name]?.score
    const apart = mine != null && theirs != null && Math.abs(mine - theirs) > AGREE
    return { ...row, differs: apart ? `${theirs} in this review` : null }
  })
  const kind = hobkins.kind ? KIND_WORDS[hobkins.kind] : null
  const rate = hobkins.rate != null ? `general rate ${hobkins.rate}` : null
  const state: HobkinState = !yours ? 'alone' : rows.some((row) => row.differs) ? 'differs' : 'agrees'
  // Its heading names it as hobkin's, so its line says only what it found.
  const said = [kind, rate].filter(Boolean).join(', ')
  return {
    state,
    lead: said ? `${said.charAt(0).toUpperCase()}${said.slice(1)}` : 'Scored, with no kind or rate',
    rows,
    floors: floorsOf(hobkins),
    older: head != null && hobkins.head !== head ? 'Scored on an older commit, not this one.' : null,
  }
}

/** A row's five numbers in the user's order, each with its short word, and the general rate. */
export interface NeedNumbers {
  numbers: { name: NeedName; word: string; value: string }[]
  rate: string | null
  /** The commit they were made at, short. */
  at: string
  /** Set when they were made at another commit than the row's, so they never read as current: which, in words. */
  other: string | null
}

/** What visibility says on a row with no monitoring known: never a number, never a dash that reads as nothing. */
const NOT_KNOWN = 'not known'

/** The review's own ratings as a row of the list shows them, or null when the review is not rated. `head` is the row's commit. */
export function needNumbers(needs: unknown, head = ''): NeedNumbers | null {
  const yours = pick(readNeedsList(needs).filter((entry) => entry.by === 'change-review'), head)
  if (!yours) return null

  const valueOf = (name: NeedName) => {
    const answer = yours.scores[name]
    if (answer) return String(answer.score)
    return name === 'visibility' && notWatched(yours) ? NOT_KNOWN : NONE
  }
  const elsewhere = head !== '' && yours.head !== head ? `Rated at ${short(yours.head)}, an older commit than the change is at now` : null
  return {
    numbers: NEED_NAMES.map((name) => ({ name, word: NEED_WORDS[name], value: valueOf(name) })),
    rate: yours.rate != null ? String(yours.rate) : null,
    at: short(yours.head),
    other: yours.atOtherCommit ?? elsewhere,
  }
}

/**
 * A change's rate, who rated it and at which commit, in words, for the YOLO mode page: "Rate 7.4, rated by the AI
 * review at abc1234". Null when the review is not rated. `needs` is the field as the host sent it.
 */
export function rateWords(needs: unknown, head = ''): string | null {
  const yours = pick(readNeedsList(needs).filter((entry) => entry.by === 'change-review'), head)
  if (!yours) return null
  const by = `rated by the AI review at ${short(yours.head)}`
  if (yours.rate != null) return `Rate ${yours.rate}, ${by}`
  const why = yours.scores.visibility == null ? 'No general rate: monitoring is not known.' : 'No general rate.'
  return `${why} ${by.charAt(0).toUpperCase()}${by.slice(1)}`
}
