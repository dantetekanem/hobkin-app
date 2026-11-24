import { readMemoryList, type MemoryEntry, type MemorySave } from '#shared/protocol/memory.ts'
import { NEW_DRAFT, draftOf, refusalWords, without, type LineUndo, type MemoryDraft, type MemorySend, type MemoryStore } from './store.ts'

/**
 * What the Memory page and a chat line do (`057-shared-memory`), each through one of the host's commands: save a row,
 * make it private or share it, forget it, undo a save, a forget or an agent's change, and change the Right now list.
 * A refusal keeps what the user typed and says why where it happened. Pure: the host is reached only through `send`.
 */

type Answer = Record<string, unknown>

const answerOf = (value: unknown): Answer => (typeof value === 'object' && value !== null ? (value as Answer) : {})

/** Why an answer is a refusal, in the host's words, or null when it went through. */
function refusalIn(answer: Answer): string | null {
  const refused = answer.saved === false || answer.forgot === false || answer.ok === false
  if (!refused) return null
  return String(answer.message ?? answer.reason ?? 'hobkin did not do it.')
}

/** The change id an answer carries, which `memory.undo` takes back. */
const changeIn = (answer: Answer): string | null => (typeof answer.change === 'string' && answer.change ? answer.change : null)

/** A memory the host answered with, read without trust. */
const memoryIn = (value: unknown): MemoryEntry | undefined => readMemoryList({ memories: [value] }).memories[0]

/** What `memory.save` is sent for a draft: every field the row holds, so the memory reads as the row does. */
function saveOf(draft: MemoryDraft, memory: MemoryEntry | undefined): MemorySave {
  const until = draft.until.trim()
  const kept = memory ? { name: memory.name, ...(memory.version ? { version: memory.version } : {}) } : {}
  return {
    ...kept,
    description: draft.description.trim(),
    kind: draft.kind,
    text: draft.text.trim(),
    ...(until ? { until } : {}),
    private: draft.private,
  }
}

export function createMemoryActions(store: MemoryStore, send: MemorySend) {
  const set = store.setState
  const isBusy = (key: string) => store.getState().busy[key] === true

  const markBusy = (key: string, busy: boolean) => {
    set((state) => ({ busy: busy ? { ...state.busy, [key]: true } : without(state.busy, key) }))
  }

  const setRefusal = (key: string, words: string | null) => {
    set(({ refused }) => ({ refused: words === null ? without(refused, key) : { ...refused, [key]: words } }))
  }

  /** Puts the memory as the host keeps it in the list, in place of the one of its name, or first when it is new. */
  const keepMemory = (memory: MemoryEntry) => {
    set(({ list }) => {
      const memories = list?.memories ?? []
      const at = memories.findIndex((one) => one.name === memory.name)
      const next = at < 0 ? [memory, ...memories] : memories.with(at, memory)
      return { list: { ...list, memories: next } }
    })
  }

  const setForgotten = (name: string, refused?: string) => {
    set(({ forgotten }) => {
      const lost = forgotten[name]
      return lost ? { forgotten: { ...forgotten, [name]: { ...lost, refused } } } : {}
    })
  }

  /**
   * A change to a memory was refused. The list is read again at once, though a row is being edited, so a memory that
   * moved on shows as it is now and the next Save goes against that. When it did move on, a row with a draft says so in
   * its own words and keeps the draft; one without says to try again. Any other refusal is shown in the host's words.
   */
  const afterRefusal = async (key: string, sentVersion: string | undefined, refused: string) => {
    await store.read()
    const nowVersion = store.memoryNamed(key)?.version
    const movedOn = sentVersion !== undefined && nowVersion !== undefined && nowVersion !== sentVersion
    if (!movedOn) setRefusal(key, refused)
    else if (store.getState().drafts[key]) setRefusal(key, null)
    else setRefusal(key, 'It changed meanwhile, so nothing was saved. It now shows as it is: try again.')
  }

  /** Sends a save of these fields for the row `key`. The draft, if any, closes only once the host keeps it. */
  const sendSave = async (key: string, args: MemorySave): Promise<void> => {
    if (isBusy(key)) return
    if (!args.description) {
      setRefusal(key, 'Write a description first: one line that says what to remember.')
      return
    }

    markBusy(key, true)
    setRefusal(key, null)
    try {
      const answer = answerOf(await send('memory.save', args))
      const refused = refusalIn(answer)
      if (refused !== null && key === NEW_DRAFT) {
        setRefusal(key, refused)
        return
      }
      if (refused !== null) {
        await afterRefusal(key, args.version, refused)
        return
      }
      const memory = memoryIn(answer.memory)
      if (!memory) {
        setRefusal(key, 'hobkin answered without the memory it kept.')
        return
      }

      keepMemory(memory)
      const change = changeIn(answer)
      set(({ drafts, draftFrom, saved }) => ({
        drafts: without(drafts, key),
        draftFrom: without(draftFrom, key),
        saved: change ? { ...saved, [memory.name]: change } : without(saved, memory.name),
      }))
      store.settled()
    } catch (error) {
      setRefusal(key, refusalWords(error))
    } finally {
      markBusy(key, false)
    }
  }

  /** Sends a Right now change, and says whether it went through. Once it has, the list is read again for its new version. */
  const sendNow = async (change: { action: 'add' | 'replace' | 'remove'; item?: string; text?: string }): Promise<boolean> => {
    if (store.getState().nowBusy) return false
    const version = store.getState().list?.nowVersion

    set({ nowBusy: true, nowRefused: null })
    try {
      const refused = refusalIn(answerOf(await send('memory.now.change', { ...change, ...(version ? { version } : {}) })))
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
    async save(key: string): Promise<void> {
      const draft = store.getState().drafts[key]
      if (!draft) return
      if (key === NEW_DRAFT) return sendSave(key, saveOf(draft, undefined))

      const memory = store.memoryNamed(key)
      if (!memory) {
        setRefusal(key, 'That memory is not here any more.')
        return
      }
      return sendSave(key, saveOf(draft, memory))
    },

    /** Make private, or Share with every agent: the memory saved as it is, but for that. */
    async setPrivate(name: string, keepPrivate: boolean): Promise<void> {
      const memory = store.memoryNamed(name)
      if (!memory) return
      return sendSave(name, saveOf({ ...draftOf(memory), private: keepPrivate }, memory))
    },

    /** Keep: a memory another session handed over, saved as it is by the user, so every agent may read it from now on. */
    async keep(name: string): Promise<void> {
      const memory = store.memoryNamed(name)
      if (!memory) return
      return sendSave(name, saveOf(draftOf(memory), memory))
    },

    /** Forgets a memory. Its row stays where it was as one line with Undo until the page is left. */
    async forget(name: string): Promise<void> {
      const memory = store.memoryNamed(name)
      if (!memory || isBusy(name)) return

      markBusy(name, true)
      setRefusal(name, null)
      try {
        const answer = answerOf(await send('memory.forget', { name, ...(memory.version ? { version: memory.version } : {}) }))
        const refused = refusalIn(answer)
        const change = changeIn(answer)
        if (refused !== null || change === null) {
          setRefusal(name, refused ?? 'hobkin answered without a way to bring it back, so nothing is shown as forgotten.')
          return
        }
        set(({ list, forgotten, saved }) => ({
          list: list ? { ...list, memories: list.memories.filter((one) => one.name !== name) } : list,
          forgotten: { ...forgotten, [name]: { entry: memory, change } },
          saved: without(saved, name),
        }))
      } catch (error) {
        setRefusal(name, refusalWords(error))
      } finally {
        markBusy(name, false)
      }
    },

    /** Brings back a memory forgotten on this page, in its place, then reads the list for it as kept. */
    async undoForget(name: string): Promise<void> {
      const lost = store.getState().forgotten[name]
      if (!lost || isBusy(name)) return

      markBusy(name, true)
      try {
        const refused = refusalIn(answerOf(await send('memory.undo', { change: lost.change })))
        if (refused !== null) {
          setForgotten(name, refused)
          return
        }
        set(({ forgotten }) => ({ forgotten: without(forgotten, name) }))
        keepMemory(lost.entry)
        void store.read()
      } catch (error) {
        setForgotten(name, refusalWords(error))
      } finally {
        markBusy(name, false)
      }
    },

    /** Takes back a save made on this page: an added memory goes, a changed one reads as it did. */
    async undoSave(name: string): Promise<void> {
      const change = store.getState().saved[name]
      if (!change || isBusy(name)) return

      markBusy(name, true)
      setRefusal(name, null)
      try {
        const refused = refusalIn(answerOf(await send('memory.undo', { change })))
        if (refused !== null) {
          setRefusal(name, refused)
          return
        }
        set(({ saved }) => ({ saved: without(saved, name) }))
        void store.read()
      } catch (error) {
        setRefusal(name, refusalWords(error))
      } finally {
        markBusy(name, false)
      }
    },

    /** A chat line's Undo: sent once, and the line then says it was undone or why it could not be. */
    async undoLine(change: string): Promise<void> {
      if (store.getState().lines[change]) return
      const record = (undo: LineUndo) => set(({ lines }) => ({ lines: { ...lines, [change]: undo } }))

      record({ state: 'sending' })
      try {
        const refused = refusalIn(answerOf(await send('memory.undo', { change })))
        if (refused !== null) {
          record({ state: 'refused', reason: refused })
          return
        }
        record({ state: 'undone' })
        if (store.getState().open) void store.read()
      } catch (error) {
        record({ state: 'refused', reason: refusalWords(error) })
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

      const change = edit.item === null ? { action: 'add' as const, text } : { action: 'replace' as const, item: edit.item, text }
      if (await sendNow(change)) store.nowCancel()
    },

    /** Removes a Right now line. It stays where it was as one line with Undo until the page is left. */
    async nowRemove(item: string, index: number): Promise<void> {
      if (!(await sendNow({ action: 'remove', item }))) return
      set(({ nowRemoved }) => ({ nowRemoved: [...nowRemoved, { text: item, index }] }))
    },

    /** Puts a removed line back on the list. */
    async nowUndoRemove(text: string): Promise<void> {
      if (!(await sendNow({ action: 'add', text }))) return
      set(({ nowRemoved }) => ({ nowRemoved: nowRemoved.filter((one) => one.text !== text) }))
    },
  }
}

export type MemoryActions = ReturnType<typeof createMemoryActions>
