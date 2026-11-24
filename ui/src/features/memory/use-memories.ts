import { useEffect } from 'react'
import { useStore } from 'zustand'
import { useView } from '@/app/view-store.ts'
import { hasHost } from '@/lib/host/frame.ts'
import { hostStore, runCommand } from '@/lib/host/index.ts'
import { createMemoryActions, type MemoryActions } from './actions.ts'
import { createSampleHost } from './sample-host.ts'
import { sampleMemoryList } from './sample.ts'
import { createMemoryStore, refusalWords, type MemoryCommand, type MemorySend, type MemoryState, type MemoryStore } from './store.ts'

/**
 * The window's one Memory store (`057-shared-memory`), wired to the host: the page's commands, the snapshot's
 * `memoriesStamp`, and the sample when no host runs. A chat line's Undo and See use it too, so what they did shows on
 * the page and on the line alike.
 */

/**
 * Raised whenever the store's state or its actions change shape. A hot update that finds an older pair makes them afresh
 * (the drafts open in it are lost), so a page drawn by new code never reads state or calls actions the old pair lacks.
 */
const RULES = 2

interface Kept {
  rules?: number
  store: MemoryStore
  actions: MemoryActions
  /** Stops following the host. A pair from before rules had none, and its listener stays until the window reloads. */
  stop?: () => void
}

/**
 * The one way a memory command leaves the window. With no host it goes to the sample, which answers in memory. With
 * one it goes as every other command does, through `runCommand`; the registry types each name once the host has it,
 * so until then the name goes untyped. A running hobkin that does not know the command refuses it by name, and the
 * page says "Not available yet".
 */
function sender(sample: ReturnType<typeof createSampleHost>): MemorySend {
  const command = runCommand as unknown as (name: MemoryCommand, args: object) => Promise<unknown>
  return (name, args) => {
    if (!hasHost(hostStore.getState())) return sample.send(name, args)
    return command(name, args).catch((error: unknown) => {
      throw new Error(refusalWords(error))
    })
  }
}

function make(): Kept {
  const send = sender(createSampleHost(sampleMemoryList()))
  const store = createMemoryStore({ send })
  let live = hasHost(hostStore.getState())
  store.stampSeen(hostStore.getState().snapshot.memoriesStamp)
  const stop = hostStore.subscribe((state) => {
    const now = hasHost(state)
    if (now !== live) {
      live = now
      store.hostChanged()
    }
    store.stampSeen(state.snapshot.memoriesStamp)
  })
  return { rules: RULES, store, actions: createMemoryActions(store, send), stop }
}

// The store, the sample's changes and the host listener are made once and live on globalThis, as the clocks do
// (`lib/clock.ts`): a hot update that runs this file again finds them instead of making a second set beside them.
const holder = globalThis as { __hobkinMemory?: Kept }
if (holder.__hobkinMemory?.rules !== RULES) {
  holder.__hobkinMemory?.stop?.()
  holder.__hobkinMemory = make()
}
const kept = holder.__hobkinMemory

export const memoryStore = kept.store
export const memoryActions = kept.actions

/** A piece of the Memory state. A component draws again only when what it picked changes. */
export function useMemory<Picked>(pick: (state: MemoryState) => Picked): Picked {
  return useStore(kept.store, pick)
}

/** The page is showing: it reads the list, and once it is left, what was forgotten there stops offering Undo. */
export function useMemoryPage(): void {
  useEffect(() => {
    kept.store.opened()
    return () => kept.store.left()
  }, [])
}

/** Opens the Memory page under Settings, on one memory when a name is given, as a chat line's See does. */
export function openMemory(name?: string): void {
  if (name) kept.store.seekMemory(name)
  const view = useView.getState()
  if (view.screen !== 'memory') view.togglePage('memory')
}
