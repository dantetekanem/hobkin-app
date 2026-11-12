import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { HostConnection } from '../src/lib/host/connection.ts'
import type { HostMessage } from '#shared/protocol/messages.ts'
import type { ModelsState, ProviderAccess } from '#shared/protocol/models.ts'
import * as availability from '../src/features/chat/availability.ts'
import { connectSections, reachSince } from '../src/features/signin/connect.ts'
import { applyHostMessage, canUseModel, initialHostState, type HostState } from '../src/lib/host/state.ts'

const { availabilityOf } = availability
const stopControls = { home: '/home', epoch: 'owner:1', targets: [{ kind: 'main' as const, runId: 'turn:1', parentId: null, rootId: 'turn:1', label: 'hobkin', canStop: true, canForce: true }] }
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

test('model loss keeps Stop and agent canvases available without allowing a message', () => {
  const state: HostState = { ...initialHostState, home: '/home', link: 'open', owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, snapshot: { busy: true, stopControls }, models: { ...MODELS, models: [] }, signIn: { status: 'signed-out' } }
  assert.equal(availabilityOf(state).ready, false)
  assert.equal(availability.canStopConversation(state), true)
  const signingIn: HostState['signIn'] = { status: 'signing-in', provider: 'openai', lines: [] }
  for (const signIn of [state.signIn, signingIn]) {
    const duringSignIn = { ...state, signIn }
    assert.equal(availabilityOf(duringSignIn).ready, false)
    assert.equal(availability.canStopConversation(duringSignIn), true)
    for (const screen of ['agent', 'mind', 'work', 'world'] as const) assert.equal(availability.needsSignInCanvas(duringSignIn, screen), false)
    assert.equal(availability.needsSignInCanvas(duringSignIn, 'home'), true)
  }
  assert.equal(availability.canStopConversation({ ...state, snapshot: { busy: false, stopControls } }), true)
  assert.equal(availability.canStopConversation({ ...state, snapshot: { busy: false, stopControls: { ...stopControls, targets: [] } } }), false)
  assert.equal(availability.canStopConversation({ ...state, link: 'lost' }), false)
  assert.equal(availability.canStopConversation({ ...state, home: null }), false)
  assert.equal(availability.canStopConversation({ ...state, owner: null }), false)
})

test('Stop dispatches without a model and reports a disconnected refusal', { timeout: 2000 }, async (t) => {
  const aliases = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context)
  } })
  try {
    const { useChat } = await import('../src/features/chat/chat-store.ts')
    const { hostStore } = await import('../src/lib/host/client.ts')
    hostStore.setState({ ...initialHostState, home: '/isolated', link: 'open', owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, models: { ...MODELS, models: [] }, signIn: { status: 'signed-out' }, snapshot: { busy: true, stopControls: { ...stopControls, home: '/isolated' } } }, true)
    const calls: string[] = []
    t.mock.method(HostConnection.prototype, 'command', async (name: string, args: unknown) => {
      calls.push(name)
      if (hostStore.getState().link !== 'open') throw Error('Disconnected')
      return { ...(args as object), stop: { status: 'unknown' }, closure: { status: 'unsupported' }, descendants: { status: 'unknown', agents: [], cleanupScope: 'none', detachedCleanup: 'unknown' }, queueRecovery: { status: 'unknown' } }
    })
    useChat.setState({ problem: null })
    assert.equal(availabilityOf(hostStore.getState()).ready, false)
    assert.equal(availability.canStopConversation(hostStore.getState()), true)
    useChat.getState().stop()
    await new Promise<void>((done) => setImmediate(done))
    assert.deepEqual(calls, ['execution.stop'])
    assert.equal(useChat.getState().problem, null)
    hostStore.setState({ link: 'lost' })
    useChat.getState().stop()
    await new Promise<void>((done) => setImmediate(done))
    assert.equal(useChat.getState().problem, 'Not stopped: No live conversation control.')
    assert.deepEqual(calls, ['execution.stop'])
  } finally { aliases.deregister() }
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
