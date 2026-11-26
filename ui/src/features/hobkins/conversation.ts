import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { HobkinConversation, HobkinSender, HobkinSummary, HobkinTurn } from '#shared/protocol/hobkins.ts'
import type { WireSnapshot } from '#shared/protocol/snapshot.ts'
import { exchangeOf, pauseOf, type ExchangeItem, type Step } from '../agent-activity/steps.ts'
import type { Attachment } from '../chat/draft.ts'
import { timeOf } from '../reports/time.ts'
import { scheduleWakeOf, type ScheduleWake } from '../schedules/wake.ts'

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
  /** The images that went with it. The window keeps their previews; hobkin keeps no copy apart from the turn. */
  images?: readonly Attachment[]
  /** The id it was sent with, which hobkin's receipt names once the turn it reached read it in. */
  noteId?: string
  /** When that turn read it in, by hobkin's receipt. Kept once seen, so a receipt hobkin lets go never takes it back. */
  receivedAt?: number
  /** Sent into the turn in flight, it waits for that turn as this says, and shows above the box until the turn reads it. */
  queue?: 'steer' | 'follow-up'
}

/** A note that waits for the hobkin's turn in flight to read it: sent into that turn to wait, and not read yet. */
export const waitsForTurn = (note: SendingNote & Partial<SentNote>, hobkin: HobkinSummary | undefined): boolean =>
  note.queue !== undefined && note.receivedAt === undefined && hobkin?.state === 'working' && (note.run === undefined || note.run === hobkin.run)

/**
 * How far a message the user sent has got, as a chat app marks it: on its way to the host, with hobkin, taken in by
 * the turn, or left unread by a turn that ended.
 */
export type Delivery = 'sending' | 'waiting' | 'received' | 'unconfirmed'

/** A message on its way to the host: what the user typed, the images attached to it, and when they pressed Enter. */
export interface SendingNote {
  text: string
  at: number
  images?: readonly Attachment[]
  /** Sent while the hobkin works, how it will wait for the turn in flight. */
  queue?: 'steer' | 'follow-up'
}

export interface ShownTurn extends Omit<HobkinTurn, 'notes'> {
  /** The turn in flight, drawn with its live steps. */
  live: boolean
  /** A live turn whose run is over before a read has its end: it keeps its last steps, and thinks no more, until one has. */
  ending: boolean
  /** The key of the row with the message that began it. One this window sent keeps the key it had on its way. */
  askedKey: string
  /** When it was asked: hobkin's time once a read has the turn, and until then when the user pressed Enter. */
  askedWhen: number | null
  /** The images that went with the message that began it, when this window sent it. */
  askedImages: readonly Attachment[]
  /** What the user added to it while it worked: as this window sent it, or as hobkin kept it for a page that lost its copy (`withKept`). */
  notes: readonly SentNote[]
  /** hobkin has begun it: a read has it, or the snapshot shows it in flight. Its message is taken in from then on. */
  begun: boolean
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
      askedImages: opening?.images ?? [],
      notes: notesOf(turn.run),
      begun: known.has(turn.run) || turn.run === inFlight,
    }
  })
  const live = turns.find((turn) => turn.live)
  return live ? [...turns.filter((turn) => turn !== live), live] : turns
}

/** A turn's activity as the page has it, with when this window first saw each entry. */
export interface TurnActivity {
  entries: readonly ActivityEntry[]
  cwd?: string
  seenAt: (id: string) => number | undefined
}

const NO_STEPS: Readonly<Record<string, TurnActivity>> = {}

/**
 * One row of the conversation. A row keeps its `key` in every state it shows in, so nothing on screen is drawn twice
 * or drops out while the host catches up: a message the user sent is keyed by when they pressed Enter. `at` is when the
 * row happened, which the page writes beside it: a message when it was asked or sent, an answer when its turn ended. A
 * step's time is its own (`atOf`). `run` is the run of the turn a row belongs to; a message on its way has none yet. A
 * turn a schedule began opens with its wake (`wake.ts`) in its message's place.
 */
export type PageRow =
  | { kind: 'said'; key: string; text: string; delivery: Delivery | null; from: string | null; at: number | null; images?: readonly Attachment[]; run?: string }
  | { kind: 'wake'; key: string; wake: ScheduleWake; at: number | null; run: string }
  | { kind: 'step'; key: string; step: Step; ended: boolean; run: string }
  | { kind: 'answer'; key: string; turn: ShownTurn; at: number | null; run: string }
  | { kind: 'thinking'; key: 'working' }

/** A message the page shows from this window: on its way, or sent to a turn. */
type PageNote = SendingNote & Partial<SentNote>

/**
 * How far what the user added to a turn has got. The words hobkin answered for are with it until the turn's receipt says
 * it read them in. Words sent with an id that the turn ended without reading say so; with no id there is no receipt to
 * wait for, so they stay with hobkin.
 */
function addedDelivery(turn: ShownTurn, note: PageNote): Delivery {
  if (note.receivedAt !== undefined) return 'received'

  const ended = !turn.live && turn.status !== 'running'
  return note.noteId && ended ? 'unconfirmed' : 'waiting'
}

/** The steps of a turn that has its answer, less the words it ended on: the answer shows them. */
function beforeAnswer(items: readonly ExchangeItem[]): readonly ExchangeItem[] {
  let end = items.length
  while (end > 0 && items[end - 1]!.kind === 'says') end -= 1
  return end === items.length ? items : items.slice(0, end)
}

interface RowsFrom {
  /** The message on its way to the host now. */
  sending: SendingNote | null
  /** The live turn's steps. */
  activity: TurnActivity | null
  /** The steps the page has of turns that are over, by their runs (`turn-steps.ts`). */
  finished?: Readonly<Record<string, TurnActivity>>
}

/**
 * The conversation's rows, oldest first. Each turn's steps stand between its message and its answer, with what the user
 * added while it worked, each where it was sent, as on an agent's page: the live turn's, and those the page has of a turn
 * that is over. A turn that answered ended on the words its answer shows, so they are not drawn twice. The message on its
 * way shows where it lands: in the turn in flight, or else as the next turn. Thinking is last while the turn in flight is
 * between steps. Each of the user's messages is marked with how far it has got (`Delivery`); another hobkin's words have
 * no mark.
 */
export function pageRows(turns: readonly ShownTurn[], { sending, activity, finished = NO_STEPS }: RowsFrom): PageRow[] {
  const live = turns.find((turn) => turn.live)
  const into = live && !live.ending ? live : null
  // Once the say has answered, the message is a sent note, and the two never show together.
  const sent = (at: number) => turns.some((turn) => turn.askedKey === saidKey(at) || turn.notes.some((note) => note.at === at))
  const pending = sending && !sent(sending.at) ? sending : null
  // Whatever the page sends is the user's own.
  const said = (note: SendingNote, delivery: Delivery): Extract<PageRow, { kind: 'said' }> => ({
    kind: 'said',
    key: saidKey(note.at),
    text: note.text,
    delivery,
    from: null,
    at: note.at,
    ...(note.images?.length ? { images: note.images } : {}),
  })

  const rows: PageRow[] = []
  const saidIn = (turn: ShownTurn, note: PageNote): PageRow => {
    const delivery = note === pending ? 'sending' : addedDelivery(turn, note)
    return { ...said(note, delivery), run: turn.run }
  }
  // A turn's steps, with what the user added where it was sent.
  const exchange = (turn: ShownTurn, notes: readonly PageNote[], steps: TurnActivity, ended: boolean) => {
    const options = { seenAt: steps.seenAt, ended, cwd: steps.cwd, tasksOnLine: true }
    const items = exchangeOf(steps.entries, notes.map((note) => ({ ...note, id: saidKey(note.at) })), options)
    const answered = !turn.live && Boolean(turn.reply)
    for (const item of answered ? beforeAnswer(items) : items) {
      if (item.kind !== 'note') {
        rows.push({ kind: 'step', key: `${turn.run}:${item.key}`, step: item, ended, run: turn.run })
        continue
      }
      const note = notes.find((each) => each.at === item.note.at)
      if (note) rows.push(saidIn(turn, note))
    }
  }
  for (const turn of turns) {
    const images = turn.askedImages.length ? { images: turn.askedImages } : {}
    const from = senderName(turn.from)
    // The message that began a turn was taken in once the turn began.
    const askedDelivery = from ? null : turn.begun ? 'received' : 'waiting'
    // A schedule's wake is no one's words: it is one row named by its schedules, which opens to the whole message.
    const wake = scheduleWakeOf(turn.asked)
    if (wake) {
      rows.push({ kind: 'wake', key: turn.askedKey, wake, at: turn.askedWhen, run: turn.run })
    } else if (turn.asked || images.images) {
      rows.push({ kind: 'said', key: turn.askedKey, text: turn.asked, delivery: askedDelivery, from, at: turn.askedWhen, ...images, run: turn.run })
    }

    const notes: readonly PageNote[] = turn === into && pending ? [...turn.notes, pending] : turn.notes
    const steps = turn.live ? activity : (finished[turn.run] ?? null)
    const ended = !turn.live || turn.ending
    if (steps) exchange(turn, notes, steps, ended)
    else rows.push(...notes.map((note) => saidIn(turn, note)))
    if (!turn.live) rows.push({ kind: 'answer', key: `${turn.run}:answer`, turn, at: timeOf(turn.endedAt), run: turn.run })
  }
  if (pending && !into) rows.push(said(pending, 'sending'))
  if (into && (!activity || pauseOf(activity.entries) === 'thinking')) rows.push({ kind: 'thinking', key: 'working' })
  return rows
}

/**
 * The turns drawn in `rows`, after those in `held`, drawn before. The page watches their steps from then on: the turn in
 * flight's, so they are there the moment it ends, and a finished turn's, which it reads when the host holds too few, so a
 * turn whose steps push its rows out of sight is not let go. The same list when no turn is new.
 */
export function withDrawnTurns(held: readonly string[], rows: readonly object[]): readonly string[] {
  const known = new Set(held)
  const added: string[] = []
  for (const row of rows) {
    const run = 'run' in row && typeof row.run === 'string' ? row.run : null
    if (run === null || known.has(run)) continue
    known.add(run)
    added.push(run)
  }
  return added.length ? [...held, ...added] : held
}

/**
 * The notes the user sent, by hobkin, with each one hobkin's receipts now say its turn read in marked so. A receipt
 * counts only under the run of the turn the note reached. A hobkin's notes with nothing new stay the same list, and with
 * nothing new anywhere the same notes come back.
 */
export function withReceipts(
  sent: Readonly<Record<string, readonly SentNote[]>>,
  receipts: WireSnapshot['steeringReceipts'],
): Readonly<Record<string, readonly SentNote[]>> {
  const marked = (note: SentNote): SentNote => {
    if (note.noteId === undefined || note.receivedAt !== undefined) return note

    const receipt = receipts?.[note.run]?.find((each) => each.noteId === note.noteId)
    return receipt ? { ...note, receivedAt: receipt.at } : note
  }

  let changed = false
  const next: Record<string, readonly SentNote[]> = {}
  for (const [id, notes] of Object.entries(sent)) {
    const now = notes.map(marked)
    const same = now.every((note, index) => note === notes[index])
    next[id] = same ? notes : now
    if (!same) changed = true
  }
  return changed ? next : sent
}

/**
 * The notes the user sent, with what hobkin kept of those this window no longer has: sent from a page that a reload, a
 * hot update or another screen has taken away since. Each joins in the order it was sent, under its turn's run, as the
 * page would have it had it sent it now, without its images. A note this window still has stays as it is, so with nothing
 * new the same notes come back.
 */
export function withKept(sent: readonly SentNote[], turns: readonly HobkinTurn[]): readonly SentNote[] {
  const known = new Set(sent.map((note) => note.noteId))
  const kept = turns.flatMap(({ run, notes = [] }) =>
    notes
      .filter(({ noteId }) => !known.has(noteId))
      .map(({ noteId, text, at, queue, receivedAt }): SentNote => ({
        text,
        at,
        run,
        started: false,
        noteId,
        ...(receivedAt === undefined ? {} : { receivedAt }),
        // An interrupting note began over at once, so it waits for nothing.
        ...(queue === 'interrupt' ? {} : { queue }),
      })),
  )
  return kept.length ? [...sent, ...kept].sort((left, right) => left.at - right.at) : sent
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
