import { readMemoryNote, type MemoryNote } from '#shared/protocol/memory.ts'
import { shellFields, type ChatMessage, type NoticeTone, type ShellFields } from '#shared/protocol/snapshot.ts'
import { replyText, storedBesideLive, type LiveReply, type LiveTurn } from '../../lib/host/live.ts'
import { splitRoutineReference } from '../reports/reply.ts'
import { runName, withRuns, type PlacedRun, type RunsRow } from '../schedules/runs.ts'
import { readDigest, type Digest } from './digest.ts'
import type { OutboxEntry } from './outbox.ts'

/** Something said in the conversation: by the user, by hobkin, or by an extension (`note`). */
export interface MessageEntry {
  kind: 'message'
  key: string
  role: 'user' | 'assistant' | 'note'
  text: string
  /** Milliseconds since the epoch, or null when it is not known. */
  at: number | null
  /** Title of the report the message is about. */
  about?: string
  images?: number
  /** `writing`: the reply is still arriving. `queued`: sent, and hobkin has not taken it yet. */
  state?: 'writing' | 'queued'
}

/** A line hobkin posts by itself. `system` is about something the user did, such as stopping a turn. */
export interface NoticeEntry {
  kind: 'notice'
  key: string
  text: string
  tone: NoticeTone | 'system'
  /** How many identical notices in a row this line stands for. */
  count: number
  at: number | null
  /** A review this notice is about, such as one that is ready: the chat offers to open it. */
  review?: string
  /** A memory an agent changed (`057-shared-memory`): the chat offers Undo and See. An older host sends none. */
  memory?: MemoryNote
  /** A digest from hobkin's desk (075-chief-of-staff S4): one row that opens to the lines it held. An older hobkin sends none. */
  digest?: Digest
}

export interface ShellEntry extends ShellFields {
  kind: 'shell'
  key: string
  text: string
  at: number | null
  outcome: 'cancelled' | 'success' | 'failed' | 'unknown'
}

/** A run of the main chat's own schedules, or several in a row that ended the same way (`056-agent-schedules`). `text` is its schedule's name. */
export interface ScheduleEntry extends RunsRow {
  text: string
}

export type Entry = MessageEntry | NoticeEntry | ShellEntry | ScheduleEntry

export interface DayGroup {
  key: string
  label: string
  entries: Entry[]
}

export interface ConversationInput {
  messages: readonly ChatMessage[]
  /** What the app said for the user only, such as the help. Each sits where it was said. */
  local?: readonly ChatMessage[]
  live?: LiveTurn | null
  outbox?: readonly OutboxEntry[]
  /** The runs of the main chat's own schedules, in the order they ended. Each stands where it ended. */
  runs?: readonly PlacedRun[]
  /** The current time, in milliseconds. */
  now: number
  /** The user's time zone. Defaults to the system's. */
  timeZone?: string
}

export const timeOf = (at: ChatMessage['at']): number | null => {
  const time = typeof at === 'number' ? at : Date.parse(at ?? '')
  return Number.isFinite(time) ? time : null
}

const DAY_MS = 86400000

function dayLabels(today: string, timeZone?: string) {
  // Noon of today's date, a day back, is always yesterday's date, whatever the clocks did in between.
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10)
  const options: Intl.DateTimeFormatOptions = { timeZone, weekday: 'short', month: 'short', day: 'numeric' }
  let thisYear: Intl.DateTimeFormat | undefined
  let otherYear: Intl.DateTimeFormat | undefined

  return (at: number, day: string): string => {
    if (day === today) return 'Today'
    if (day === yesterday) return 'Yesterday'
    const format = day.slice(0, 4) === today.slice(0, 4)
      ? (thisYear ??= new Intl.DateTimeFormat('en', options))
      : (otherYear ??= new Intl.DateTimeFormat('en', { ...options, year: 'numeric' }))
    return format.format(at)
  }
}

/** A user message's words and what it is about; a routine reply's first line becomes the "About" context. */
function asked(content: string, about?: string): { text: string; about?: string } {
  const split = splitRoutineReference(content)
  const title = about ?? split.about
  return { text: split.text, ...(title ? { about: title } : {}) }
}

/**
 * Each entry is made once from what it shows: a stored message, a reply written live, a message sent, a notice folded
 * onto the one before it. The next build gives a row whose message did not change the same entry, so it does not draw again.
 */
const storedEntries = new WeakMap<ChatMessage, Entry>()
const liveEntries = new WeakMap<LiveReply, MessageEntry | null>()
const sentEntries = new WeakMap<OutboxEntry, MessageEntry>()
const foldedEntries = new WeakMap<Entry, { onto: NoticeEntry; folded: NoticeEntry }>()

function entryOf(message: ChatMessage): Entry {
  let entry = storedEntries.get(message)
  if (!entry) storedEntries.set(message, (entry = newEntry(message)))
  return entry
}

/** A reply being written, or written and not stored yet. Null before its first word: nothing is drawn for it yet. */
function liveEntryOf(reply: LiveReply): MessageEntry | null {
  let entry = liveEntries.get(reply)
  if (entry === undefined) {
    const text = replyText(reply)
    entry = text.trim()
      ? {
          kind: 'message',
          key: `live:${reply.serial}`,
          role: 'assistant',
          text,
          at: null,
          ...(reply.done ? {} : { state: 'writing' as const }),
        }
      : null
    liveEntries.set(reply, entry)
  }
  return entry
}

function sentEntryOf(sent: OutboxEntry): MessageEntry {
  let entry = sentEntries.get(sent)
  if (!entry) {
    entry = {
      kind: 'message',
      key: `outbox:${sent.id}`,
      role: 'user',
      ...asked(sent.text, sent.about),
      at: sent.at,
      ...(sent.images ? { images: sent.images } : {}),
      ...(sent.accepted ? {} : { state: 'queued' as const }),
    }
    sentEntries.set(sent, entry)
  }
  return entry
}

/** A notice that repeats the one before it, folded onto it: it keeps the first one's place and takes the latest time. */
function foldedOnto(previous: NoticeEntry, next: Entry): NoticeEntry {
  const kept = foldedEntries.get(next)
  if (kept?.onto === previous) return kept.folded
  const folded = { ...previous, count: previous.count + 1, at: next.at ?? previous.at }
  foldedEntries.set(next, { onto: previous, folded })
  return folded
}

function newEntry(message: ChatMessage): Entry {
  const at = timeOf(message.at)
  const shell = shellFields(message)
  if (shell) return { kind: 'shell', key: message.id, ...shell, text: shell.output, at, outcome: shell.cancelled ? 'cancelled' : shell.exitCode === null ? 'unknown' : shell.exitCode === 0 ? 'success' : 'failed' }
  if (message.role === 'notice' || message.role === 'system') {
    // hobkin's notice that a review is ready names it; the shared message type does not declare the field.
    const review = (message as { review?: unknown }).review
    const memory = readMemoryNote(message.memory)
    const digest = readDigest(message)
    return {
      kind: 'notice',
      key: message.id,
      text: message.content,
      tone: message.role === 'system' ? 'system' : (message.tone ?? 'quiet'),
      count: 1,
      at,
      ...(typeof review === 'string' && review ? { review } : {}),
      ...(memory ? { memory } : {}),
      ...(digest ? { digest } : {}),
    }
  }
  return {
    kind: 'message',
    key: message.id,
    role: message.role === 'user' || message.role === 'assistant' ? message.role : 'note',
    ...(message.role === 'user' ? asked(message.content, message.about) : { text: message.content, ...(message.about ? { about: message.about } : {}) }),
    at,
    ...(message.images ? { images: message.images } : {}),
  }
}

/**
 * Whether a notice only repeats the one before it. Lines about what the user did, about a memory's change, which each
 * have their own Undo, and digests, whose lines each act on their own, are never folded.
 */
const repeats = (previous: Entry | undefined, next: Entry): previous is NoticeEntry =>
  previous?.kind === 'notice' &&
  next.kind === 'notice' &&
  next.tone !== 'system' &&
  !previous.memory &&
  !next.memory &&
  !previous.digest &&
  !next.digest &&
  previous.tone === next.tone &&
  previous.text === next.text

/** Each local message goes before the first stored one that is newer than it, as in the terminal app. */
function withLocal(stored: readonly ChatMessage[], local: readonly ChatMessage[]): readonly ChatMessage[] {
  let list = stored
  for (const note of local) {
    const at = timeOf(note.at) ?? Infinity
    const firstNewer = list.findIndex((other) => (timeOf(other.at) ?? -Infinity) > at)
    list = firstNewer < 0 ? [...list, note] : list.toSpliced(firstNewer, 0, note)
  }
  return list
}

/**
 * The conversation as it is drawn: stored messages by day, oldest first, identical notices in a row folded
 * into one, with each run of the main chat's schedules where it ended, then the replies still being written, then what
 * the user sent that hobkin has not stored yet.
 */
export function buildConversation({ messages, local = [], live = null, outbox = [], runs = [], now, timeZone }: ConversationInput): DayGroup[] {
  const days: DayGroup[] = []
  // Reuse the formatter while grouping; the next build picks up any system timezone change.
  let dates: Intl.DateTimeFormat | undefined
  let labelDay: ReturnType<typeof dayLabels> | undefined
  const dayKey = (at: number) => (dates ??= new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })).format(at)
  const place = (entry: Entry, at: number | null) => {
    const key = at === null ? null : dayKey(at)
    let day = days.at(-1)
    // A message with no time stays with the day before it.
    if (!day || (key !== null && key !== day.key)) {
      const label = at === null || key === null ? 'Earlier' : (labelDay ??= dayLabels(dayKey(now), timeZone))(at, key)
      day = { key: key ?? 'undated', label, entries: [] }
      days.push(day)
    }
    const previous = day.entries.at(-1)
    // It keeps its place and takes the latest time, so it does not jump when another one arrives.
    if (repeats(previous, entry)) day.entries[day.entries.length - 1] = foldedOnto(previous, entry)
    else day.entries.push(entry)
  }

  const stored = withLocal(storedBesideLive(messages, live), local).map(entryOf)
  for (const row of withRuns(stored, runs, (each) => each.at)) {
    const entry = row.kind === 'schedule' ? { ...row, text: runName(row.schedule) } : row
    place(entry, entry.at)
  }
  for (const reply of live?.replies ?? []) {
    const entry = liveEntryOf(reply)
    // Nothing is drawn before the first word: the line above the input already says hobkin is at work.
    if (entry) place(entry, now)
  }
  // What waits for a running turn shows above the input until the model reads it (`QueuedRows`).
  for (const sent of outbox) if (!sent.queue) place(sentEntryOf(sent), sent.at)
  return days
}
