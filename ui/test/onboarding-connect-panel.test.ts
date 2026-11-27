import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement, useSyncExternalStore, type ReactNode } from 'react'
import type { ProviderAccess } from '../../shared/protocol/models.ts'
import { mountView, passing, readViews, stillMotion } from './view-draws.ts'

const codex: ProviderAccess = { id: 'openai-codex', name: 'OpenAI Codex', signIn: { label: 'Sign in with ChatGPT', subscription: true }, connected: false }
const key: ProviderAccess = { id: 'openai', name: 'OpenAI', apiKey: { label: 'OpenAI API key', env: ['OPENAI_API_KEY'] }, connected: false }

// The providers as the host last said, which a test changes as a sign-in or a key would.
let providers: ProviderAccess[] = [codex, key]
const listeners = new Set<() => void>()
const setProviders = (next: ProviderAccess[]) => {
  providers = next
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The panel's buttons, by their words, the host commands it sent, and each time the keys were drawn, with the ways in they hold.
let presses: Record<string, () => void> = {}
const sent: { name: string; args?: unknown }[] = []
const keysDrawn: (readonly string[] | undefined)[] = []

readViews({
  'components/ui/button.tsx': {
    Button: ({ onClick, children }: { onClick: () => void; children: ReactNode }) => {
      presses[String(children)] = onClick
      return createElement('button', null, children)
    },
  },
  'lib/host/index.ts': {
    runCommand: async (name: string, args?: unknown) => {
      sent.push({ name, args })
    },
    useHost: (pick: (state: { signIn: { status: 'unknown' } }) => unknown) => pick({ signIn: { status: 'unknown' } }),
    useModels: () => ({ providers: useSyncExternalStore(subscribe, () => providers) }),
  },
  'features/signin/ConnectModels.tsx': {
    ConnectModels: ({ routes }: { routes?: readonly string[] }) => {
      keysDrawn.push(routes)
      return null
    },
    SigningIn: passing,
  },
  'motion/react': { motion: stillMotion },
})
const { ConnectPanel } = await import('../src/features/onboarding/ConnectPanel.tsx')

test('the account step has no Not now: the OpenAI sign-in, or an API key, and a provider that connects goes on', async () => {
  let done = 0
  const view = await mountView(() => createElement(ConnectPanel, { onDone: () => (done += 1), still: true }))

  assert.equal(presses['Not now'], undefined, 'hobkin cannot think without an account, so it cannot be put off')
  assert.deepEqual(keysDrawn, [], 'the keys wait for their button')

  await view.change(() => presses['Connect OpenAI (ChatGPT subscription)']!())
  assert.deepEqual(sent, [{ name: 'signin.start', args: { provider: 'openai-codex' } }])

  await view.change(() => presses['Use an API key']!())
  assert.deepEqual(keysDrawn.at(-1), ['apiKey'], "Connect a model's own keys, and only them")

  await view.change(() => setProviders([codex, { ...key, connected: true }]))
  assert.equal(done, 1, 'a key that connects moves the story on')
  await view.unmount()
})

test('where Pi lists no OpenAI sign-in, the keys are the way in and show at once', async () => {
  presses = {}
  keysDrawn.length = 0
  setProviders([key])
  const view = await mountView(() => createElement(ConnectPanel, { onDone() {}, still: true }))

  assert.deepEqual(keysDrawn.at(-1), ['apiKey'])
  assert.equal(presses['Not now'], undefined)
  await view.unmount()
})
