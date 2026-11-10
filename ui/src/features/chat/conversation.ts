import type { ChatMessage, NoticeTone } from '#shared/protocol/snapshot.ts'
import { replyText, storedBesideLive, type LiveTurn } from '../../lib/host/live.ts'
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
}

export type Entry = MessageEntry | NoticeEntry

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

function dayLabel(at: number, day: string, today: string, timeZone?: string): string {
  if (day === today) return 'Today'
  // Noon of today's date, a day back, is always yesterday's date, whatever the clocks did in between.
  if (day === new Date(Date.parse(`${today}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10)) return 'Yesterday'

  const year = day.slice(0, 4) === today.slice(0, 4) ? {} : ({ year: 'numeric' } as const)
  return new Intl.DateTimeFormat('en', { timeZone, weekday: 'short', month: 'short', day: 'numeric', ...year }).format(at)
}

function entryOf(message: ChatMessage): Entry {
  const at = timeOf(message.at)
  if (message.role === 'notice' || message.role === 'system') {
    return { kind: 'notice', key: message.id, text: message.content, tone: message.role === 'system' ? 'system' : (message.tone ?? 'quiet'), count: 1, at }
  }
  return {
    kind: 'message',
    key: message.id,
    role: message.role === 'user' || message.role === 'assistant' ? message.role : 'note',
    text: message.content,
    at,
    ...(message.about ? { about: message.about } : {}),
    ...(message.images ? { images: message.images } : {}),
  }
}

/** Whether a notice only repeats the one before it. Lines about what the user did are never folded. */
const repeats = (previous: Entry | undefined, next: Entry): previous is NoticeEntry =>
  previous?.kind === 'notice' && next.kind === 'notice' && next.tone !== 'system' && previous.tone === next.tone && previous.text === next.text

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
 * into one, then the replies still being written, then what the user sent that hobkin has not stored yet.
 */
export function buildConversation({ messages, local = [], live = null, outbox = [], now, timeZone }: ConversationInput): DayGroup[] {
  const days: DayGroup[] = []
  // Reuse the formatter while grouping; the next build picks up any system timezone change.
  let dates: Intl.DateTimeFormat | undefined
  let today: string | undefined
  const dayKey = (at: number) => (dates ??= new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })).format(at)
  const place = (entry: Entry, at: number | null) => {
    const key = at === null ? null : dayKey(at)
    let day = days.at(-1)
    // A message with no time stays with the day before it.
    if (!day || (key !== null && key !== day.key)) {
      day = { key: key ?? 'undated', label: at === null || key === null ? 'Earlier' : dayLabel(at, key, today ??= dayKey(now), timeZone), entries: [] }
      days.push(day)
    }
    const previous = day.entries.at(-1)
    if (repeats(previous, entry)) {
      // It keeps its place and takes the latest time, so it does not jump when another one arrives.
      day.entries[day.entries.length - 1] = { ...previous, count: previous.count + 1, at: entry.at ?? previous.at }
    } else day.entries.push(entry)
  }

  for (const message of withLocal(storedBesideLive(messages, live), local)) {
    const entry = entryOf(message)
    place(entry, entry.at)
  }
  for (const reply of live?.replies ?? []) {
    const text = replyText(reply)
    // Nothing is drawn before the first word: the line above the input already says hobkin is at work.
    if (!text.trim()) continue
    place({ kind: 'message', key: `live:${reply.serial}`, role: 'assistant', text, at: null, ...(reply.done ? {} : { state: 'writing' as const }) }, now)
  }
  for (const sent of outbox) {
    const waiting = sent.accepted ? {} : { state: 'queued' as const }
    const about = sent.about ? { about: sent.about } : {}
    place({ kind: 'message', key: `outbox:${sent.id}`, role: 'user', text: sent.text, at: sent.at, ...(sent.images ? { images: sent.images } : {}), ...about, ...waiting }, sent.at)
  }
  return days
}
