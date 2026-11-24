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

/**
 * On a chat line hobkin posts when an agent adds, changes or forgets a memory: which one and the change's id, so the
 * line offers Undo and See. A host from before sends none, and the line shows as any other.
 */
export interface MemoryNote {
  change: string
  name: string
  did?: 'added' | 'changed' | 'forgot' | 'restored'
}
