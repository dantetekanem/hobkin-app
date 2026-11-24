import { createStore } from 'zustand/vanilla'
import { readMemoryList, type MemoryEntry, type MemoryKind, type MemoryList } from '#shared/protocol/memory.ts'
import { RESTART_NEEDED } from '../../lib/host/refusal.ts'

/**
 * The Memory page's state (`057-shared-memory`): the list as hobkin last answered it, a draft for each row being
 * edited, what the host refused, the rows forgotten while the page is open, and what a chat line's Undo did. An open
 * page reads the list again when the snapshot's `memoriesStamp` changes, and waits while a row is being edited, so
 * nothing moves around it until Save. Pure: it reaches the host only through `send`, so it is tested with a fake.
 * Its one instance lives in `use-memories.ts`.
 */

export type MemoryCommand = 'memory.list' | 'memory.save' | 'memory.forget' | 'memory.undo' | 'memory.now.change'

/** Sends one of the window's memory commands, and settles with the host's answer or rejects with its reason. */
export type MemorySend = (name: MemoryCommand, args: object) => Promise<unknown>

/** What the page says when the running hobkin has no memory commands yet. */
export const NOT_AVAILABLE_YET = 'Not available yet. The hobkin running now does not keep memories.'

const UNKNOWN_COMMAND = /^There is no command named "/

/** A refusal as the page says it: a command the running host does not know reads as not available yet. */
export function refusalWords(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message === RESTART_NEEDED || UNKNOWN_COMMAND.test(message) ? NOT_AVAILABLE_YET : message
}

/** The key of the draft for a memory being added, which no memory's name can be. */
export const NEW_DRAFT = '+new'

/** What the editor holds for a row: every field the user can change. `until` is empty for none. */
export interface MemoryDraft {
  description: string
  kind: MemoryKind
  until: string
  private: boolean
  text: string
}

/** A memory forgotten while the page is open: its last words, the change that brings it back, and an Undo refused. */
export interface Forgotten {
  entry: MemoryEntry
  change: string
  refused?: string
}

/** What a chat line's Undo did: on its way, done, or refused with the host's reason. */
export interface LineUndo {
  state: 'sending' | 'undone' | 'refused'
  reason?: string
}

/** A Right now line being written: the line it changes, or null for a new one, and the words now. */
export interface NowEdit {
  item: string | null
  text: string
}

export interface MemoryState {
  /** What hobkin last answered. Null until the first answer. */
  list: MemoryList | null
  reading: boolean
  /** Why the last read failed, in the page's words. */
  problem: string | null
  /** The rows being edited, by memory name, and `NEW_DRAFT` for one being added. */
  drafts: Readonly<Record<string, MemoryDraft>>
  /** The version of the memory each draft was opened from, to tell when it changed meanwhile. */
  draftFrom: Readonly<Record<string, string>>
  /** The rows whose command is on its way. */
  busy: Readonly<Record<string, true>>
  /** Why the host refused a row's last command. */
  refused: Readonly<Record<string, string>>
  /** The memories saved while the page is open, with the change that takes the save back. */
  saved: Readonly<Record<string, string>>
  forgotten: Readonly<Record<string, Forgotten>>
  /** A memory the page should bring into view: from a link, or a chat line's See. */
  seek: string | null
  /** Each chat line's Undo, by its change. */
  lines: Readonly<Record<string, LineUndo>>
  nowEdit: NowEdit | null
  nowBusy: boolean
  nowRefused: string | null
  /** Right now lines removed while the page is open, where they were, so each can be put back. */
  nowRemoved: readonly { text: string; index: number }[]
  /** The page is showing. */
  open: boolean
  /** The stamp changed while a row was being edited: read once it closes. */
  stale: boolean
  stamp: string | null
}

const INITIAL: MemoryState = {
  list: null,
  reading: false,
  problem: null,
  drafts: {},
  draftFrom: {},
  busy: {},
  refused: {},
  saved: {},
  forgotten: {},
  seek: null,
  lines: {},
  nowEdit: null,
  nowBusy: false,
  nowRefused: null,
  nowRemoved: [],
  open: false,
  stale: false,
  stamp: null,
}

/** A record without one key. */
export function without<Value>(record: Readonly<Record<string, Value>>, key: string): Record<string, Value> {
  if (!(key in record)) return record as Record<string, Value>
  const { [key]: _gone, ...rest } = record
  return rest
}

/**
 * The memory changed after its row was opened for editing (another agent, or another window, saved it meanwhile). The
 * row then shows what it says now under the draft, and Save puts the draft in its place.
 */
export function changedMeanwhile(state: Pick<MemoryState, 'drafts' | 'draftFrom'>, memory: MemoryEntry): boolean {
  const openedFrom = state.draftFrom[memory.name]
  if (!state.drafts[memory.name] || openedFrom === undefined || memory.version === undefined) return false
  return openedFrom !== memory.version
}

/** The draft a memory opens with: its own fields, and About you for one with no kind. */
export const draftOf = (memory: MemoryEntry): MemoryDraft => ({
  description: memory.description ?? '',
  kind: memory.kind ?? 'user',
  until: memory.until ?? '',
  private: memory.private === true,
  text: memory.text ?? '',
})

export function createMemoryStore({ send }: { send: MemorySend }) {
  const store = createStore<MemoryState>(() => INITIAL)
  let reads = 0

  const editing = (state: MemoryState) => Object.keys(state.drafts).length > 0 || state.nowEdit !== null

  /** Reads the list. Only the latest read lands, so an older answer never covers a newer one. */
  const read = async (): Promise<void> => {
    const serial = ++reads
    store.setState({ reading: true, stale: false })
    try {
      const list = readMemoryList(await send('memory.list', {}))
      if (serial === reads) store.setState({ list, problem: null })
    } catch (error) {
      if (serial === reads) store.setState({ problem: refusalWords(error) })
    } finally {
      if (serial === reads) store.setState({ reading: false })
    }
  }

  /** Once the last row being edited has closed, a stamp that changed meanwhile reads. */
  const settled = () => {
    const state = store.getState()
    if (state.open && state.stale && !editing(state)) void read()
  }

  const memoryNamed = (name: string) => store.getState().list?.memories.find((memory) => memory.name === name)

  return Object.assign(store, {
    read,
    settled,
    memoryNamed,
    /** The page came into view: it reads the list. */
    opened() {
      store.setState({ open: true })
      void read()
    },
    /** The page was left: what was forgotten or removed there stops offering Undo. Drafts stay, with their words. */
    left() {
      store.setState({ open: false, forgotten: {}, saved: {}, nowRemoved: [], seek: null, nowRefused: null })
    },
    /** The snapshot's stamp: an open page reads again when it changes. An older host sends none. */
    stampSeen(stamp: string | undefined) {
      const state = store.getState()
      if (stamp === undefined || stamp === state.stamp) return
      store.setState({ stamp })
      if (!state.open) return
      if (editing(state)) store.setState({ stale: true })
      else void read()
    },
    /** The window found or lost its host: the list it showed is another one's, so it is read again. */
    hostChanged() {
      store.setState({ list: null, problem: null, forgotten: {}, saved: {}, nowRemoved: [], lines: {} })
      if (store.getState().open) void read()
    },
    edit(name: string) {
      const memory = memoryNamed(name)
      if (!memory) return
      store.setState(({ drafts, draftFrom, refused }) => ({
        drafts: { ...drafts, [name]: draftOf(memory) },
        draftFrom: memory.version ? { ...draftFrom, [name]: memory.version } : without(draftFrom, name),
        refused: without(refused, name),
      }))
    },
    add(kind: MemoryKind = 'user') {
      store.setState(({ drafts, refused }) => ({
        drafts: { ...drafts, [NEW_DRAFT]: drafts[NEW_DRAFT] ?? { description: '', kind, until: '', private: false, text: '' } },
        refused: without(refused, NEW_DRAFT),
      }))
    },
    change(key: string, patch: Partial<MemoryDraft>) {
      store.setState(({ drafts }) => {
        const draft = drafts[key]
        return draft ? { drafts: { ...drafts, [key]: { ...draft, ...patch } } } : {}
      })
    },
    cancel(key: string) {
      store.setState(({ drafts, draftFrom, refused }) => ({ drafts: without(drafts, key), draftFrom: without(draftFrom, key), refused: without(refused, key) }))
      settled()
    },
    /** Brings a memory into view, from a link or a chat line's See. */
    seekMemory(name: string) {
      store.setState({ seek: name })
    },
    sought() {
      store.setState({ seek: null })
    },
    nowStart(item: string | null) {
      store.setState({ nowEdit: { item, text: item ?? '' }, nowRefused: null })
    },
    nowType(text: string) {
      store.setState(({ nowEdit }) => (nowEdit ? { nowEdit: { ...nowEdit, text } } : {}))
    },
    nowCancel() {
      store.setState({ nowEdit: null, nowRefused: null })
      settled()
    },
  })
}

export type MemoryStore = ReturnType<typeof createMemoryStore>
