import type { SetupAnswer } from '#shared/protocol/setup.ts'
import { GOAL_WORDS, type Goal } from './goals.ts'

/**
 * The routine cards of the setup: what a card says, keeping, changing and dropping one, the message that asks main
 * hobkin to write the kept ones, when that writing is over, what hobkin says it wrote, and which routine it offers to
 * run first. Pure rules only. See _specs/044-goal-first-setup.
 */

/** What a routine made from a template gives the person. */
export const GIFTS = ['report', 'action', 'critical', 'follow-up'] as const
export type Gift = (typeof GIFTS)[number]

/** A routine template as a card, as hobkin's `goalCards` reads it. A template of the person's own may lack a part: null or empty. */
export interface Card {
  id: string
  version: number
  source: 'hobkin' | 'yours'
  title: string
  /** What it watches. */
  summary: string
  /** Where it looks. */
  needs: string[]
  recurrence: string
  /** What is worth telling. */
  tells: string | null
  /** What it leaves out unless the person says otherwise. */
  skips: string | null
  gives: Gift[]
  /** What closes an item. */
  closes: string | null
  /** It reads the person's own accounts. */
  private: boolean
  /** The template's own question, for what it needs to know. */
  asks: string | null
  effort: 'low' | 'medium' | 'high'
}

/** One picked goal's cards: the ones it starts with, and the rest that name it. */
export interface GoalCards {
  goal: Goal
  starters: Card[]
  more: Card[]
}

/** The most cards kept across every goal. Every run spends the subscription, and two or three are enough to start. */
export const KEPT_MAX = 5

/** How a routine names the template it came from: `job-openings@1`. */
export const templateKey = ({ id, version }: Pick<Card, 'id' | 'version'>): string => `${id}@${version}`

/** What the person changed on a card. Each is left out while it says what the template says. */
export interface CardChanges {
  recurrence?: string
  /** Empty leaves nothing out. */
  skips?: string
  /** The answer to the template's own question. */
  answer?: string
}

/** Each card the person kept or dropped, and their changes, by template id. A card left alone is in neither. */
export interface CardPicks {
  marks: Readonly<Record<string, 'kept' | 'dropped'>>
  changes: Readonly<Record<string, CardChanges>>
}

export const NO_PICKS: CardPicks = { marks: {}, changes: {} }

/** "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

const capital = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`

const FEW = ['no', 'one', 'two', 'three', 'four', 'five']
const few = (count: number) => FEW[count] ?? String(count)

const GIFT_WORDS: Record<Gift, string> = {
  report: 'a report',
  action: 'an Action Item when you need to act',
  critical: "an alert for what can't wait",
  'follow-up': 'a routine of its own to follow something up',
}

export type CardPart = 'watches' | 'looks' | 'often' | 'tells' | 'skips' | 'said' | 'gives' | 'private'

export interface CardRow {
  part: CardPart
  /** Its name on the card. The private line has none. */
  label: string
  text: string
}

/**
 * A card's rows, from the top: what it watches, where it looks, how often, when it tells, what it leaves out, the
 * answer to its own question once there is one, and what the person gets. On a work computer a private card ends on a
 * line that says so. The person's changes are what the rows say. A part the template lacks leaves its row out.
 */
export function cardRows(card: Card, changes: CardChanges, { work }: { work: boolean }): CardRow[] {
  const skips = changes.skips ?? card.skips
  const rows: (CardRow | null)[] = [
    card.summary ? { part: 'watches', label: 'Watches', text: card.summary } : null,
    card.needs.length ? { part: 'looks', label: 'Looks at', text: capital(listed(card.needs)) } : null,
    { part: 'often', label: 'How often', text: changes.recurrence ?? card.recurrence },
    card.tells ? { part: 'tells', label: 'Tells you when', text: card.tells } : null,
    skips === null ? null : { part: 'skips', label: 'Leaves out', text: skips || 'Nothing' },
    changes.answer ? { part: 'said', label: 'You said', text: changes.answer } : null,
    card.gives.length ? { part: 'gives', label: 'You get', text: `${capital(listed(card.gives.map((gift) => GIFT_WORDS[gift])))}.` } : null,
    work && card.private ? { part: 'private', label: '', text: 'It reads your own accounts, on a work computer.' } : null,
  ]
  return rows.filter((row) => row !== null)
}

export type ChangePart = 'often' | 'skips' | 'answer'

export interface ChangeField {
  part: ChangePart
  label: string
  /** Where the field starts: the person's last change, or else the template's words. */
  start: string
}

/** The fields Change opens in place: how often, what it leaves out, and the template's own question when it has one. */
export function changeFields(card: Card, changes: CardChanges): ChangeField[] {
  const fields: ChangeField[] = [
    { part: 'often', label: 'How often', start: changes.recurrence ?? card.recurrence },
    { part: 'skips', label: 'Leaves out', start: changes.skips ?? card.skips ?? '' },
  ]
  return card.asks ? [...fields, { part: 'answer', label: card.asks, start: changes.answer ?? '' }] : fields
}

/** The most one changed field may hold. */
export const CHANGE_MAX = 600

/** What is wrong with a changed field, in hobkin's words, or null when it can be kept. */
export const checkChange = (text: string): string | null => (text.trim().length > CHANGE_MAX ? `That is a lot. Keep it under ${CHANGE_MAX} characters.` : null)

const without = <T>(record: Readonly<Record<string, T>>, id: string): Record<string, T> => {
  const { [id]: _gone, ...rest } = record
  return rest
}

const keptCount = (picks: CardPicks) => Object.values(picks.marks).filter((mark) => mark === 'kept').length

/** Keep, pressed: a card is kept, or let go when it already was. A sixth is not kept, and `full` says why nothing happened. */
export function keepCard(picks: CardPicks, id: string): { picks: CardPicks; full: boolean } {
  if (picks.marks[id] === 'kept') return { picks: { ...picks, marks: without(picks.marks, id) }, full: false }
  if (keptCount(picks) >= KEPT_MAX) return { picks, full: true }
  return { picks: { ...picks, marks: { ...picks.marks, [id]: 'kept' } }, full: false }
}

/** Drop, pressed: a card is turned down, a kept one too. Undo on a dropped card leaves it alone again. */
export function dropCard(picks: CardPicks, id: string): CardPicks {
  if (picks.marks[id] === 'dropped') return { ...picks, marks: without(picks.marks, id) }
  return { ...picks, marks: { ...picks.marks, [id]: 'dropped' } }
}

/** Save in Change: what the fields hold, trimmed, kept where it differs from the template. The card stays kept, dropped or alone. */
export function changeCard(picks: CardPicks, card: Card, edits: Record<ChangePart, string>): CardPicks {
  const often = edits.often.trim()
  const skips = edits.skips.trim()
  const answer = edits.answer.trim()
  const changes: CardChanges = {
    ...(often && often !== card.recurrence ? { recurrence: often } : {}),
    ...(skips !== (card.skips ?? '') ? { skips } : {}),
    ...(card.asks && answer ? { answer } : {}),
  }
  return { ...picks, changes: Object.keys(changes).length ? { ...picks.changes, [card.id]: changes } : without(picks.changes, card.id) }
}

/** Every card on offer, in the order they are shown: each goal's starters, then its more. */
export const cardsInOrder = (groups: readonly GoalCards[]): Card[] => groups.flatMap(({ starters, more }) => [...starters, ...more])

/** The cards kept, in card order. */
export const keptCards = (cards: readonly Card[], picks: CardPicks): Card[] => cards.filter(({ id }) => picks.marks[id] === 'kept')

/** The cards turned down, in card order. */
export const droppedCards = (cards: readonly Card[], picks: CardPicks): Card[] => cards.filter(({ id }) => picks.marks[id] === 'dropped')

/** Beside Done: how many are kept, of the most. */
export const keptLine = (picks: CardPicks): string => `${keptCount(picks)} of ${KEPT_MAX} kept`

/** What a card says when a sixth Keep does nothing. */
export const FULL_LINE = `You kept ${few(KEPT_MAX)} already. Every run uses your subscription, so let one go first.`

/** What hobkin says as a goal's cards come up. The first goal's cards say how they work. */
export function cardsLines(goal: Goal, first: boolean): string[] {
  const { cards } = GOAL_WORDS[goal]
  if (!first) return [`And ${cards}, these.`]
  return [`${capital(cards)}, I'd start with these.`, "Keep the ones you want. You can change any of them first, and drop what doesn't fit."]
}

/** A kept card in the message: its template and version, its title, and each change on a line of its own under it. */
function cardSaid(card: Card, changes: CardChanges | undefined): string[] {
  const named = `- ${templateKey(card)}, "${card.title}"`
  if (!changes) return [`${named}, as the template has it.`]
  const said = [
    changes.recurrence !== undefined && `How often: ${changes.recurrence}`,
    changes.skips !== undefined && `Leaves out: ${changes.skips || 'nothing'}`,
    changes.answer !== undefined && `To "${card.asks}" I said: ${changes.answer}`,
  ].filter((line) => line !== false)
  return [`${named}, with my changes:`, ...said.map((line) => `  ${line}`)]
}

// Work mode has no setting for validation: a project's checks live in its directions, which hobkin writes on a yes.
const CHECKS = "For each project I picked, propose the commands that check its work, such as its tests, lint and build. Write them into that project's directions (work/<slug>/directions.md) only after I say yes."

export interface WriteRequestInput {
  goals: readonly Goal[]
  /** Each goal question answered, with the words it was asked with. */
  answers: readonly SetupAnswer[]
  cards: readonly GoalCards[]
  picks: CardPicks
  /** Code was picked with projects, and validation was said yes to. */
  checks: boolean
}

/**
 * The one message that asks main hobkin to write the kept routines, in the chat: the goals and their answers, each kept
 * card by template and version with the person's changes, the cards turned down, and what to do. Null with no card
 * kept, so nothing is sent.
 */
export function writeRequest({ goals, answers, cards, picks, checks }: WriteRequestInput): string | null {
  const all = cardsInOrder(cards)
  const kept = keptCards(all, picks)
  if (!kept.length) return null
  const dropped = droppedCards(all, picks)
  const working = goals.length ? `I'm working toward ${listed(goals.map((goal) => GOAL_WORDS[goal].said))}.` : 'I named no goal.'
  const told = answers.filter(({ answer }) => answer.trim()).map(({ ask, answer }) => `- ${ask}\n  ${answer.trim()}`)

  return [
    `I just went through the setup in the app. ${working}`,
    ...(told.length ? ['Here is what I answered there:', ...told] : []),
    'These are the cards I kept, each by its template and version. Write one routine for each, from its template:',
    ...kept.flatMap((card) => cardSaid(card, picks.changes[card.id])),
    ...(dropped.length ? [`I turned down these cards, so do not offer them again unless I ask: ${dropped.map((card) => `${templateKey(card)} ("${card.title}")`).join(', ')}.`] : []),
    ...(checks ? [CHECKS] : []),
    'Run `hobkin setup`, and follow the "From the app\'s setup" section of the guide it names.',
    'Turn each routine on, since I said yes on its card. Ask me before you connect anything. Run none of them.',
  ].join('\n')
}

/** A routine as the window knows it: its id, its title, the template it names, and whether it is on. */
export interface NamedRoutine {
  id: string
  title: string
  template?: string
  enabled: boolean
}

export interface Written {
  card: Card
  routine: NamedRoutine
}

/**
 * The kept cards that have a routine naming their template, in card order. A routine that already named it before the
 * message went, by the same id, was not written now.
 */
export function routinesWritten(kept: readonly Card[], routines: readonly NamedRoutine[], before: readonly NamedRoutine[]): Written[] {
  const there = new Set(before.map(({ id, template }) => `${id} ${template ?? ''}`))
  return kept.flatMap((card) => {
    const routine = routines.find(({ id, template }) => template === templateKey(card) && !there.has(`${id} ${template}`))
    return routine ? [{ card, routine }] : []
  })
}

/** How long main hobkin gets to start on the message, and how long it may go without asking, in milliseconds. */
export const WRITING_WAIT = { startMs: 5_000, quietMs: 120_000 }

/** Where the writing stands, as plain values. Times are in milliseconds. */
export interface Writing {
  /** When the host took the message. Null while it is on its way, or when it failed. */
  takenAt: number | null
  failed: boolean
  /** Main hobkin is working. */
  busy: boolean
  /** Main hobkin has a question open. */
  open: boolean
  /** The person said That's enough. */
  enough: boolean
  /** When the message was sent, or a question last came or went, whichever is later. */
  stirredAt: number
  kept: number
  /** How many kept cards have their routine. */
  written: number
}

/**
 * Whether the writing is over, so the story goes on: every kept card has its routine, the person said enough, the
 * message did not go, nothing was asked for two minutes, or hobkin stopped working with nothing open.
 */
export function writingOver(state: Writing, now: number): boolean {
  if (state.enough || state.failed || (state.kept > 0 && state.written >= state.kept)) return true
  // An open question waits for the person, however long they take.
  if (state.open) return false
  if (now - state.stirredAt >= WRITING_WAIT.quietMs) return true
  if (state.takenAt === null) return false
  // Right after the message is taken hobkin may not be working yet, so idle only counts after a few seconds.
  return !state.busy && now - state.takenAt >= WRITING_WAIT.startMs
}

/** What hobkin says it wrote, in one bubble: all, some, or none of the kept cards. */
export function routinesSaid(kept: number, written: number): string {
  if (written <= 0) return `I couldn't write ${kept === 1 ? 'it' : 'them'} just now. We'll pick this up in our chat.`
  if (written >= kept) {
    if (kept === 1) return "Done. I wrote it, and it's in Routines."
    return `Done. I wrote ${kept === 2 ? 'both' : `all ${few(kept)}`}, and they're in Routines.`
  }
  const left = kept - written
  const rest = left === 1 ? (kept === 2 ? 'the other one' : 'the last one') : `the other ${few(left)}`
  return `I wrote ${few(written)} of the ${few(kept)}. We'll finish ${rest} in our chat.`
}

const EFFORT_ORDER: readonly Card['effort'][] = ['low', 'medium', 'high']

/**
 * The routine hobkin offers to run first: of the written ones that are on, the lowest effort, then the first in card
 * order. Only on a real model, so never on the scripted host or on sample data.
 */
export function firstRunOf(written: readonly Written[], smart: boolean): NamedRoutine | null {
  if (!smart) return null
  const on = written.filter(({ routine }) => routine.enabled)
  const lowest = on.reduce<Written | null>((best, next) => (best && EFFORT_ORDER.indexOf(best.card.effort) <= EFFORT_ORDER.indexOf(next.card.effort) ? best : next), null)
  return lowest?.routine ?? null
}

/** What hobkin says to offer the first run. */
export const firstRunLines = (routine: Pick<NamedRoutine, 'title'>): string[] => [
  `Want to see one work? I can run ${routine.title} now.`,
  'It uses your subscription, the same as any of its runs.',
]
