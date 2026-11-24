/**
 * The user's five questions of every AI review (spec 058 A13), a finished change and a pull request alike, as numbers
 * out of 10 in the user's order. The panel shows only the numbers, each with its question and its line of evidence as
 * its tooltip (`scoresLine`), and a row of the list shows them in a few words (`needNumbers`). The numbers are the
 * review's own, read without trust from what the host sends (`needs`); hobkin's own scored run, where a finished change
 * has one, is told apart on the same line. Pure.
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
export type ScoresState = 'rated' | 'unwatched' | 'older' | 'pending' | 'unrated'

/** The panel's word for each question, whole, where the numbers have a line to themselves. */
export const PANEL_WORDS: Readonly<Record<NeedName, string>> = { coverage: 'Coverage', proof: 'Proof', safety: 'Safety', visibility: 'Visibility', rollback: 'Rollback' }

/** One score on the line: its word and number, and its tooltip, which is its question and its line of evidence. */
export interface ScoreItem {
  name: NeedName
  word: string
  /** The number, or a dash with none. */
  value: string
  tip: string
  /** hobkin's own number when it is more than a point from this one, so the line can mark it. */
  hobkin: string | null
}

/**
 * The five scores as the panel's one line. `rate`: the general rate, first on the line when there is one. `holds`: what
 * holds the change whatever the rate, one line. `tip`: the rest in a tooltip, the kind, why there is no rate, what is
 * still missing and who rated it at which commit. `quiet`: the one short line a review with no ratings shows instead of
 * the numbers. `by`: "hobkin" when the numbers are hobkin's own scored run, shown because the review has none of its own.
 */
export interface ScoresLine {
  state: ScoresState
  items: ScoreItem[]
  rate: string | null
  holds: string | null
  tip: string
  quiet: string | null
  by: 'review' | 'hobkin'
  /** Whether the numbers were made at another commit than the one shown, so they never read as current. */
  older: boolean
}

const lineOf = (parts: readonly (string | null)[]) => {
  const said = parts.filter((part): part is string => Boolean(part)).join(' · ')
  return said.charAt(0).toUpperCase() + said.slice(1)
}

/** Two numbers are apart when they are more than a point from each other. */
const APART = 1

function floorsOf(needs: ReviewNeeds): string | null {
  if (!needs.floors?.length) return null
  const held = needs.floors.map(({ name, score, needs: wanted }) => `${NAME_WORDS[name]} is ${score}, needs ${wanted}`)
  return `Held whatever the rate: ${held.join('; ')}.`
}

function itemsOf(needs: ReviewNeeds, unwatched: boolean, other: ReviewNeeds | null): ScoreItem[] {
  return NEED_NAMES.map((name) => {
    const answer: NeedScore | undefined = needs.scores[name]
    const evidence = answer?.evidence ?? (name === 'visibility' && unwatched ? NO_MONITORING : '')
    const theirs = other?.scores[name]?.score
    const hobkin = answer && theirs != null && Math.abs(theirs - answer.score) > APART ? String(theirs) : null
    return {
      name,
      word: PANEL_WORDS[name],
      value: answer ? String(answer.score) : NONE,
      tip: [QUESTIONS[name], evidence, hobkin ? `hobkin's own run scored it ${hobkin}.` : ''].filter(Boolean).join(' '),
      hobkin,
    }
  })
}

/**
 * The scores line (spec 058): the review's own five numbers, each a short word and its number, with the general rate
 * first. Each number's question and evidence are its tooltip. A review with no ratings has one short line instead.
 * hobkin's own scored run is never a second block: where it is more than a point from the review's on a question, that
 * number carries hobkin's in its tooltip and a mark. Where the review has no ratings of its own, hobkin's numbers are
 * the line, marked as hobkin's. Pure.
 */
export function scoresLine({ yours, hobkins, head, underWay }: { yours: ReviewNeeds | null; hobkins?: ReviewNeeds | null; head: string; underWay: boolean }): ScoresLine {
  const own = yours ?? null
  const shown = own ?? hobkins ?? null
  if (!shown) {
    const quiet = underWay ? 'Not rated yet: the review is being built.' : 'Not rated. Review again rates it.'
    return { state: underWay ? 'pending' : 'unrated', items: [], rate: null, holds: null, tip: quiet, quiet, by: 'review', older: false }
  }

  const unwatched = notWatched(shown)
  // The host says when they were made at another commit than the one shown, as for a carried review, in its own words.
  const older = shown.atOtherCommit != null || shown.head !== head
  const kind = shown.kind ? KIND_WORDS[shown.kind] : null
  const rate = shown.rate != null ? `general rate ${shown.rate}` : unwatched ? 'no general rate without monitoring' : null
  const by = older ? (shown.atOtherCommit ?? `Rated at ${short(shown.head)}, an older commit than this review shows`) : `Rated by ${own ? 'this review' : 'hobkin'} at ${short(shown.head)}`
  const tip = [lineOf([kind, rate]), shown.missing ? `Still missing: ${shown.missing}` : null, by].filter(Boolean).join('\n')
  return {
    state: older ? 'older' : unwatched ? 'unwatched' : 'rated',
    items: itemsOf(shown, unwatched, own ? (hobkins ?? null) : null),
    rate: shown.rate != null ? String(shown.rate) : null,
    holds: floorsOf(shown),
    tip,
    quiet: null,
    by: own ? 'review' : 'hobkin',
    older,
  }
}

/** No visibility, because nothing is known of the repository's monitoring: not a visibility the review left out. */
const notWatched = (needs: ReviewNeeds) => needs.scores.visibility == null && needs.monitoring !== 'given'

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
  const by = `rated by the review at ${short(yours.head)}`
  if (yours.rate != null) return `Rate ${yours.rate}, ${by}`
  const why = yours.scores.visibility == null ? 'No general rate: monitoring is not known.' : 'No general rate.'
  return `${why} ${by.charAt(0).toUpperCase()}${by.slice(1)}`
}
