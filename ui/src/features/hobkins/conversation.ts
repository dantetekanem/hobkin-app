import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { HobkinConversation, HobkinSender, HobkinSummary, HobkinTurn } from '#shared/protocol/hobkins.ts'
import { exchangeOf, pauseOf, type Step } from '../agent-activity/steps.ts'
import { timeOf } from '../reports/time.ts'

/**
 * The rules of a durable hobkin's page (`034-durable-hobkins`): when it reads the conversation again, the order its turns
 * and rows show in, when the talk box goes, and when the window tells the host the user has seen a wait. Pure, so they
 * are tested without a window. The page reads with `use-conversation.ts`.
 */

/** Something the user sent from the page. `started`: it began the turn `run`; otherwise it reached that turn as it worked. */
export interface SentNote {
  text: string
  /** When the user pressed Enter, in this window's clock. Its row is keyed by it from then on. */
  at: number
  run: string
  started: boolean
}

/** A message on its way to the host: what the user typed, and when they pressed Enter. */
export interface SendingNote {
  text: string
  at: number
}

export interface ShownTurn extends HobkinTurn {
  /** The turn in flight, drawn with its live steps. */
  live: boolean
  /** A live turn whose run is over before a read has its end: it keeps its last steps, and thinks no more, until one has. */
  ending: boolean
  /** The key of the row with the message that began it. One this window sent keeps the key it had on its way. */
  askedKey: string
  /** When it was asked: hobkin's time once a read has the turn, and until then when the user pressed Enter. */
  askedWhen: number | null
  /** What the user added to it while it worked, as this window sent it. hobkin keeps no copy apart from the turn. */
  notes: readonly SentNote[]
}

/**
 * Who began a turn, when it was not the user: the main hobkin, or another durable hobkin by its name (`hobkin tell`).
 * Null for the user, which a turn read from before messages between hobkins means too.
 */
export function senderName(from: HobkinSender | undefined): string | null {
  if (!from || from.kind === 'user') return null
  return from.kind === 'main' ? 'the main hobkin' : from.title
}

/** The key of a message's row: when the user pressed Enter. The same on its way, once sent, and once read. */
const saidKey = (at: number) => `said:${at}`

/** Changes whenever the conversation itself may have changed: a turn begun or ended, or what it said last. Null with no hobkin. */
export function reloadKey(hobkin: HobkinSummary | undefined): string | null {
  return hobkin ? JSON.stringify([hobkin.id, hobkin.turns, hobkin.state, hobkin.last?.at ?? null]) : null
}

/** Reads numbered as they begin. An answer is taken only when no later read has answered first. */
export function latestWins(): { begin: () => number; accept: (ticket: number) => boolean } {
  let issued = 0
  let shown = 0
  return {
    begin: () => ++issued,
    accept: (ticket) => {
      if (ticket <= shown) return false
      shown = ticket
      return true
    },
  }
}

/**
 * The turns oldest first, and the live one last. A turn the host has begun before the last read had it shows at once,
 * with the message that began it: the one in flight, and the one the user began just now, whose say answers before the
 * snapshot shows it working. With nothing in flight, the turn the last read caught in flight stays live until a read has
 * its end, so its steps never give way to an answer the page does not have yet. Nothing shows before the first read.
 */
export function pageTurns(conversation: HobkinConversation | null, hobkin: HobkinSummary | undefined, sent: readonly SentNote[]): ShownTurn[] {
  if (!conversation) return []
  const working = hobkin?.state === 'working' ? hobkin : undefined
  const inFlight = working?.run ?? null
  const read = [...conversation.turns].sort((left, right) => left.n - right.n)
  const known = new Set(read.map((turn) => turn.run))
  const openingOf = (run: string) => sent.find((note) => note.run === run && note.started)
  const notesOf = (run: string) => sent.filter((note) => note.run === run && !note.started)

  const begun = [...new Set([sent.findLast((note) => note.started)?.run, inFlight])].filter((run): run is string => typeof run === 'string' && !known.has(run))
  const top = read.at(-1)?.n ?? 0
  const unread = begun.map((run, index): HobkinTurn => ({
    n: working && run === inFlight ? working.turns : top + index + 1,
    run,
    asked: openingOf(run)?.text ?? '',
    askedAt: '',
    status: 'running',
    reply: null,
    error: null,
    endedAt: null,
  }))

  const reader = conversation.hobkin
  const caught = reader.state === 'working' ? read.find((turn) => turn.run === reader.run && turn.status === 'running')?.run : undefined
  const liveRun = inFlight ?? begun.at(-1) ?? caught ?? null
  const ending = liveRun !== null && liveRun !== inFlight && liveRun === caught
  const turns = [...read, ...unread].map((turn): ShownTurn => {
    const opening = openingOf(turn.run)
    const live = turn.run === liveRun
    return {
      ...turn,
      live,
      ending: live && ending,
      askedKey: opening ? saidKey(opening.at) : `${turn.run}:asked`,
      askedWhen: timeOf(turn.askedAt) ?? opening?.at ?? null,
      notes: notesOf(turn.run),
    }
  })
  const live = turns.find((turn) => turn.live)
  return live ? [...turns.filter((turn) => turn !== live), live] : turns
}

/** The live turn's activity as the page has it, with when this window first saw each entry. */
export interface LiveActivity {
  entries: readonly ActivityEntry[]
  cwd?: string
  seenAt: (id: string) => number | undefined
}

/**
 * One row of the conversation. A row keeps its `key` in every state it shows in, so nothing on screen is drawn twice
 * or drops out while the host catches up: a message the user sent is keyed by when they pressed Enter. `at` is when the
 * row happened, which the page writes beside it: a message when it was asked or sent, an answer when its turn ended. A
 * step's time is its own (`atOf`).
 */
export type PageRow =
  | { kind: 'said'; key: string; text: string; tag: 'added' | 'sending' | null; from: string | null; at: number | null }
  | { kind: 'step'; key: string; step: Step; ended: boolean }
  | { kind: 'answer'; key: string; turn: ShownTurn; at: number | null }
  | { kind: 'thinking'; key: 'working' }

/**
 * The conversation's rows, oldest first. The live turn's steps come with what the user added while it worked, each
 * where it was sent, as on an agent's page. The message on its way shows where it lands: in the turn in flight, or else
 * as the next turn. Thinking is last while the turn in flight is between steps.
 */
export function pageRows(turns: readonly ShownTurn[], { sending, activity }: { sending: SendingNote | null; activity: LiveActivity | null }): PageRow[] {
  const live = turns.find((turn) => turn.live)
  const into = live && !live.ending ? live : null
  // Once the say has answered, the message is a sent note, and the two never show together.
  const sent = (at: number) => turns.some((turn) => turn.askedKey === saidKey(at) || turn.notes.some((note) => note.at === at))
  const pending = sending && !sent(sending.at) ? sending : null
  // Whatever the page sends is the user's own.
  const said = ({ text, at }: SendingNote): PageRow => ({ kind: 'said', key: saidKey(at), text, tag: at === pending?.at ? 'sending' : 'added', from: null, at })

  const rows: PageRow[] = []
  for (const turn of turns) {
    if (turn.asked) rows.push({ kind: 'said', key: turn.askedKey, text: turn.asked, tag: null, from: senderName(turn.from), at: turn.askedWhen })
    const notes: readonly SendingNote[] = turn === into && pending ? [...turn.notes, pending] : turn.notes
    if (!turn.live) {
      rows.push(...notes.map(said), { kind: 'answer', key: `${turn.run}:answer`, turn, at: timeOf(turn.endedAt) })
      continue
    }
    if (!activity) {
      rows.push(...notes.map(said))
      continue
    }
    const options = { seenAt: activity.seenAt, ended: turn.ending, cwd: activity.cwd, tasksOnLine: true }
    for (const item of exchangeOf(activity.entries, notes.map((note) => ({ ...note, id: saidKey(note.at) })), options)) {
      rows.push(item.kind === 'note' ? said(item.note) : { kind: 'step', key: `${turn.run}:${item.key}`, step: item, ended: turn.ending })
    }
  }
  if (pending && !into) rows.push(said(pending))
  if (into && (!activity || pauseOf(activity.entries) === 'thinking')) rows.push({ kind: 'thinking', key: 'working' })
  return rows
}

export type PageState = 'live' | 'starting' | 'ended'

/**
 * Whether the hobkin is there. One the window just started may not be in the snapshot yet, and before the host has said
 * nothing is known. One that has been there and is gone was ended.
 */
export function pageState(hobkin: HobkinSummary | undefined, { known, started, ready }: { known: boolean; started: boolean; ready: boolean }): PageState {
  if (hobkin) return 'live'
  if (known) return 'ended'
  if (ready && !started) return 'ended'
  return 'starting'
}

/** The talk box is there until the hobkin is ended. */
export const talkOpen = (state: PageState): boolean => state !== 'ended'

/**
 * The hobkin has had no turn yet: it was started with no message, and the first one sent from its page starts its first
 * turn. One this window just started counts before the snapshot has it.
 */
export function firstMessageNext({ hobkin, started }: { hobkin: HobkinSummary | undefined; started: boolean }): boolean {
  return hobkin ? hobkin.turns === 0 : started
}

/** Where ending a durable hobkin stands: not asked, asking once, or ending now. */
export type Ending = 'no' | 'asking' | 'busy'

/** What a press of End, or of Control+X, does: the first asks, one while it asks ends it, and one while it ends does nothing. */
export function pressEnd(now: Ending): 'ask' | 'end' | null {
  if (now === 'no') return 'ask'
  return now === 'asking' ? 'end' : null
}

/**
 * The wait to tell the host the user has seen, or null. Only while the page is on screen, only for a wait the host does not
 * know was seen, and once for each wait (`told` is the last one told).
 */
export function seenToSend({ hobkin, onScreen, told }: { hobkin: HobkinSummary | undefined; onScreen: boolean; told: string | null }): string | null {
  if (!onScreen || hobkin?.state !== 'waiting') return null
  const { waiting } = hobkin
  if (!waiting || waiting.seen) return null

  const wait = `${hobkin.id}@${waiting.since}`
  return wait === told ? null : wait
}
