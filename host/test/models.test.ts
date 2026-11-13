import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { COMMANDS } from '#shared/commands/registry.ts'
import type { ModelsState } from '#shared/protocol/models.ts'
import type { SignInState } from '#shared/protocol/signin.ts'
import type { PiAuthInteraction } from '../src/pi.ts'
import { afterTest, Client, FAKE_SECRETS, fakeModelAccess, hostFor, type FakeAccessOptions, type View } from './support.ts'
import type { HostTiers } from '#shared/tiers/tiers.ts'

const AUTH_URL = 'https://auth.example.test/authorize?state=public-state'

async function modelsHost(t: TestContext, options: FakeAccessOptions = {}) {
  const pi = fakeModelAccess(options)
  const opened: string[] = []
  const log: string[] = []
  const host = await hostFor(t, { access: async () => pi.access, openUrl: (url) => void opened.push(url), log: (line) => void log.push(line) })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  const models = () => client.until((view) => view.models, 'the models slice')
  return { ...pi, host, client, opened, log, models }
}

const connected = (view: View) => Object.fromEntries((view.models?.providers ?? []).map(({ id, connected: on }) => [id, on]))
const status = (view: View) => view.signIn?.status

/** A sign-in that shows its page and waits until the test approves it. */
function waitingFlow() {
  let approve = () => {}
  const approved = new Promise<void>((resolve) => (approve = resolve))
  const flow = async (_provider: string, interaction: PiAuthInteraction) => {
    interaction.notify({ type: 'auth_url', url: AUTH_URL })
    await Promise.race([approved, new Promise<never>((_, reject) => interaction.signal?.addEventListener('abort', () => reject(Error('Login cancelled'))))])
  }
  return { flow, approve: () => approve() }
}

test('lists every provider and the models Pi can use, and follows auth changes', async (t) => {
  const pi = await modelsHost(t)
  const first = await pi.models()

  // Every provider, with the ways it connects and a connected flag, and nothing else about its credential.
  assert.deepEqual(first.models?.providers, [
    {
      id: 'anthropic',
      name: 'Anthropic',
      signIn: { label: 'Anthropic (Claude Pro/Max)', subscription: true },
      apiKey: { label: 'Anthropic API key', env: ['ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN'] },
      connected: false,
    },
    { id: 'openai', name: 'OpenAI', signIn: { label: 'Sign in with ChatGPT', subscription: true }, apiKey: { label: 'OpenAI API key', env: ['OPENAI_API_KEY'] }, connected: false },
    { id: 'google', name: 'Google', apiKey: { label: 'Gemini API key', env: ['GEMINI_API_KEY'] }, connected: false },
    { id: 'amazon-bedrock', name: 'Amazon Bedrock', cloud: { label: 'An AWS profile, access keys or a Bedrock bearer token' }, connected: false },
  ])
  assert.deepEqual(first.models?.models, [])
  assert.equal(status(first), 'signed-out', 'with no model the app asks to connect one')

  // A sign-in changes the slice at once: the provider is connected and its models are there to pick.
  await pi.client.run('signin.start', { provider: 'openai' })
  const signedIn = await pi.client.until((view) => connected(view).openai && status(view) === 'signed-in', 'openai to connect')
  assert.deepEqual(signedIn.models?.models, [
    { id: 'gpt-test', provider: 'openai', name: 'GPT Test', thinking: ['off', 'low', 'medium', 'high', 'xhigh'], contextWindow: 400000 },
    { id: 'gpt-test-mini', provider: 'openai', name: 'GPT Test Mini', thinking: ['off'], contextWindow: null },
  ])
  assert.deepEqual(await pi.client.run<ModelsState>('models.list'), signedIn.models, 'the command says what the state says')

  // A change made outside the app, such as a key set in a terminal, shows once the window comes back into focus.
  pi.reachable.add('google')
  pi.client.send({ type: 'presence', focused: false, typing: false })
  pi.client.send({ type: 'presence', focused: true, typing: false })
  const refreshed = await pi.client.until((view) => connected(view).google, 'google to show connected')
  assert.deepEqual(refreshed.models?.models.map(({ provider, id }) => `${provider}/${id}`), ['openai/gpt-test', 'openai/gpt-test-mini', 'google/gemini-test'])

  // Signing out is a change too.
  await pi.client.run('signin.out', { provider: 'openai' })
  await pi.client.until((view) => !connected(view).openai && view.models?.models.every(({ provider }) => provider !== 'openai'), 'openai to go')
  assert.equal(status(pi.client.view), 'signed-in', 'google still answers')
})

test('signs in to any provider with a sign-in and refuses one without', async (t) => {
  const waiting = waitingFlow()
  const pi = await modelsHost(t, { flow: waiting.flow })
  await pi.models()

  // Anthropic, not only OpenAI: Pi's own flow runs, and its page opens in the browser.
  assert.deepEqual(await pi.client.run('signin.start', { provider: 'anthropic' }), { ok: true })
  const under = await pi.client.until((view) => view.signIn?.status === 'signing-in' && view.signIn.authUrl, 'the page to approve')
  assert.deepEqual([(under.signIn as Extract<SignInState, { status: 'signing-in' }>).provider, (under.signIn as Extract<SignInState, { status: 'signing-in' }>).authUrl], ['anthropic', AUTH_URL])
  assert.deepEqual(pi.opened, [AUTH_URL])
  assert.deepEqual(pi.logins, ['anthropic'])

  waiting.approve()
  await pi.client.until((view) => connected(view).anthropic && status(view) === 'signed-in', 'anthropic to connect')

  // A provider without a sign-in is told what to do instead, and Pi is never asked.
  const google = await pi.client.command('signin.start', { provider: 'google' })
  assert.equal(!google.ok && google.error.code, 'unavailable')
  assert.match(!google.ok ? google.error.message : '', /Google has no sign-in\. It takes an API key: GEMINI_API_KEY/)
  const bedrock = await pi.client.command('signin.start', { provider: 'amazon-bedrock' })
  assert.match(!bedrock.ok ? bedrock.error.message : '', /cloud credentials/)
  const unknown = await pi.client.command('signin.start', { provider: 'nobody' })
  assert.match(!unknown.ok ? unknown.error.message : '', /Pi has no provider named nobody/)
  const unnamed = await pi.client.command('signin.start', {})
  assert.equal(!unnamed.ok && unnamed.error.code, 'invalid-arguments')
  assert.deepEqual(pi.logins, ['anthropic'])
})

test('no command takes a key, and the keychain line goes through Pi on a yes', async (t) => {
  // Not one command has an argument that could carry a key.
  const keyish = /key|token|secret|password|credential/i
  for (const [name, command] of Object.entries(COMMANDS)) {
    const properties = Object.keys((command.args as { properties?: object }).properties ?? {})
    assert.deepEqual(properties.filter((property) => keyish.test(property)), [], name)
  }

  const pi = await modelsHost(t, { stored: ['openai'] })
  await pi.models()

  // What to do instead of typing the key here: the variable Pi reads, or the Keychain.
  assert.deepEqual(await pi.client.run('models.key-help', { provider: 'anthropic' }), {
    provider: 'anthropic',
    label: 'Anthropic API key',
    env: 'ANTHROPIC_API_KEY',
    keychain: {
      store: `security add-generic-password -a "$USER" -s 'pi-anthropic' -U -w`,
      line: `!security find-generic-password -ws 'pi-anthropic'`,
    },
    note: null,
    connected: false,
  })
  const bedrock = await pi.client.run<{ env: string | null; keychain: unknown; note: string | null }>('models.key-help', { provider: 'amazon-bedrock' })
  assert.deepEqual([bedrock.env, bedrock.keychain], [null, null])
  assert.match(bedrock.note ?? '', /AWS_PROFILE/)

  // On the user's yes, the line goes into Pi's auth.json through Pi itself, and nothing else does.
  assert.deepEqual(await pi.client.run('models.keychain', { provider: 'anthropic' }), { ok: true, connected: true })
  assert.deepEqual(pi.keyCommands, [{ provider: 'anthropic', command: `!security find-generic-password -ws 'pi-anthropic'` }])
  await pi.client.until((view) => connected(view).anthropic, 'anthropic to connect through the Keychain')

  // Pi keeps one credential for each provider, so a line that would replace a sign-in is refused.
  const replacing = await pi.client.command('models.keychain', { provider: 'openai' })
  assert.equal(!replacing.ok && replacing.error.code, 'unavailable')
  assert.match(!replacing.ok ? replacing.error.message : '', /already holds a credential for OpenAI\. Sign out of it first/)
  const noKey = await pi.client.command('models.keychain', { provider: 'amazon-bedrock' })
  assert.match(!noKey.ok ? noKey.error.message : '', /does not take an API key/)
  assert.equal(pi.keyCommands.length, 1)

  // A sign-in that asks for a secret is stopped there: no key is ever asked for through the app.
  const asksSecret = await modelsHost(t, {
    flow: async (_provider, interaction) => {
      await interaction.prompt({ type: 'secret', message: 'Enter the key' })
    },
  })
  await asksSecret.models()
  await asksSecret.client.run('signin.start', { provider: 'openai' })
  const refused = await asksSecret.client.until((view) => view.signIn?.status === 'signed-out' && view.signIn.problem, 'the refusal')
  assert.match((refused.signIn as Extract<SignInState, { status: 'signed-out' }>).problem?.message ?? '', /asked for a secret.*\/login openai/)
  assert.equal(asksSecret.client.received.some((message) => JSON.stringify(message).includes('"kind":"secret"')), false)

  // Nothing Pi holds reaches the UI or the log.
  const said = [JSON.stringify(pi.client.received), pi.log.join('\n')].join('\n')
  for (const secret of Object.values(FAKE_SECRETS)) assert.equal(said.includes(secret), false, secret)
})

test('sign out removes the credential and says when pi still reaches the provider', async (t) => {
  const pi = await modelsHost(t, { stored: ['anthropic', 'google'], ambient: ['google'] })
  await pi.models()

  assert.deepEqual(await pi.client.run('signin.out', { provider: 'anthropic' }), { ok: true, stillConnected: false, message: 'Signed out of Anthropic.' })
  assert.equal(pi.store.has('anthropic'), false)

  // Pi still reaches Google through its environment variable, which sign-out cannot touch.
  const google = await pi.client.run<{ stillConnected: boolean; message: string }>('signin.out', { provider: 'google' })
  assert.equal(pi.store.has('google'), false)
  assert.equal(google.stillConnected, true)
  assert.match(google.message, /Pi still reaches Google.*GEMINI_API_KEY/)
  await pi.client.until((view) => !connected(view).anthropic && connected(view).google, 'the slice to follow')
})

test('hobkin starts a sign-in from the conversation through the client tool', async (t) => {
  const { createClientTool } = await import('../src/client-tool.ts')

  // The tool offers hobkin the commands it may run, and nothing that changes Pi's setup without the user.
  const ran: [string, unknown][] = []
  const tool = createClientTool({ run: async (name, args) => (ran.push([name, args]), { ok: true, value: { ok: true } }) })
  const listed = JSON.parse((await tool.execute('call-1', { action: 'list' })).content[0]!.text) as { name: string }[]
  assert.deepEqual(listed.map(({ name }) => name).sort(), [
    'app.refresh', 'app.state', 'appearance.set', 'canvas.close', 'canvas.show', 'models.key-help', 'models.list',
    'review.code', 'review.list', 'review.map', 'review.note', 'review.prepare', 'review.remove', 'review.show', 'review.status', 'review.stop',
    'signin.cancel', 'signin.start', 'tiers.read',
  ])
  const described = JSON.parse((await tool.execute('call-2', { action: 'describe', name: 'signin.start' })).content[0]!.text)
  assert.equal(described.name, 'signin.start')
  assert.deepEqual(Object.keys(described.args.properties), ['provider'])
  for (const name of ['signin.out', 'models.keychain', 'models.select', 'conversation.send']) {
    await assert.rejects(tool.execute('call-3', { action: 'run', name, args: {} }), /hobkin cannot run|needs the user/)
  }
  assert.deepEqual(ran, [])

  // In the conversation: the words reach the model, the model calls the tool, and the sign-in opens in the window.
  const waiting = waitingFlow()
  const pi = await modelsHost(t, { stored: ['openai'], flow: waiting.flow })
  await pi.client.live()
  await pi.client.run('conversation.send', { text: 'Connect my Claude subscription' })
  const started = await pi.client.until((view) => view.signIn?.status === 'signing-in', 'the sign-in hobkin started')
  assert.equal((started.signIn as Extract<SignInState, { status: 'signing-in' }>).provider, 'anthropic')
  assert.ok(started.turns.some(({ event }) => event.kind === 'tool-start' && event.name === 'client'), 'it went through the client tool')

  const replied = await pi.client.until((view) => view.snapshot.busy === false && view.messages.at(-1)?.role === 'assistant', 'the reply')
  assert.match(replied.messages.at(-1)?.content ?? '', /started the Anthropic sign-in/i)
  waiting.approve()
  await pi.client.until((view) => connected(view).anthropic, 'anthropic to connect')
})

test('the scripted host lists scripted providers and signs in without an account', async (t) => {
  const { SCRIPTED_SIGN_IN_PAGE, scriptedModelAccess } = await import('../src/scripted-access.ts')
  // No test may reach a real browser. What the host would open is written down here instead.
  const opened: string[] = []
  const host = await hostFor(t, { access: async () => scriptedModelAccess(), openUrl: (url) => void opened.push(url) })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  const view = await client.until((now) => now.models, 'the scripted models')

  // Pi's own providers, names and models, with one connected and the rest not.
  const providers = view.models!.providers
  assert.deepEqual(providers.filter(({ connected: on }) => on).map(({ id }) => id), ['openai'])
  assert.ok(providers.length >= 4)
  for (const id of ['anthropic', 'openai', 'google', 'amazon-bedrock']) assert.ok(providers.some((provider) => provider.id === id), id)
  assert.ok(providers.find(({ id }) => id === 'anthropic')?.signIn?.subscription)
  assert.ok(providers.find(({ id }) => id === 'amazon-bedrock')?.cloud)
  assert.ok(view.models!.models.length > 0)
  assert.ok(view.models!.models.every(({ provider, thinking }) => provider === 'openai' && thinking.length > 0))
  // Pi's own default model for a provider is one of its models.
  const openaiDefault = providers.find(({ id }) => id === 'openai')?.defaultModel
  assert.ok(view.models!.models.some(({ id }) => id === openaiDefault), `OpenAI's default ${openaiDefault}`)
  assert.equal(view.signIn?.status, 'signed-in')

  // Its sign-in asks for "ok", and then the provider is connected.
  await client.run('signin.start', { provider: 'anthropic' })
  const asked = await client.until((now) => now.signIn?.status === 'signing-in' && now.signIn.prompt, 'the scripted prompt')
  await client.run('signin.answer', { prompt: (asked.signIn as Extract<SignInState, { status: 'signing-in' }>).prompt!.id, value: 'ok' })
  await client.until((now) => connected(now).anthropic, 'anthropic to connect')
  // Its page is an address that never resolves, never one of hobkin's.
  assert.deepEqual(opened, [SCRIPTED_SIGN_IN_PAGE])
  assert.equal(new URL(SCRIPTED_SIGN_IN_PAGE).hostname.endsWith('.invalid'), true)

  // Signed out, nothing is connected and the app asks for a model.
  const empty = await hostFor(t, { access: async () => scriptedModelAccess({ connected: [] }), openUrl: (url) => void opened.push(url) })
  const second = await Client.connect(empty)
  afterTest(t, () => second.close())
  const none = await second.until((now) => now.models && now.signIn?.status === 'signed-out', 'nothing connected')
  assert.deepEqual(none.models?.models, [])
})

test('the scripted host chooses no model, so nothing it has to offer reaches the home', async (t) => {
  const pi = await modelsHost(t, { stored: ['openai'] })
  await pi.client.live()
  const refused = await pi.client.command('models.select', { model: 'openai/gpt-test' })
  assert.equal(!refused.ok && refused.error.code, 'unavailable')
  assert.match(!refused.ok ? refused.error.message : '', /scripted model.*--live/)
  const { loadConfig } = await import('hobkin/src/cli/config.mjs')
  assert.equal(loadConfig(pi.host.root).main.model, null)

  // The same for hobkin's tiers: they are read as its config.json holds them, and the scripted host saves none.
  const tiers = await pi.client.run<HostTiers>('tiers.read', {})
  assert.deepEqual(tiers.review, { reviewer: 'high', quick: 'fast' })
  assert.deepEqual(Object.keys(tiers.tiers), ['fast', 'mid', 'high', 'max'])
  assert.deepEqual([tiers.tiers.fast.follows, tiers.tiers.high.follows], ['background', 'main'])
  const unsaved = await pi.client.command('tiers.apply', { review: { reviewer: 'max' } })
  assert.match(!unsaved.ok ? unsaved.error.message : '', /scripted model.*--live/)
  const empty = await pi.client.command('tiers.apply', {})
  assert.match(!empty.ok ? empty.error.message : '', /need a tier or a review tier to save/)
  const unknown = await pi.client.command('tiers.apply', { review: { reviewer: 'huge' } })
  assert.equal(!unknown.ok && unknown.error.code, 'invalid-arguments')
  assert.equal(loadConfig(pi.host.root).review, undefined)
})

test('a busy callback port becomes a retryable problem that names the port', async (t) => {
  const failures = [
    'Port 1455 is in use, probably by an unfinished login in another pi session or by the Codex CLI. Cancel that login and try again.',
    'listen EADDRINUSE: address already in use 127.0.0.1:53692',
  ]
  const pi = await modelsHost(t, {
    flow: async () => {
      const failure = failures.shift()
      if (failure) throw Error(failure)
    },
  })
  await pi.models()
  const problem = async () => {
    const view = await pi.client.until((now) => now.signIn?.status === 'signed-out' && now.signIn.problem, 'the problem')
    return (view.signIn as Extract<SignInState, { status: 'signed-out' }>).problem!
  }

  await pi.client.run('signin.start', { provider: 'openai' })
  const openai = await problem()
  assert.deepEqual([openai.code, openai.port, openai.provider], ['port-busy', 1455, 'openai'])
  assert.match(openai.message, /Port 1455 is busy.*Codex CLI/)

  await pi.client.run('signin.start', { provider: 'anthropic' })
  await pi.client.until((now) => now.signIn?.status === 'signed-out' && now.signIn.problem?.provider === 'anthropic', 'the second problem')
  const anthropic = await problem()
  assert.deepEqual([anthropic.code, anthropic.port], ['port-busy', 53692])
  assert.match(anthropic.message, /Port 53692 is busy.*another sign-in/)

  // Try again is the same command, and once the port is free it works.
  await pi.client.run('signin.start', { provider: 'anthropic' })
  await pi.client.until((now) => connected(now).anthropic && now.signIn?.status === 'signed-in', 'anthropic to connect')
})
