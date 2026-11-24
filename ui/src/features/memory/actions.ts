import { readMemoryList, type MemoryEntry, type MemorySave } from '#shared/protocol/memory.ts'
import { NEW_DRAFT, draftOf, refusalWords, without, type MemoryDraft, type MemorySend, type MemoryStore } from './store.ts'

/**
 * What the Memory page and a chat line do (`057-shared-memory`), each through one of the host's commands: save a row,
 * make it private or share it, forget it, undo a save, a forget or an agent's change, and change the Right now list.
 * A refusal keeps what the user typed and says why where it happened. Pure: the host is reached only through `send`.
 */

const row = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {})

/** Why an answer is a refusal, in the host's words, or null when it went through. */
function refusalIn(answer: unknown): string | null {
  const { saved, forgot, ok, message, reason } = row(answer)
  if (saved === false || forgot === false || ok === false) return String(message ?? reason ?? 'hobkin did not do it.')
  return null
}

/** A memory the host answered with, read without trust. */
const memoryIn = (value: unknown): MemoryEntry | undefined => readMemoryList({ memories: [value] }).memories[0]

/** What `memory.save` is sent for a draft: every field the row holds, so the memory reads as the row does. */
function saveOf(draft: MemoryDraft, memory: MemoryEntry | undefined): MemorySave {
  const until = draft.until.trim()
  return {
    ...(memory ? { name: memory.name, ...(memory.version ? { version: memory.version } : {}) } : {}),
    description: draft.description.trim(),
    kind: draft.kind,
    text: draft.text.trim(),
    ...(until ? { until } : {}),
    private: draft.private,
  }
}

export function createMemoryActions(store: MemoryStore, send: MemorySend) {
  const set = store.setState
  const busy = (key: string, on: boolean) => set(({ busy: now }) => ({ busy: on ? { ...now, [key]: true } : without(now, key) }))
  const refuse = (key: string, words: string | null) => set(({ refused }) => ({ refused: words === null ? without(refused, key) : { ...refused, [key]: words } }))

  /** Puts the memory as the host keeps it in the list, in place of the one of its name. */
  const keep = (memory: MemoryEntry) =>
    set(({ list }) => {
      const memories = list?.memories ?? []
      const at = memories.findIndex((one) => one.name === memory.name)
      return { list: { ...list, memories: at < 0 ? [memory, ...memories] : memories.with(at, memory) } }
    })

  /** Sends a save of these fields for the row `key`. The draft, if any, closes only when the host keeps it. */
  const sendSave = async (key: string, args: MemorySave): Promise<void> => {
    if (store.getState().busy[key]) return
    if (!args.description) {
      refuse(key, 'Write a description first: one line that says what to remember.')
      return
    }
    busy(key, true)
    refuse(key, null)
    try {
      const answer = await send('memory.save', args)
      const refused = refusalIn(answer)
      const memory = refused === null ? memoryIn(row(answer).memory) : undefined
      if (refused !== null || !memory) {
        refuse(key, refused ?? 'hobkin answered without the memory it kept.')
        return
      }
      keep(memory)
      const change = row(answer).change
      set(({ drafts, saved }) => ({
        drafts: without(drafts, key),
        saved: typeof change === 'string' && change ? { ...saved, [memory.name]: change } : without(saved, memory.name),
      }))
      store.settled()
    } catch (error) {
      refuse(key, refusalWords(error))
    } finally {
      busy(key, false)
    }
  }

  /** Sends a Right now change. Once it goes through, the list is read again for its new version. */
  const sendNow = async (args: { action: 'add' | 'replace' | 'remove'; item?: string; text?: string }): Promise<boolean> => {
    if (store.getState().nowBusy) return false
    const version = store.getState().list?.nowVersion
    set({ nowBusy: true, nowRefused: null })
    try {
      const refused = refusalIn(await send('memory.now.change', { ...args, ...(version ? { version } : {}) }))
      if (refused !== null) {
        set({ nowRefused: refused })
        return false
      }
      void store.read()
      return true
    } catch (error) {
      set({ nowRefused: refusalWords(error) })
      return false
    } finally {
      set({ nowBusy: false })
    }
  }

  return {
    /** Saves the row's draft, or the new memory's. */
    save(key: string): Promise<void> {
      const draft = store.getState().drafts[key]
      if (!draft) return Promise.resolve()
      const memory = key === NEW_DRAFT ? undefined : store.memoryNamed(key)
      if (key !== NEW_DRAFT && !memory) {
        refuse(key, 'That memory is not here any more.')
        return Promise.resolve()
      }
      return sendSave(key, saveOf(draft, memory))
    },
    /** Make private, or Share with every agent: the memory saved as it is, but for that. */
    setPrivate(name: string, keepPrivate: boolean): Promise<void> {
      const memory = store.memoryNamed(name)
      if (!memory) return Promise.resolve()
      return sendSave(name, saveOf({ ...draftOf(memory), private: keepPrivate }, memory))
    },
    async forget(name: string): Promise<void> {
      const memory = store.memoryNamed(name)
      if (!memory || store.getState().busy[name]) return
      busy(name, true)
      refuse(name, null)
      try {
        const answer = await send('memory.forget', { name, ...(memory.version ? { version: memory.version } : {}) })
        const refused = refusalIn(answer)
        const change = row(answer).change
        if (refused !== null || typeof change !== 'string' || !change) {
          refuse(name, refused ?? 'hobkin answered without a way to bring it back, so nothing is shown as forgotten.')
          return
        }
        set(({ list, forgotten, saved }) => ({
          list: list ? { ...list, memories: list.memories.filter((one) => one.name !== name) } : list,
          forgotten: { ...forgotten, [name]: { entry: memory, change } },
          saved: without(saved, name),
        }))
      } catch (error) {
        refuse(name, refusalWords(error))
      } finally {
        busy(name, false)
      }
    },
    /** Brings back a memory forgotten on this page, in its place, then reads the list for it as kept. */
    async undoForget(name: string): Promise<void> {
      const lost = store.getState().forgotten[name]
      if (!lost || store.getState().busy[name]) return
      busy(name, true)
      try {
        const refused = refusalIn(await send('memory.undo', { change: lost.change }))
        if (refused !== null) {
          set(({ forgotten }) => ({ forgotten: { ...forgotten, [name]: { ...lost, refused } } }))
          return
        }
        set(({ forgotten }) => ({ forgotten: without(forgotten, name) }))
        keep(lost.entry)
        void store.read()
      } catch (error) {
        set(({ forgotten }) => ({ forgotten: { ...forgotten, [name]: { ...lost, refused: refusalWords(error) } } }))
      } finally {
        busy(name, false)
      }
    },
    /** Takes back a save made on this page: an added memory goes, a changed one reads as it did. */
    async undoSave(name: string): Promise<void> {
      const change = store.getState().saved[name]
      if (!change || store.getState().busy[name]) return
      busy(name, true)
      refuse(name, null)
      try {
        const refused = refusalIn(await send('memory.undo', { change }))
        if (refused !== null) {
          refuse(name, refused)
          return
        }
        set(({ saved }) => ({ saved: without(saved, name) }))
        void store.read()
      } catch (error) {
        refuse(name, refusalWords(error))
      } finally {
        busy(name, false)
      }
    },
    /** A chat line's Undo: sent once, and the line then says it was undone or why it could not be. */
    async undoLine(change: string): Promise<void> {
      if (store.getState().lines[change]) return
      const settle = (undo: { state: 'sending' | 'undone' | 'refused'; reason?: string }) => set(({ lines }) => ({ lines: { ...lines, [change]: undo } }))
      settle({ state: 'sending' })
      try {
        const refused = refusalIn(await send('memory.undo', { change }))
        settle(refused === null ? { state: 'undone' } : { state: 'refused', reason: refused })
        if (refused === null && store.getState().open) void store.read()
      } catch (error) {
        settle({ state: 'refused', reason: refusalWords(error) })
      }
    },
    /** Saves the Right now line being written: a new one, or the words of the one it changes. */
    async nowSave(): Promise<void> {
      const edit = store.getState().nowEdit
      if (!edit) return
      const text = edit.text.trim()
      if (!text) {
        set({ nowRefused: 'Write the line first.' })
        return
      }
      if (text === edit.item) {
        store.nowCancel()
        return
      }
      const done = await sendNow(edit.item === null ? { action: 'add', text } : { action: 'replace', item: edit.item, text })
      if (done) store.nowCancel()
    },
    /** Removes a Right now line. It stays where it was as one line with Undo until the page is left. */
    async nowRemove(item: string, index: number): Promise<void> {
      if (await sendNow({ action: 'remove', item })) set(({ nowRemoved }) => ({ nowRemoved: [...nowRemoved, { text: item, index }] }))
    },
    /** Puts a removed line back on the list. */
    async nowUndoRemove(text: string): Promise<void> {
      if (await sendNow({ action: 'add', text })) set(({ nowRemoved }) => ({ nowRemoved: nowRemoved.filter((one) => one.text !== text) }))
    },
  }
}

export type MemoryActions = ReturnType<typeof createMemoryActions>
