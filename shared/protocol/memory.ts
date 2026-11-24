/**
 * What hobkin remembers for every agent it runs (`057-shared-memory`): one fact a memory, kept as a file in the home's
 * `memories` folder by hobkin's runtime. The window reads them with `memory.list`, and changes one with `memory.save`,
 * `memory.forget` and `memory.undo`, which only the window may send. A host from before has none of this, and every
 * field but a memory's `name` may be missing.
 */

/**
 * What a memory is about: the user and their life (`user`), how they like things done (`preference`), a deadline, a
 * renewal or a date that comes back (`date`), what was decided and why (`decision`), an ongoing thing of theirs
 * (`project`), or where something lives (`pointer`). Rules for how agents work are not memories: they stay in the
 * user's directions.
 */
export const MEMORY_KINDS = ['user', 'preference', 'date', 'decision', 'project', 'pointer'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

/**
 * Who added or changed a memory, set by hobkin from who asked and never typed by an agent: the user in the window
 * (`user`), the main chat (`main`), a durable hobkin by its id (`hobkin`), another of the user's sessions through
 * `hobkin remember` (`outside`, with its name as `title`), or a run's suggestion the main chat filed (`suggested`).
 */
export interface MemoryAuthor {
  kind?: 'user' | 'main' | 'hobkin' | 'outside' | 'suggested'
  id?: string
  title?: string
}

/** When a memory was added or changed, as an ISO time, and by whom. */
export interface MemoryStamp {
  at?: string
  by?: MemoryAuthor
}

/** Where a memory came from, with up to 300 characters of the user's own words when it came from them. */
export interface MemorySource {
  kind?: 'chat' | 'window' | 'remember' | 'suggested' | 'moved'
  said?: string
  from?: string
}

export interface MemoryEntry {
  /** Its file's name: lower-case letters, digits and hyphens, 2 to 60 characters. */
  name: string
  /** One line, 150 characters at most: what every agent reads in its index. */
  description?: string
  kind?: MemoryKind
  /** The fact in plain sentences, 2000 characters at most. `[[name]]` links to another memory. */
  text?: string
  /** A private memory reaches only the main chat and durable hobkins, never a run. */
  private?: boolean
  /** A day, `YYYY-MM-DD`, after which it leaves every agent's index and shows as past. */
  until?: string
  added?: MemoryStamp
  changed?: MemoryStamp
  source?: MemorySource
  /** The memories its text links to. */
  links?: readonly string[]
  /** Its `until` has passed. */
  past?: boolean
  /** A fingerprint of its file. A save or a forget sends it back, and is refused when the file has moved on. */
  version?: string
}

/** What `memory.list` answers with. */
export interface MemoryList {
  memories: readonly MemoryEntry[]
  /** The "right now" list the main chat keeps (`memory.md`), one item a line, and its fingerprint. */
  now?: readonly string[]
  nowVersion?: string
  /** Files in the folder hobkin could not read as a memory, by name. */
  unreadable?: readonly string[]
  /**
   * Why there is nothing to list, in plain words for the page, when this hobkin cannot keep memories (a runtime from
   * before, or one that broke reaching them). Missing when the list is real, however empty.
   */
  unavailable?: string
}

/** What `memory.save` takes. With no `version` it adds a memory; with one it changes the memory of that name. */
export interface MemorySave {
  name?: string
  description: string
  text?: string
  kind: MemoryKind
  until?: string
  private?: boolean
  version?: string
}

/** What `memory.save` answers with: the memory as kept, or why it was refused, in plain words. */
export type MemorySaved = { saved: true; memory: MemoryEntry; change?: string } | { saved: false; message: string }

/** What `memory.forget` takes, and answers with: the change's id, which `memory.undo` takes to bring the memory back. */
export interface MemoryForget {
  name: string
  version?: string
}
export type MemoryForgot = { forgot: true; change: string } | { forgot: false; message: string }

/** What `memory.undo` takes: the id of a change, from a save, a forget or a chat line. */
export interface MemoryUndo {
  change: string
}
export type MemoryUndone = { ok: true } | { ok: false; reason: string }

/** What `memory.now.change` takes: one change to the "right now" list, by the main chat's own rules for it. */
export interface MemoryNowChange {
  action: 'add' | 'replace' | 'remove'
  /** The item as it reads now, for `replace` and `remove`. */
  item?: string
  /** The new words, for `add` and `replace`. */
  text?: string
  version?: string
}

/** What `memory.now.change` answers with: the list as it stands after the change, or why it was refused, in plain words. */
export type MemoryNowChanged = { ok: true; now?: readonly string[]; nowVersion?: string } | { ok: false; reason: string }

/**
 * On a chat line hobkin posts when an agent adds, changes or forgets a memory: which one and the change's id, so the
 * line offers Undo and See. A host from before sends none, and the line shows as any other.
 */
export interface MemoryNote {
  change: string
  name: string
  did?: 'added' | 'changed' | 'forgot' | 'restored'
}

/** The most memories a home keeps, and so the most the window is given. */
export const MEMORIES_MAX = 300
/** The most lines the "right now" list holds, as `memory.mjs` keeps it. */
export const MEMORY_NOW_MAX = 20

/** A memory's name, which is its file's name. */
export const MEMORY_NAME = /^[a-z0-9][a-z0-9-]{1,59}$/
/** As long as the runtime lets each be, and the rest short enough for a row. */
const WORDS_MAX = { description: 150, text: 2000, said: 300, from: 120, title: 120, now: 200, unreadable: 255, unavailable: 300 } as const
/** An id or a fingerprint is kept whole or not at all, since a cut one would name another change or match no file. */
const ID_MAX = 128
const LINKS_MAX = 50

const AUTHORS: readonly NonNullable<MemoryAuthor['kind']>[] = ['user', 'main', 'hobkin', 'outside', 'suggested']
const SOURCES: readonly NonNullable<MemorySource['kind']>[] = ['chat', 'window', 'remember', 'suggested', 'moved']
const DIDS: readonly NonNullable<MemoryNote['did']>[] = ['added', 'changed', 'forgot', 'restored']

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const oneOf = <Word extends string>(words: readonly Word[], value: unknown): Word | undefined => (words.includes(value as Word) ? (value as Word) : undefined)
const idOf = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 && value.length <= ID_MAX ? value : undefined)
const nameOf = (value: unknown): string | undefined => (typeof value === 'string' && MEMORY_NAME.test(value) ? value : undefined)
const timeOf = (value: unknown): string | undefined => (typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value)) ? value : undefined)
const dayOf = (value: unknown): string | undefined => (typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined)
const flagOf = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)

/** Words no longer than `most`, cut before a character that would be split in two. */
function cut(value: unknown, most: number): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length <= most) return value
  const end = /[\uD800-\uDBFF]/.test(value[most - 1]!) ? most - 1 : most
  return value.slice(0, end)
}

/** Only the fields that have a value, so a missing one is missing rather than undefined. */
const present = <Shape extends object>(fields: { [Key in keyof Shape]: Shape[Key] | undefined }): Shape =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Shape

/** Like `present`, and nothing at all when no field has a value. */
function someOf<Shape extends object>(fields: { [Key in keyof Shape]: Shape[Key] | undefined }): Shape | undefined {
  const shape = present<Shape>(fields)
  return Object.keys(shape).length ? shape : undefined
}

function authorOf(value: unknown): MemoryAuthor | undefined {
  if (!isRow(value)) return undefined
  return someOf<MemoryAuthor>({ kind: oneOf(AUTHORS, value.kind), id: idOf(value.id), title: cut(value.title, WORDS_MAX.title) })
}

function stampOf(value: unknown): MemoryStamp | undefined {
  if (!isRow(value)) return undefined
  return someOf<MemoryStamp>({ at: timeOf(value.at), by: authorOf(value.by) })
}

function sourceOf(value: unknown): MemorySource | undefined {
  if (!isRow(value)) return undefined
  return someOf<MemorySource>({ kind: oneOf(SOURCES, value.kind), said: cut(value.said, WORDS_MAX.said), from: cut(value.from, WORDS_MAX.from) })
}

function linksOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [...new Set(value.map(nameOf).filter((name) => name !== undefined))].slice(0, LINKS_MAX)
}

/** Each string of a list, cut to `most`, without the empty ones, and at most `count` of them. */
function linesOf(value: unknown, most: number, count: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .map((line) => cut(line, most))
    .filter((line): line is string => Boolean(line))
    .slice(0, count)
}

/** One memory read without trust into the contract's shape, or nothing for one whose name is not a memory's name. */
export function readMemory(value: unknown): MemoryEntry | undefined {
  if (!isRow(value)) return undefined
  const name = nameOf(value.name)
  if (!name) return undefined
  return present<MemoryEntry>({
    name,
    description: cut(value.description, WORDS_MAX.description),
    kind: oneOf(MEMORY_KINDS, value.kind),
    text: cut(value.text, WORDS_MAX.text),
    private: flagOf(value.private),
    until: dayOf(value.until),
    added: stampOf(value.added),
    changed: stampOf(value.changed),
    source: sourceOf(value.source),
    links: linksOf(value.links),
    past: flagOf(value.past),
    version: idOf(value.version),
  })
}

/**
 * The runtime's answer to `memory.list` read without trust: each memory checked into the shape above, words cut short,
 * a kind the window does not know left out, a memory whose name does not fit dropped and a name given twice kept once,
 * at most `MEMORIES_MAX` of them, and the "right now" list as its first `MEMORY_NOW_MAX` lines. Anything a list cannot be
 * read from reads as an empty one.
 */
export function readMemoryList(value: unknown): MemoryList {
  if (!isRow(value) || !Array.isArray(value.memories)) return { memories: [] }
  const seen = new Set<string>()
  const memories: MemoryEntry[] = []
  for (const row of value.memories) {
    if (memories.length >= MEMORIES_MAX) break
    const memory = readMemory(row)
    if (!memory || seen.has(memory.name)) continue
    seen.add(memory.name)
    memories.push(memory)
  }
  return present<MemoryList>({
    memories,
    now: linesOf(value.now, WORDS_MAX.now, MEMORY_NOW_MAX),
    nowVersion: idOf(value.nowVersion),
    unreadable: linesOf(value.unreadable, WORDS_MAX.unreadable, MEMORIES_MAX),
    unavailable: cut(value.unavailable, WORDS_MAX.unavailable) || undefined,
  })
}

/** A chat message's `memory` read without trust, or nothing when it has no change and memory name to offer Undo and See by. */
export function readMemoryNote(value: unknown): MemoryNote | undefined {
  if (!isRow(value)) return undefined
  const change = idOf(value.change)
  const name = nameOf(value.name)
  if (!change || !name) return undefined
  return present<MemoryNote>({ change, name, did: oneOf(DIDS, value.did) })
}
