import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { SignInState } from '#shared/protocol/signin.ts'
import type { PiAuthInteraction } from '../src/pi.ts'
import { withoutSecrets } from '../src/signin.ts'
import { afterTest, Client, FAKE_SECRETS, fakeModelAccess, hostFor, type FakeAccessOptions, type View } from './support.ts'

const AUTH_URL = 'https://auth.openai.example/authorize?client_id=pi&state=public-state'
const REDIRECT = 'http://127.0.0.1:1455/auth/callback?code=SECRET-AUTH-CODE&state=public-state'

async function signInHost(t: TestContext, options: FakeAccessOptions = {}) {
  const pi = fakeModelAccess(options)
  const opened: string[] = []
  const log: string[] = []
  const host = await hostFor(t, { access: async () => pi.access, openUrl: (url) => void opened.push(url), log: (line) => void log.push(line) })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  const status = (wanted: SignInState['status']) => client.until((view) => view.signIn?.status === wanted, `sign-in to be ${wanted}`)
  return { ...pi, client, opened, log, status }
}

const signingIn = (view: View) => view.signIn as Extract<SignInState, { status: 'signing-in' }>

/** A flow that shows the page to approve on, then waits for the browser's answer or a pasted address, as Pi's ChatGPT sign-in does. */
function browserFlow() {
  let approve = () => {}
  const approved = new Promise<void>((resolve) => (approve = resolve))
  const pasted: string[] = []
  const flow = async (_provider: string, interaction: PiAuthInteraction) => {
    interaction.notify({ type: 'auth_url', url: AUTH_URL, instructions: 'Complete sign-in in your browser.' })
    const closePrompt = new AbortController()
    const manual = interaction.prompt({
      type: 'manual_code',
      message: 'Complete login in your browser, or paste the final redirect URL here:',
      placeholder: 'http://127.0.0.1:1455/auth/callback',
      signal: AbortSignal.any([closePrompt.signal, interaction.signal!]),
    })
    try {
      const answer = await Promise.race([approved.then(() => 'browser'), manual])
      if (answer !== 'browser') pasted.push(answer)
      interaction.notify({ type: 'progress', message: 'Exchanging authorization code for tokens...' })
    } catch (error) {
      if (interaction.signal?.aborted) throw Error('Login cancelled')
      throw error
    } finally {
      closePrompt.abort()
      manual.catch(() => {})
    }
  }
  return { flow, approve, pasted }
}

test('reports signed out when no model is available', async (t) => {
  const { client, status } = await signInHost(t)

  const view = await status('signed-out')
  assert.deepEqual(view.signIn, { status: 'signed-out' })
  assert.notEqual(view.hello?.signIn.status, 'signed-in', 'the first thing a UI hears is not that it is signed in')
  assert.equal(client.received.some((message) => message.type === 'state' && message.signIn?.status === 'signed-in'), false)
})

test('an existing credential opens signed in', async (t) => {
  const pi = await signInHost(t, { stored: ['openai'] })

  assert.deepEqual((await pi.status('signed-in')).signIn, { status: 'signed-in' })
  const seen = pi.client.received.flatMap((message) => (message.type === 'hello' || message.type === 'state' ? [message.signIn?.status] : []))
  assert.equal(seen.includes('signed-out') || seen.includes('signing-in'), false, 'the sign-in screen never has a reason to show')
  assert.deepEqual(pi.logins, [])
  assert.deepEqual(pi.opened, [])
})

test('a pasted redirect url resolves the manual prompt', async (t) => {
  const browser = browserFlow()
  const pi = await signInHost(t, { flow: browser.flow })
  await pi.status('signed-out')

  await pi.client.run('signin.start', { provider: 'openai' })
  const { prompt } = signingIn(await pi.client.until((view) => view.signIn?.status === 'signing-in' && view.signIn.prompt, 'the field for the address'))
  assert.equal(prompt?.message, 'Complete login in your browser, or paste the final redirect URL here:')
  assert.equal(prompt?.placeholder, 'http://127.0.0.1:1455/auth/callback')

  // An answer to a prompt that is not on screen goes nowhere.
  const stale = await pi.client.command('signin.answer', { prompt: 'not-this-one', value: REDIRECT })
  assert.equal(stale.ok, false)

  await pi.client.run('signin.answer', { prompt: prompt!.id, value: REDIRECT })
  assert.deepEqual((await pi.status('signed-in')).signIn, { status: 'signed-in' })
  assert.deepEqual(browser.pasted, [REDIRECT], 'Pi got the address exactly as it was pasted')
  assert.equal(pi.store.has('openai'), true)
})

test('cancel aborts and stores nothing', async (t) => {
  const browser = browserFlow()
  const pi = await signInHost(t, { flow: browser.flow })
  await pi.status('signed-out')

  await pi.client.run('signin.start', { provider: 'openai' })
  await pi.client.until((view) => view.signIn?.status === 'signing-in' && view.signIn.prompt, 'the sign-in to be waiting')
  await pi.client.run('signin.cancel')

  // Back where it started, with no complaint: backing out is not a failure.
  assert.deepEqual((await pi.status('signed-out')).signIn, { status: 'signed-out' })
  assert.equal(pi.store.size, 0)
  browser.approve()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(pi.store.size, 0, 'an approval that comes after the cancel changes nothing')
  assert.equal(pi.client.view.signIn?.status, 'signed-out')

  // Cancelling when nothing is under way is fine too.
  assert.deepEqual(await pi.client.run('signin.cancel'), { ok: true })
})

test('no credential field reaches the socket or the log', async (t) => {
  const browser = browserFlow()
  // A failing provider may quote what it was given.
  let attempt = 0
  const pi = await signInHost(t, {
    flow: async (provider, interaction) => {
      attempt += 1
      if (attempt === 1) throw Error(`Token exchange failed for ${REDIRECT} with access_token=${FAKE_SECRETS.access}`)
      return browser.flow(provider, interaction)
    },
  })
  await pi.status('signed-out')

  await pi.client.run('signin.start', { provider: 'openai' })
  await pi.client.until((view) => view.signIn?.status === 'signed-out' && view.signIn.problem, 'the failure to show')
  await pi.client.run('signin.start', { provider: 'openai' })
  const { prompt } = signingIn(await pi.client.until((view) => view.signIn?.status === 'signing-in' && view.signIn.prompt, 'the field for the address'))
  await pi.client.run('signin.answer', { prompt: prompt!.id, value: REDIRECT })
  await pi.status('signed-in')
  await pi.client.live()
  await pi.client.run('conversation.send', { text: 'Hello' })
  await pi.client.until((view) => view.snapshot.busy === false && view.messages.length === 2, 'a reply')
  await pi.client.run('models.key-help', { provider: 'anthropic' })
  await pi.client.run('signin.out', { provider: 'openai' })
  await pi.status('signed-out')

  const wire = pi.client.received.map((message) => JSON.stringify(message)).join('\n')
  // The main startup's target (owner.startup.target) names that startup by home, epoch, token and session, and the window
  // sends it back with startup.force so a force reaches only the startup it saw. Its token is a nonce the host draws for
  // each startup, not a credential: it travels only on the socket, which opens only with the host's own token, and it
  // lets that socket do nothing it could not do already. The field rule reads the wire without it.
  const startupTarget = (value: unknown): value is { token: string } => Boolean(value && typeof value === 'object' && 'epoch' in value && 'sessionId' in value && 'token' in value)
  const wireFields = pi.client.received
    .map((message) => JSON.stringify(message, (key, value: unknown) => (key === 'target' && startupTarget(value) ? { ...value, token: undefined } : value)))
    .join('\n')
  const logged = pi.log.join('\n')
  assert.ok(wire.length > 1000 && pi.client.received.some((message) => message.type === 'state' && message.signIn))
  for (const [where, text, fields] of [['a message to the UI', wire, wireFields], ['the log', logged, logged]] as const) {
    for (const secret of [...Object.values(FAKE_SECRETS), 'SECRET-AUTH-CODE']) assert.equal(text.includes(secret), false, `${secret} is in ${where}`)
    // A credential field holds its value as a string. The models slice names the API-key route as an object, which holds none.
    assert.doesNotMatch(fields, /"(access|refresh|key|apiKey|api_key|access_token|refresh_token|id_token|credential|secret|token)"\s*:\s*"/i, `a credential field is in ${where}`)
  }
  // The sign-in still said enough to be followed.
  assert.match(logged, /openai/)
})

test('what a provider says is shown without anything that looks like a credential', () => {
  const shown = [
    `Token exchange failed for ${REDIRECT} with access_token=${FAKE_SECRETS.access}`,
    `{"refresh_token": "${FAKE_SECRETS.refresh}", "error": "invalid_grant"}`,
    `Authorization: Bearer ${FAKE_SECRETS.access} was rejected (status code 401)`,
    `OPENAI_API_KEY=${FAKE_SECRETS.apiKey} is not valid`,
  ].map(withoutSecrets)

  for (const secret of [...Object.values(FAKE_SECRETS), 'SECRET-AUTH-CODE']) assert.equal(shown.join('\n').includes(secret), false, secret)
  // What helps the user understand the failure stays.
  assert.match(shown[0]!, /Token exchange failed for http:\/\/127\.0\.0\.1:1455\/auth\/callback\?code=\[hidden\]&state=public-state/)
  assert.match(shown[1]!, /invalid_grant/)
  assert.match(shown[2]!, /status code 401/)
  assert.equal(withoutSecrets('Exchanging authorization code for tokens...'), 'Exchanging authorization code for tokens...')
})
