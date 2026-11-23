import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { initialHostState, type HostState } from '../src/lib/host/state.ts'

const live = (snapshot: HostState['snapshot'], epoch = 1): HostState => ({
  ...initialHostState,
  home: '/isolated',
  link: 'open',
  owner: { state: 'live', limits: { images: 4, imageBytes: 1 } },
  snapshot,
  epoch,
})

test('what hobkin kept of the words it never read goes into the input once it is open, and a new connection does not add it again', async () => {
  const aliases = registerHooks({ resolve(specifier, context, next) { return next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) } })
  try {
    const { useChat } = await import('../src/features/chat/chat-store.ts')
    const { hostStore } = await import('../src/lib/host/client.ts')
    try {
      useChat.setState({ draft: { ...useChat.getState().draft, text: 'half a thought' } })
      const words = [{ id: 'u1', text: 'Check the budget' }]

      hostStore.setState({ ...initialHostState, snapshot: { unread: words } }, true)
      assert.equal(useChat.getState().draft.text, 'half a thought', 'not before hobkin is open')

      hostStore.setState(live({ unread: words }), true)
      assert.equal(useChat.getState().draft.text, 'Check the budget\n\nhalf a thought')

      hostStore.setState(live({ unread: [...words] }, 2), true)
      assert.equal(useChat.getState().draft.text, 'Check the budget\n\nhalf a thought')
    } finally {
      hostStore.setState(initialHostState, true)
    }
  } finally {
    aliases.deregister()
  }
})
