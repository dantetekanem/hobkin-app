import type { Answer, Choice, Question, QuestionQueue } from '../questions/queue.ts'

/**
 * Action items: everything waiting on the user. hobkin calls them decisions (`src/cli/decisions.mjs`), and
 * `ActionItem` is the shape it files them in, so the host's list reads as it is. Pure, so the rules can be
 * tested without a window. Spec: 012-reports-actions.
 */

/** Where an answer goes. Its kind says what the item is: `routine`, `work`, `merge`, `pickup` and so on. */
export interface AnswerTo {
  kind: string
  [field: string]: unknown
}

export interface ActionItem {
  id: string
  /** Keeps one open question from becoming several. */
  key: string | null
  /** Who asks: hobkin, a routine ("Routine inbox-sweep"), work mode, or another session. */
  from: string
  question: string
  /** hobkin's short form of the question. */
  tldr: string
  choices: Choice[]
  answerTo: AnswerTo | null
  /** The value of the choice hobkin recommends, and why. */
  recommended: string | null
  why: string | null
  /** What changed since it was last asked. */
  changed: string | null
  links?: { label: string; url: string }[]
  /** When it was filed, as an ISO date. */
  at: string
  answer?: string
  answeredAt?: string
}

/** What is waiting, in the user's terms. `question` is hobkin's own, or one the screen has no other name for. */
export type ItemKind = 'routine' | 'work' | 'yours' | 'approval' | 'merge' | 'pickup' | 'question'

// `action` is a to-do a routine found, `routines` is hobkin asking about a routine itself, and `deploy` is its
// "Deploy now?" for what merged on a project since its last deploy.
const KINDS = new Map<string, ItemKind>([
  ['routine', 'routine'],
  ['action', 'routine'],
  ['routines', 'routine'],
  ['work', 'work'],
  ['yours', 'yours'],
  ['merge', 'merge'],
  ['pickup', 'pickup'],
  ['deploy', 'approval'],
])

export function kindOf(item: ActionItem): ItemKind {
  return KINDS.get(item.answerTo?.kind ?? '') ?? 'question'
}

const named = (value: unknown) => typeof value === 'string' && value.length > 0

/** A finished branch waiting for a merge decision. It can be opened in Change Review. */
export function isFinishedBranch(item: ActionItem): boolean {
  const to = item.answerTo
  return to?.kind === 'merge' && named(to.slug) && named(to.item) && named(to.head)
}

/** A question longer than this is too long for the sheet's heading, so its short form heads it instead. */
const LONGEST_HEADING = 140

const repeats = (heading: string, text: string) => heading.toLowerCase().includes(text.trim().toLowerCase())

/**
 * How a question is asked on the sheet: a heading of one line and a sensible length, and the rest as its summary.
 * A question of several lines, or one long line, is headed by its short form, and its words become the summary.
 * A short form that only repeats the heading is left out.
 */
export function headingOf(question: string, tldr = ''): { question: string; summary: string } {
  const lines = question
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const whole = lines.join(' ')
  const long = lines.length > 1 || whole.length > LONGEST_HEADING
  const short = tldr.trim()
  const heading = long ? short || lines[0] || '' : whole || short
  return { question: heading, summary: long ? whole : short && !repeats(heading, short) ? short : '' }
}

/** The choice hobkin recommends, when it is one of the item's own. */
const pickOf = (item: ActionItem) => item.choices.find((choice) => choice.value === item.recommended) ?? null

/**
 * An item, asked the way a question is: who asks, the question, a line of summary, and the choices.
 * A question of several lines, or one long line, is headed by its short form, and its words become the summary.
 */
export function toQuestion(item: ActionItem): Question {
  const { question: heading, summary: said } = headingOf(item.question, item.tldr)
  const pick = pickOf(item)
  const why = item.why?.trim() || null
  const changed = item.changed?.trim()

  const summary = [
    said,
    // The sheet shows a reason under hobkin's pick. With no pick, it goes with the summary.
    pick ? '' : (why ?? ''),
    changed ? `Changed: ${changed}` : '',
  ].filter(Boolean)

  return {
    id: item.id,
    from: item.from.trim() || 'hobkin',
    question: heading,
    ...(summary.length ? { tldr: summary.join(' ') } : {}),
    choices: item.choices,
    ...(pick ? { recommended: pick.value } : {}),
    ...(pick && why ? { why } : {}),
  }
}

/** One row of the list. A question put off from the sheet has a row too, though hobkin has not filed it yet. */
export interface WaitingRow {
  id: string
  kind: ItemKind
  from: string
  /** One line: what is waiting. */
  summary: string
  /** When it was filed. Null for a question put off from the sheet, whose time the screen does not know. */
  at: string | null
  /** What opening the row asks. */
  question: Question
  /** It was on the sheet and the user put it off, or it waited there too long. */
  putOff: boolean
  /** A finished branch, which can be opened in Change Review. */
  branch: boolean
  /** hobkin's pick, in the choice's own words. */
  pick: string | null
  changed: string | null
  links: { label: string; url: string }[]
  /** The item as hobkin filed it. Null for a question from the sheet. */
  item: ActionItem | null
  /**
   * How hobkin takes the answer: its decision action, its learning action for a learning proposal, its work action for
   * a cleared step, or its work-mode answer for a project proposal (take or skip). Absent on sample rows.
   */
  answers?: { by: 'decision' | 'learning'; id: string } | { by: 'work'; id: string; slug: string; item: string } | { by: 'proposal'; slug: string }
  /** Something hobkin keeps elsewhere, which opens where it is handled instead of being answered here. */
  opens?: { screen: 'reports'; report: string } | { screen: 'work' }
}

function itemRow(item: ActionItem, putOff: boolean): WaitingRow {
  return {
    id: item.id,
    kind: kindOf(item),
    from: item.from.trim() || 'hobkin',
    summary: item.tldr.trim() || item.question.trim().split('\n')[0]!,
    at: item.at,
    question: toQuestion(item),
    putOff,
    branch: isFinishedBranch(item),
    pick: pickOf(item)?.label ?? null,
    changed: item.changed?.trim() || null,
    links: item.links ?? [],
    item,
  }
}

function questionRow(question: Question): WaitingRow {
  const pick = question.choices.find((choice) => choice.value === question.recommended)
  return {
    id: question.id,
    kind: 'question',
    from: question.from,
    summary: question.question,
    at: null,
    question,
    putOff: true,
    branch: false,
    pick: pick?.label ?? null,
    changed: null,
    links: [],
    item: null,
  }
}

/**
 * What waits on the user: hobkin's open items, the one that has waited longest first, then the questions put
 * off from the sheet, in the order they were put off. An answer given on the sheet takes its row away at once.
 */
export function waiting(items: readonly ActionItem[], queue: QuestionQueue): WaitingRow[] {
  const answered = new Set(queue.answered.map(({ id }) => id))
  const putOff = new Set(queue.deferred.map(({ id }) => id))
  const filed = new Set(items.map(({ id }) => id))

  const rows = items
    .filter((item) => item.answer === undefined && !answered.has(item.id))
    .toSorted((first, second) => first.at.localeCompare(second.at))
    .map((item) => itemRow(item, putOff.has(item.id)))

  const listed = new Set<string>()
  for (const question of queue.deferred) {
    // Put off twice, a question is still one row.
    if (filed.has(question.id) || answered.has(question.id) || listed.has(question.id)) continue
    listed.add(question.id)
    rows.push(questionRow(question))
  }
  return rows
}

export interface Tally {
  /** The number of rows. The menu's count is this number. */
  total: number
  kinds: Partial<Record<ItemKind, number>>
  /** When the item that has waited longest was filed. */
  oldest: string | null
}

export function tally(rows: readonly WaitingRow[]): Tally {
  const kinds: Partial<Record<ItemKind, number>> = {}
  let oldest: string | null = null
  for (const row of rows) {
    kinds[row.kind] = (kinds[row.kind] ?? 0) + 1
    if (row.at !== null && (oldest === null || row.at < oldest)) oldest = row.at
  }
  return { total: rows.length, kinds, oldest }
}

/**
 * How an open item is answered, as hobkin takes it: a decision by one of its choices or in the user's own words
 * (never both), a learning proposal by its three choices only, and what is handled elsewhere not here at all.
 * A sample, which has no way to hobkin, is answered only while the screen shows samples.
 */
export function answersOf(row: WaitingRow, sample: boolean): { choices: Choice[]; words: boolean } {
  if (row.opens || (!row.answers && !sample)) return { choices: [], words: false }
  const choices = row.question.choices
  return { choices, words: row.answers ? row.answers.by === 'decision' : choices.length > 0 }
}

/**
 * Whether a waiting row is an action item at all: something the user decides here, among more than one option. Work is
 * work, not an action item. A row that only opens where it is handled — a finished branch in Work, a report in Reports —
 * is not a decision, and neither is a lone "Mark it done". hobkin's own filed decisions always qualify: they take one of
 * their choices or the user's own words. Everything else must offer at least two choices (a learning proposal, a
 * take-or-skip, a sample). The list and the count rest on this, so only true decisions ever wait on the user.
 */
export function isActionItem(row: WaitingRow): boolean {
  if (row.opens) return false
  if (row.answers?.by === 'decision') return true
  return row.question.choices.length >= 2
}

/** The host command an answer becomes, as hobkin takes it, or why it is refused. The choice's own value is its answer. */
export type AnswerCommand =
  | { name: 'work.change'; args: { slug: string; item: string; action: 'done' } }
  | { name: 'work.proposal'; args: { slug: string; answer: 'take' | 'skip' } }
  | { name: 'learning.answer'; args: { id: string; value: 'yes' | 'later' | 'no' } }
  | { name: 'decision.answer'; args: { id: string; value: string } | { id: string; typed: string } }
  | { refused: string }

/**
 * How an open item's answer goes to hobkin. Only a decision takes the user's own words; a learning proposal, a project
 * proposal and a cleared step take one of their choices, so typed words there are refused with a word about why. Pure,
 * so the mapping is tested without a window; the screen runs the command it returns.
 */
export function answerCommand(answers: NonNullable<WaitingRow['answers']>, given: Answer): AnswerCommand {
  // The user's own words are a decision's alone; every other kind takes one of its choices.
  if ('typed' in given) {
    if (answers.by === 'decision') return { name: 'decision.answer', args: { id: answers.id, typed: given.typed } }
    return {
      refused:
        answers.by === 'learning'
          ? 'A learning proposal takes one of its three choices.'
          : answers.by === 'proposal'
            ? 'A project proposal is taken or skipped.'
            : 'Mark it done, or reply about it in chat.',
    }
  }
  switch (answers.by) {
    case 'work':
      return { name: 'work.change', args: { slug: answers.slug, item: answers.item, action: 'done' } }
    case 'proposal':
      return { name: 'work.proposal', args: { slug: answers.slug, answer: given.value as 'take' | 'skip' } }
    case 'learning':
      return { name: 'learning.answer', args: { id: answers.id, value: given.value as 'yes' | 'later' | 'no' } }
    case 'decision':
      return { name: 'decision.answer', args: { id: answers.id, value: given.value } }
  }
}

/**
 * Left and Right inside a row: -1 is the row itself, and its own controls (Review, links) count from 0.
 * The walk stops at both ends.
 */
export function stepInRow(at: number, delta: 1 | -1, count: number): number {
  return Math.max(-1, Math.min(count - 1, at + delta))
}
