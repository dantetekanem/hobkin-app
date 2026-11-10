import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HostMessage } from '#shared/protocol/messages.ts'
import type { ModelsState, ProviderAccess } from '#shared/protocol/models.ts'
import { availabilityOf } from '../src/features/chat/availability.ts'
import { connectSections, reachSince } from '../src/features/signin/connect.ts'
import { applyHostMessage, canUseModel, initialHostState } from '../src/lib/host/state.ts'

const provider = (id: string, routes: Partial<ProviderAccess>, connected = false): ProviderAccess => ({ id, name: id[0]!.toUpperCase() + id.slice(1), ...routes, connected })

const MODELS: ModelsState = {
  providers: [
    provider('zeta', { apiKey: { label: 'Zeta API key', env: ['ZETA_API_KEY'] } }),
    provider('openrouter', { signIn: { label: 'Sign in with OpenRouter', subscription: false }, apiKey: { label: 'OpenRouter API key', env: ['OPENROUTER_API_KEY'] } }),
    provider('openai', { signIn: { label: 'Sign in with ChatGPT', subscription: true }, apiKey: { label: 'OpenAI API key', env: ['OPENAI_API_KEY'] } }, true),
    provider('anthropic', { signIn: { label: 'Anthropic (Claude Pro/Max)', subscription: true }, apiKey: { label: 'Anthropic API key', env: ['ANTHROPIC_API_KEY'] } }),
    provider('alpha', { apiKey: { label: 'Alpha API key', env: ['ALPHA_API_KEY'] } }, true),
    provider('bedrock', { cloud: { label: 'An AWS profile' } }),
  ],
  models: [{ id: 'gpt', provider: 'openai', name: 'GPT', thinking: ['low'], contextWindow: 1000 }],
}

test('sign-ins come first, then keys, then cloud credentials', () => {
  const sections = connectSections(MODELS)
  const ids = (key: 'signIn' | 'apiKey' | 'cloud') => sections.find((section) => section.key === key)?.providers.map(({ id }) => id)

  assert.deepEqual(sections.map(({ key }) => key), ['signIn', 'apiKey', 'cloud'])
  // Subscriptions before other sign-ins, then by name. A provider with two routes is in both lists.
  assert.deepEqual(ids('signIn'), ['anthropic', 'openai', 'openrouter'])
  // Keys already connected first, then by name.
  assert.deepEqual(ids('apiKey'), ['alpha', 'openai', 'anthropic', 'openrouter', 'zeta'])
  assert.deepEqual(ids('cloud'), ['bedrock'])
  // Each row says whether it is connected.
  assert.deepEqual(sections[0]!.providers.map(({ connected }) => connected), [false, true, false])

  // An empty route has no section at all.
  assert.deepEqual(connectSections({ providers: [MODELS.providers[2]!], models: [] }).map(({ key }) => key), ['signIn', 'apiKey'])
  assert.deepEqual(connectSections({ providers: [], models: [] }), [])
})

test('a page holding the provider list hears of each provider that connects, and of the first usable model', () => {
  const none: ModelsState = { providers: MODELS.providers.map((entry) => ({ ...entry, connected: false })), models: [] }
  // The first list the host gives is where things stand. Nothing in it is news.
  const first = reachSince(null, MODELS, true)
  assert.deepEqual([first.connected, first.ready], [[], false])
  const quiet = reachSince(reachSince(null, none, false).seen, none, false)
  assert.deepEqual([quiet.connected, quiet.ready], [[], false])

  // A sign-in, a key or a terminal connects one provider: it is news once, and so is the model that came with it.
  const signedIn: ModelsState = { ...none, providers: none.providers.map((entry) => (entry.id === 'anthropic' ? { ...entry, connected: true } : entry)) }
  const after = reachSince(reachSince(null, none, false).seen, signedIn, true)
  assert.deepEqual(after.connected.map(({ id }) => id), ['anthropic'])
  assert.equal(after.ready, true)
  const again = reachSince(after.seen, signedIn, true)
  assert.deepEqual([again.connected, again.ready], [[], false])

  // Signing out and back in is news again.
  const back = reachSince(reachSince(again.seen, none, false).seen, signedIn, true)
  assert.deepEqual([back.connected.map(({ id }) => id), back.ready], [['anthropic'], true])
})

test('the conversation waits for a model, whichever provider it comes from', () => {
  const hello = (models: ModelsState | null, signIn: HostMessage & { type: 'hello' } extends { signIn: infer S } ? S : never): HostMessage => ({
    type: 'hello',
    protocol: 1,
    home: '/home',
    model: 'live',
    owner: { state: 'live', limits: { images: 4, imageBytes: 1 } },
    signIn,
    models,
    viewState: null,
  })
  const none = applyHostMessage(initialHostState, hello({ ...MODELS, models: [] }, { status: 'signed-out' }))
  assert.equal(canUseModel(none), false)
  assert.deepEqual(availabilityOf(none), { ready: false, reason: 'Connect a model to talk to hobkin.' })

  // A second provider's sign-in takes nothing away while the first still answers.
  const second = applyHostMessage(initialHostState, hello(MODELS, { status: 'signing-in', provider: 'anthropic', lines: [] }))
  assert.equal(canUseModel(second), true)
  assert.deepEqual(availabilityOf(second), { ready: true })

  // The slice follows the host's state messages.
  const after = applyHostMessage(second, { type: 'state', rev: 1, models: { ...MODELS, models: [] }, signIn: { status: 'signed-out' } })
  assert.equal(canUseModel(after), false)

  // A host too old to send the slice still says whether a model answers.
  assert.equal(canUseModel(applyHostMessage(initialHostState, hello(null, { status: 'signed-in' }))), true)
  assert.equal(canUseModel(applyHostMessage(initialHostState, hello(null, { status: 'signed-out' }))), false)
})
