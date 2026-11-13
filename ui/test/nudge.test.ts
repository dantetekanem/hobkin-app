import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { after, mock, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import type { Nudge } from '#shared/protocol/nudge.ts'
import type { HostState } from '../src/lib/host/state.ts'

// nudge.ts reaches other features through the `@/` alias, which node does not know on its own.
const aliasHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context)
    return nextResolve(pathToFileURL(resolve(import.meta.dirname, '../src', specifier.slice(2))).href, context)
  },
})
after(() => aliasHooks.deregister())

// The location store keeps a clock; hold it still while the modules load.
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
after(() => mock.timers.reset())

const { applyNudge, watchNudge } = await import('../src/app/nudge.ts')
const { useView } = await import('../src/app/view-store.ts')
const { useChat } = await import('../src/features/chat/chat-store.ts')

test('a navigation nudge moves the window, and a draft nudge fills the composer without sending', () => {
  applyNudge({ kind: 'open', screen: 'reports' })
  assert.equal(useView.getState().screen, 'reports')

  applyNudge({ kind: 'open', screen: 'github' })
  assert.equal(useView.getState().screen, 'github')

  applyNudge({ kind: 'spotlight' })
  assert.equal(useView.getState().spotlight, true)

  applyNudge({ kind: 'draft', text: 'land the storefront fix' })
  assert.equal(useChat.getState().draft.text, 'land the storefront fix', 'the words land in the draft')
  assert.equal(useChat.getState().outbox.entries.length, 0, 'nothing is sent: sending stays the user\'s')
})

/** A bare host store that only carries what the watcher reads, so the apply-once and reconnect rules can be driven. */
type HostListener = (state: HostState, prev: HostState) => void
function fakeHost() {
  let state = { nudge: null as Nudge | null, epoch: 0 }
  const listeners = new Set<HostListener>()
  return {
    getState: () => state as unknown as HostState,
    subscribe: (listener: HostListener): (() => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    set(next: Partial<typeof state>) {
      state = { ...state, ...next }
      const view = state as unknown as HostState
      for (const listener of [...listeners]) listener(view, view)
    },
  }
}

test('the window carries out each instruction once, and never replays one after a reconnect', () => {
  const host = fakeHost()
  const stop = watchNudge(host)
  after(stop)

  host.set({ nudge: { id: 1, action: { kind: 'open', screen: 'routines' } } })
  assert.equal(useView.getState().screen, 'routines')

  // The same instruction arriving again (its id unchanged) is not carried out a second time.
  useView.getState().openScreen('work')
  host.set({})
  assert.equal(useView.getState().screen, 'work', 'the window stays put: id 1 was already done')

  host.set({ nudge: { id: 2, action: { kind: 'open', screen: 'actions' } } })
  assert.equal(useView.getState().screen, 'actions')

  // A reconnect clears the instruction and restarts its ids, so an id the window saw before is done again.
  host.set({ epoch: 1, nudge: null })
  useView.getState().openScreen('work')
  host.set({ nudge: { id: 1, action: { kind: 'open', screen: 'home' } } })
  assert.equal(useView.getState().screen, 'home', 'after a reconnect, id 1 is a fresh instruction')
})
