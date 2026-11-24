import { readMemory, readMemoryList, type MemoryForget, type MemoryForgot, type MemoryList, type MemoryNowChange, type MemoryNowChanged, type MemorySave, type MemorySaved, type MemoryUndone } from '#shared/protocol/memory.ts'
import type { HostHandlers } from './commands.ts'

/**
 * What hobkin remembers for every agent it runs (057-shared-memory), on its way from hobkin's runtime to the window's
 * Memory page and the page's changes back. hobkin's runtime keeps the memories and every rule about them, and makes
 * each change it gets from here the user's own, from the window. The host reads its answers without trust and checks a
 * change against the version the page read. A refusal is an answer in plain words, so the page keeps the user's draft
 * and says why; a runtime that throws (a disk error) fails the command with its error. Nothing a memory says is logged.
 */

/** The runtime's functions for the window. Each answers in the contract's shape, read without trust; a refusal is such an answer. */
export interface MemoryOperations {
  /** `{ memories, now, nowVersion, unreadable }`. */
  list(): Promise<unknown> | unknown
  /** `{ saved: true, memory, change }` or `{ saved: false, message }`. */
  save(memory: MemorySave): Promise<unknown> | unknown
  /** `{ forgot: true, change }` or `{ forgot: false, message }`. */
  forget(forget: MemoryForget): Promise<unknown> | unknown
  /** `{ ok: true }` or `{ ok: false, reason }`. */
  undo(change: string): Promise<unknown> | unknown
  /** `{ ok: true, now, nowVersion }` or `{ ok: false, reason }`. */
  changeNow(change: MemoryNowChange): Promise<unknown> | unknown
}

/**
 * hobkin's functions for the window's Memory page. A hobkin from before has no such file, so it is looked up when a
 * command asks for it rather than resolved ahead.
 */
const WINDOW_SURFACE = 'hobkin/src/cli/memory-window.mjs'

type Method = (...args: unknown[]) => unknown

const isMethod = (value: unknown): value is Method => typeof value === 'function'

/** hobkin's memory functions for the home's data in `root`, or nothing from a hobkin that has none or lacks one of them. */
export async function memoryOperationsAt(root: string): Promise<MemoryOperations | null> {
  const surface = (await import(WINDOW_SURFACE)) as Record<string, unknown>
  const { memoryList, memorySave, memoryForget, memoryUndo, memoryNowChange } = surface
  if (!isMethod(memoryList) || !isMethod(memorySave) || !isMethod(memoryForget) || !isMethod(memoryUndo) || !isMethod(memoryNowChange)) return null
  return {
    list: () => memoryList(root),
    save: (memory) => memorySave(root, memory),
    forget: (forget) => memoryForget(root, forget),
    undo: (change) => memoryUndo(root, { change }),
    changeNow: (change) => memoryNowChange(root, change),
  }
}

export interface MemorySeat {
  /** The runtime's functions, or nothing from a runtime that has none. One that cannot load them throws. */
  operations: () => Promise<MemoryOperations | null | undefined> | MemoryOperations | null | undefined
}

const NOT_AVAILABLE = 'This hobkin has no memory yet. Restart the app to load it.'
const STALE_SAVE = 'This memory changed since you opened it, so your change was not saved. Your draft is kept: look at the memory as it is now, then save again.'
const GONE_SAVE = 'This memory was forgotten since you opened it, so your change was not saved. Your draft is kept: save it again with no name to add it back.'
const STALE_FORGET = 'This memory changed since you opened it, so hobkin did not forget it. Look at it as it is now first.'
const STALE_NOW = 'The Right now list changed since you opened it, so nothing changed. Your words are kept: look at the list as it is now, then try again.'
const UNSAID = {
  save: 'hobkin did not say it kept the memory. Your draft is kept: look at the list before you save again.',
  forget: 'hobkin did not say it forgot the memory, so it may still be there.',
  undo: 'hobkin did not say it took the change back, so the memory may be as it was.',
  now: 'hobkin did not say it changed the list, so it may be as it was.',
}
/** As long as a refusal the page shows may be, and as long as a change's id may be. */
const REASON_MAX = 300
const ID_MAX = 128

type Answer = Record<string, unknown>

const answerOf = (value: unknown): Answer => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Answer) : {})

/** The runtime's own words for a refusal, cut before a character that would be split in two, or nothing when it gave none. */
function wordsOf(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  if (value.length <= REASON_MAX) return value
  return value.slice(0, /[\uD800-\uDBFF]/.test(value[REASON_MAX - 1]!) ? REASON_MAX - 1 : REASON_MAX)
}

const changeOf = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 && value.length <= ID_MAX ? value : undefined)

function saved(answer: unknown): MemorySaved {
  const { saved: kept, memory, change, message } = answerOf(answer)
  const read = kept === true ? readMemory(memory) : undefined
  if (read) {
    const id = changeOf(change)
    return id ? { saved: true, memory: read, change: id } : { saved: true, memory: read }
  }
  return { saved: false, message: (kept === false && wordsOf(message)) || UNSAID.save }
}

function forgot(answer: unknown): MemoryForgot {
  const { forgot: done, change, message } = answerOf(answer)
  const id = done === true ? changeOf(change) : undefined
  if (id) return { forgot: true, change: id }
  return { forgot: false, message: (done === false && wordsOf(message)) || UNSAID.forget }
}

function undone(answer: unknown): MemoryUndone {
  const { ok, reason } = answerOf(answer)
  if (ok === true) return { ok: true }
  return { ok: false, reason: (ok === false && wordsOf(reason)) || UNSAID.undo }
}

function nowChanged(answer: unknown): MemoryNowChanged {
  const { ok, reason, now, nowVersion } = answerOf(answer)
  if (ok !== true) return { ok: false, reason: (ok === false && wordsOf(reason)) || UNSAID.now }
  const list = readMemoryList({ memories: [], now, nowVersion })
  return { ok: true, ...(list.now && { now: list.now }), ...(list.nowVersion && { nowVersion: list.nowVersion }) }
}

export function memoryHandlers({ operations }: MemorySeat): Pick<HostHandlers, 'memory.list' | 'memory.save' | 'memory.forget' | 'memory.undo' | 'memory.now.change'> {
  /** Runs `work` with the runtime's functions, or answers through `refused` that this hobkin has no memory yet. */
  const withRuntime = async <Result>(refused: (words: string) => Result, work: (runtime: MemoryOperations) => Promise<Result>): Promise<Result> => {
    let runtime: MemoryOperations | null | undefined
    try {
      runtime = await operations()
    } catch {
      runtime = null
    }
    return runtime ? work(runtime) : refused(NOT_AVAILABLE)
  }

  const listOf = async (runtime: MemoryOperations): Promise<MemoryList> => readMemoryList(await runtime.list())

  /** Whether a memory read at `version` has moved on or gone since; null when the change may go. */
  const moved = async (runtime: MemoryOperations, name: string | undefined, version: string | undefined): Promise<'stale' | 'gone' | null> => {
    if (version === undefined || name === undefined) return null
    const now = (await listOf(runtime)).memories.find((memory) => memory.name === name)
    if (!now) return 'gone'
    return now.version !== undefined && now.version !== version ? 'stale' : null
  }

  return {
    'memory.list': () => withRuntime((unavailable): MemoryList => ({ memories: [], unavailable }), listOf),
    'memory.save': (memory) =>
      withRuntime(
        (message): MemorySaved => ({ saved: false, message }),
        async (runtime) => {
          const why = await moved(runtime, memory.name, memory.version)
          if (why) return { saved: false, message: why === 'gone' ? GONE_SAVE : STALE_SAVE }
          return saved(await runtime.save(memory))
        },
      ),
    'memory.forget': (forget) =>
      withRuntime(
        (message): MemoryForgot => ({ forgot: false, message }),
        async (runtime) => {
          // A memory already gone is the runtime's to answer for: the same click may have forgotten it a moment before.
          if ((await moved(runtime, forget.name, forget.version)) === 'stale') return { forgot: false, message: STALE_FORGET }
          return forgot(await runtime.forget(forget))
        },
      ),
    'memory.undo': ({ change }) =>
      withRuntime(
        (reason): MemoryUndone => ({ ok: false, reason }),
        async (runtime) => undone(await runtime.undo(change)),
      ),
    'memory.now.change': (change) =>
      withRuntime(
        (reason): MemoryNowChanged => ({ ok: false, reason }),
        async (runtime) => {
          const { nowVersion } = await listOf(runtime)
          if (nowVersion !== undefined && change.version !== nowVersion) return { ok: false, reason: STALE_NOW }
          return nowChanged(await runtime.changeNow(change))
        },
      ),
  }
}
