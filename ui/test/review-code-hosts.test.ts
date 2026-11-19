import assert from 'node:assert/strict'
import { test } from 'node:test'
import { learnCodeHosts, targetOfReviewId } from '#shared/review/ids.ts'
import { learnCodeHostsOnConnect } from '../src/features/review/code-hosts.ts'

/** A host link that can be opened and closed, as the window's host store is. */
function link(start: string) {
  let state = { link: start }
  const listeners = new Set<(now: { link: string }, before: { link: string }) => void>()
  return {
    getState: () => state,
    subscribe: (listener: (now: { link: string }, before: { link: string }) => void) => (listeners.add(listener), () => listeners.delete(listener)),
    set: (next: string) => {
      const before = state
      state = { link: next }
      for (const listener of listeners) listener(state, before)
    },
  }
}

test('the window learns the named code hosts each time it reaches the host, so their pull request pages open as reviews', async () => {
  learnCodeHosts([])
  const store = link('connecting')
  let asked = 0
  let hosts = [{ name: 'corp', web: 'https://git.example.invalid' }]
  const stop = learnCodeHostsOnConnect(store, async () => (asked++, { hosts }))
  assert.equal(asked, 0, 'nothing is asked before the host is reached')
  store.set('open')
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(targetOfReviewId('https://git.example.invalid/acme/shop/pull/7'), { kind: 'pull', host: 'corp', owner: 'acme', repo: 'shop', number: 7 })
  // Reached again after a drop, it asks again and learns what the home names now.
  hosts = []
  store.set('closed')
  store.set('open')
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(asked, 2)
  assert.equal(targetOfReviewId('https://git.example.invalid/acme/shop/pull/7'), null)
  stop()
  store.set('closed')
  store.set('open')
  assert.equal(asked, 2, 'stopped, it asks nothing more')
})
