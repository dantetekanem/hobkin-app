import type { StoreApi } from 'zustand/vanilla'
import type { WatchMessage } from '#shared/protocol/messages.ts'
import type { HostState } from './state.ts'

/**
 * The jobs whose whole steps the window shows now, each held by what shows it, such as an agent's page while it is
 * mounted. A host that takes watching sends every other job as its tail: its newest entry and newest words.
 */
export class Watched {
  private readonly holds = new Map<string, number>()
  private readonly listeners = new Set<() => void>()

  /** Holds `job` watched until the function it returns lets go. */
  hold(job: string): () => void {
    const count = (this.holds.get(job) ?? 0) + 1
    this.holds.set(job, count)
    if (count === 1) this.changed()

    let held = true
    return () => {
      if (!held) return
      held = false
      const left = this.holds.get(job)! - 1
      if (left > 0) return void this.holds.set(job, left)
      this.holds.delete(job)
      this.changed()
    }
  }

  jobs(): string[] {
    return [...this.holds.keys()].sort()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}

/**
 * Tells the host which jobs the window watches: after every hello that says it takes `watch`, so again after a
 * reconnect, and whenever the set changes while it does. A host from before never hears it: it closes the socket on a
 * message it does not know.
 */
export function followWatching(store: Pick<StoreApi<HostState>, 'getState' | 'subscribe'>, watched: Watched, send: (message: WatchMessage) => void): () => void {
  const tell = () => send({ type: 'watch', jobs: watched.jobs() })
  const stopHello = store.subscribe((state, previous) => {
    if (state.watching && !previous.watching) tell()
  })
  const stopChanges = watched.subscribe(() => {
    if (store.getState().watching) tell()
  })
  return () => {
    stopHello()
    stopChanges()
  }
}
