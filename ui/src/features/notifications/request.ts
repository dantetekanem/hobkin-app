import type { PendingQuestion } from '../../../../shared/protocol/question.ts'
import type { WaitingRow } from '../actions/items.ts'

/** Only current authoritative host facts; decisions are already-filtered open rows. */
export interface RequestFacts {
  home: string
  generation: number
  ready: boolean
  question: PendingQuestion | null
  decisions: readonly Pick<WaitingRow, 'id' | 'answers' | 'opens'>[]
}
interface Options {
  facts(): RequestFacts
  storage: Pick<Storage, 'getItem' | 'setItem'>
  adapter: {
    available(): boolean
    permission(): Promise<boolean>
    listen(click: (id: string) => Promise<void>): Promise<() => void>
    /** True means dispatch accepted, never confirmed OS delivery. Must not request permission. */
    send(notice: { id: string; title: string; body: string }): Promise<boolean>
  }
  show(): Promise<void>
  focus(): Promise<void>
  reveal(id: string): void
}

export function createRequestNotifications(options: Options) {
  const inflight = new Set<string>(), dispatched = new Set<string>()
  const targets = new Map<string, { home: string; generation: number; id: string }>()
  let disposed = false, listener: Promise<() => void> | undefined
  const ids = (facts: RequestFacts) => new Set([
    ...(facts.question ? [facts.question.id] : []),
    ...facts.decisions.filter((row) => row.answers?.by === 'decision' && !row.opens).map((row) => row.answers!.id),
  ])
  const current = (target: { home: string; generation: number; id: string }) => {
    const facts = options.facts()
    return !disposed && facts.ready && facts.home === target.home && facts.generation === target.generation && ids(facts).has(target.id)
  }
  const click = async (key: string) => {
    const target = targets.get(key)
    if (!target || !current(target)) return
    try {
      await options.show(); if (!current(target)) return
      await options.focus(); if (!current(target)) return
      options.reveal(target.id)
    } catch { /* An unavailable window cannot open a request. */ }
  }
  const notify = async (facts: RequestFacts, id: string) => {
    const key = JSON.stringify([facts.home, id]), saved = `hobkin:request:${key}`
    const target = { home: facts.home, generation: facts.generation, id }
    if (inflight.has(key) || !current(target)) return
    inflight.add(key)
    try {
      let persisted = false
      try {
        persisted = !!options.storage.getItem(saved)
      } catch {
        // Storage failures must not block an otherwise authorized notification.
      }
      if (!options.adapter.available()) return
      const alreadyDispatched = dispatched.has(key) || persisted
      if ((!alreadyDispatched && !await options.adapter.permission()) || !current(target)) return
      listener ??= options.adapter.listen(click).catch((error) => { listener = undefined; throw error })
      await listener; if (!current(target)) return
      targets.set(key, target)
      if (alreadyDispatched) return
      if (!await options.adapter.send({ id: key, title: 'hobkin', body: 'Your input is needed.' }) || !current(target)) {
        targets.delete(key); return
      }
      dispatched.add(key)
      try {
        options.storage.setItem(saved, 'dispatched')
      } catch {
        // Do not undo an accepted notification when optional storage is unavailable.
      }
    } catch { targets.delete(key) }
    finally { inflight.delete(key) }
  }
  return {
    async refresh() {
      const facts = options.facts()
      if (!facts.ready || disposed) return
      await Promise.all([...ids(facts)].map((id) => notify(facts, id)))
    },
    dispose() {
      if (disposed) return
      disposed = true; targets.clear()
      if (listener) void listener.then((remove) => remove()).catch(() => {})
    },
  }
}
