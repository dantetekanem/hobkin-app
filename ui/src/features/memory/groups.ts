import { MEMORY_KINDS, MEMORY_NAME, type MemoryAuthor, type MemoryEntry, type MemoryKind } from '#shared/protocol/memory.ts'

/**
 * The Memory page's model (`057-shared-memory`): the memories by kind in the page's order with the newest change first,
 * the past ones apart, the counts, the search by words as hobkin's runtime does it, and what a row says of who added it
 * and when. Pure, so it is tested without a window or a host.
 */

/** Each kind's heading on the page, and how the editor names one memory of it. */
export const KIND_WORDS: Readonly<Record<MemoryKind, { heading: string; one: string }>> = {
  user: { heading: 'About you', one: 'About you' },
  preference: { heading: 'How you like things', one: 'How you like things' },
  date: { heading: 'Dates', one: 'A date' },
  decision: { heading: 'Decisions', one: 'A decision' },
  project: { heading: 'Projects', one: 'A project' },
  pointer: { heading: 'Where things are', one: 'Where something is' },
}

/** What the page shows: every memory, one kind, the Right now list, or the past ones. */
export type MemoryFilter = 'all' | MemoryKind | 'now' | 'past'

/** A part of the page that holds memories: a kind, the ones of no kind the window knows, the past ones, or what a search found. */
export interface MemorySection {
  key: MemoryKind | 'other' | 'past' | 'found'
  label: string
  memories: readonly MemoryEntry[]
}

/** One line of the Right now list, with its place in the whole list. */
export interface NowLine {
  text: string
  index: number
}

export type PagePart = MemorySection | { key: 'now'; lines: readonly NowLine[] }

export interface PageInput {
  memories: readonly MemoryEntry[]
  now?: readonly string[]
  query?: string
  filter?: MemoryFilter
  /** Today as `YYYY-MM-DD`, where the user is. */
  today: string
}

/** Today as `YYYY-MM-DD` on the user's own calendar. */
export const todayOf = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Its day to hold until has passed: as the host says, or as its `until` says when the host does not. */
export const isPast = (memory: MemoryEntry, today: string): boolean => memory.past ?? (memory.until !== undefined && memory.until < today)

const timeOf = (at: string | undefined) => {
  const time = Date.parse(at ?? '')
  return Number.isFinite(time) ? time : 0
}

/** When it last changed, or was added. */
export const changedAt = (memory: MemoryEntry): number => Math.max(timeOf(memory.changed?.at), timeOf(memory.added?.at))

const newestFirst = (a: MemoryEntry, b: MemoryEntry) => changedAt(b) - changedAt(a) || a.name.localeCompare(b.name)

/** The words a search looks for: each one apart, in lower case. */
export const searchWords = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean)

/**
 * How well a memory matches the words, as hobkin's runtime finds them: every word must be in its name, description or
 * text, and each adds 3 where it is in the name, 2 in the description and 1 in the text. Null when a word is in none.
 */
export function scoreOf(memory: MemoryEntry, words: readonly string[]): number | null {
  const name = memory.name.toLowerCase()
  const description = (memory.description ?? '').toLowerCase()
  const text = (memory.text ?? '').toLowerCase()
  let score = 0
  for (const word of words) {
    const found = (name.includes(word) ? 3 : 0) + (description.includes(word) ? 2 : 0) + (text.includes(word) ? 1 : 0)
    if (found === 0) return null
    score += found
  }
  return score
}

/** The memories that match every word, the best match first and, at the same score, the newest change. */
export function findMemories(memories: readonly MemoryEntry[], query: string): MemoryEntry[] {
  const words = searchWords(query)
  if (words.length === 0) return []
  return memories
    .map((memory) => ({ memory, score: scoreOf(memory, words) }))
    .filter((found): found is { memory: MemoryEntry; score: number } => found.score !== null)
    .sort((a, b) => b.score - a.score || newestFirst(a.memory, b.memory))
    .map(({ memory }) => memory)
}

export interface MemoryCounts {
  /** Every memory that is not past. */
  all: number
  kinds: Record<MemoryKind, number>
  /** Of a kind the window does not know. */
  other: number
  past: number
  /** Lines in the Right now list. */
  now: number
}

/** How many memories of each kind the page holds. A search does not change them. */
export function countsOf(memories: readonly MemoryEntry[], now: readonly string[], today: string): MemoryCounts {
  const kinds = Object.fromEntries(MEMORY_KINDS.map((kind) => [kind, 0])) as Record<MemoryKind, number>
  let other = 0
  let past = 0
  for (const memory of memories) {
    if (isPast(memory, today)) past += 1
    else if (memory.kind) kinds[memory.kind] += 1
    else other += 1
  }
  return { all: memories.length - past, kinds, other, past, now: now.length }
}

const inFilter = (memory: MemoryEntry, filter: MemoryFilter, today: string): boolean => {
  if (filter === 'all') return true
  if (filter === 'now') return false
  if (filter === 'past') return isPast(memory, today)
  return memory.kind === filter && !isPast(memory, today)
}

const nowLines = (now: readonly string[], words: readonly string[]): NowLine[] =>
  now.map((text, index) => ({ text, index })).filter(({ text }) => words.every((word) => text.toLowerCase().includes(word)))

/**
 * The page's parts in order. With no search: each kind that has a memory (a kind chosen shows even with none), the
 * ones of no known kind, the Right now list, then the past ones. With a search: one part of what was found, ranked,
 * then the Right now lines that hold every word.
 */
export function pageOf({ memories, now = [], query = '', filter = 'all', today }: PageInput): PagePart[] {
  const words = searchWords(query)
  const showsNow = filter === 'all' || filter === 'now'
  const nowPart: PagePart[] = showsNow ? [{ key: 'now', lines: nowLines(now, words) }] : []
  if (words.length > 0) {
    if (filter === 'now') return nowPart
    const found = findMemories(
      memories.filter((memory) => inFilter(memory, filter, today)),
      query,
    )
    return [{ key: 'found', label: found.length === 0 ? 'Nothing found' : `${found.length} found`, memories: found }, ...nowPart]
  }
  if (filter === 'now') return nowPart

  const shown = memories.filter((memory) => inFilter(memory, filter, today)).sort(newestFirst)
  const current = shown.filter((memory) => !isPast(memory, today))
  const parts: PagePart[] = []
  for (const kind of MEMORY_KINDS) {
    const ofKind = current.filter((memory) => memory.kind === kind)
    if (ofKind.length > 0 || filter === kind) parts.push({ key: kind, label: KIND_WORDS[kind].heading, memories: ofKind })
  }
  const other = current.filter((memory) => !memory.kind)
  if (other.length > 0) parts.push({ key: 'other', label: 'Other', memories: other })
  parts.push(...nowPart)
  const past = shown.filter((memory) => isPast(memory, today))
  if (past.length > 0 || filter === 'past') parts.push({ key: 'past', label: 'Past', memories: past })
  return parts
}

export interface WordsAt {
  /** The time now, for the year a date leaves out. */
  now: number
  timeZone?: string
}

/** "Nov 2", and "Dec 30, 2025" in another year than now's. */
function dayWords(at: number, { now, timeZone }: WordsAt): string {
  const year = (time: number) => new Intl.DateTimeFormat('en', { timeZone, year: 'numeric' }).format(time)
  const sameYear = year(at) === year(now)
  return new Intl.DateTimeFormat('en', { timeZone, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(at)
}

/** Who an author is, in a few words: "you", "hobkin", a durable hobkin's or a session's name. */
function whoOf(by: MemoryAuthor, from?: string): string {
  if (by.kind === 'user') return 'you'
  if (by.kind === 'main') return 'hobkin'
  if (by.kind === 'hobkin') return by.title ?? 'a hobkin'
  if (by.kind === 'outside') return by.title ?? 'another session'
  if (by.kind === 'suggested') return by.title ?? from ?? 'a run'
  return 'someone'
}

/** How it came to be: "From you, in Chat", "From Claude Code", "Suggested by Morning check". */
function addedWords(memory: MemoryEntry): string | null {
  const by = memory.added?.by
  const said = Boolean(memory.source?.said)
  if (!by) return memory.added?.at ? 'Added' : null
  if (by.kind === 'suggested') return `Suggested by ${whoOf(by, memory.source?.from)}`
  if (by.kind === 'main' && said && memory.source?.kind === 'chat') return 'From you, in Chat'
  if (by.kind === 'hobkin' && said) return `From you, in ${whoOf(by)}`
  return `From ${whoOf(by)}`
}

/**
 * Where a memory came from and when, and who changed it last: "From you, in Chat, Nov 2", "From Claude Code, Nov 15 ·
 * changed by hobkin, Nov 20". Null when the host said neither.
 */
export function fromWords(memory: MemoryEntry, at: WordsAt): string | null {
  const addedTime = timeOf(memory.added?.at)
  const changedTime = timeOf(memory.changed?.at)
  const parts: string[] = []

  const added = addedWords(memory)
  if (added !== null) parts.push(addedTime ? `${added}, ${dayWords(addedTime, at)}` : added)

  // A change stamped with the add's own time is the add itself.
  if (changedTime && changedTime !== addedTime) {
    const by = memory.changed?.by
    const day = dayWords(changedTime, at)
    parts.push(by ? `changed by ${whoOf(by)}, ${day}` : `changed ${day}`)
  }

  if (parts.length === 0) return null
  const line = parts.join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

/** "until Mar 3, 2027", for the day a memory holds until. The day is the calendar's, wherever the user is. */
export function untilWords(until: string, now: number): string {
  const day = Date.parse(`${until}T12:00:00Z`)
  if (!Number.isFinite(day)) return `until ${until}`
  return `until ${dayWords(day, { now, timeZone: 'UTC' })}`
}

export type TextPart = { text: string } | { link: string }

const LINK = /\[\[([^\]]+)\]\]/g

/** A memory's text with each `[[name]]` of another memory as a link of its own. Brackets around anything else stay words. */
export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  let end = 0
  for (const match of text.matchAll(LINK)) {
    const name = match[1] ?? ''
    if (!MEMORY_NAME.test(name)) continue

    const before = text.slice(end, match.index)
    if (before) parts.push({ text: before })
    parts.push({ link: name })
    end = match.index + match[0].length
  }

  const after = text.slice(end)
  if (after) parts.push({ text: after })
  return parts
}

/** The memories a text links to with `[[name]]`, in order. */
export const linksIn = (text: string): string[] => textParts(text).flatMap((part) => ('link' in part ? [part.link] : []))

/** A memory's name as words, for a link to it: "car-insurance-quotes" as "car insurance quotes". */
export const nameWords = (name: string): string => name.replaceAll('-', ' ')
