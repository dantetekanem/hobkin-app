import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SignInState } from '#shared/protocol/signin.ts'
import { Client, hostFor, temporaryDirectory } from './support.ts'

// Pi reads keys from the environment. This test runs in a process of its own, so taking them out here touches nothing else.
for (const name of Object.keys(process.env)) {
  if (/(_API_KEY|_TOKEN|_SECRET|_KEY_ID)$|^(AWS|GOOGLE|GCLOUD|AZURE|CLOUDFLARE|ANTHROPIC|OPENAI)_/.test(name)) delete process.env[name]
}

test("the live adapter reads Pi's own catalog and stores a key command through Pi, with no credentials of the user's", async (t) => {
  // Pi's real runtime, on files of the test's own: an empty auth.json, no models.json, a settings folder of its own.
  const folder = temporaryDirectory(t)
  process.env.PI_CODING_AGENT_DIR = join(folder, 'agent')
  const authPath = join(folder, 'auth.json')
  const { piModelAccess } = await import('../src/model-access.ts')
  const access = await piModelAccess({ authPath, modelsPath: null, modelsStorePath: join(folder, 'models-store.json') })

  const before = await access.list()
  const find = (id: string) => before.providers.find((provider) => provider.id === id)
  // Pi's own names and routes: a subscription with a key, a key alone, cloud credentials.
  assert.deepEqual(find('anthropic')?.signIn?.subscription, true)
  assert.equal(find('anthropic')?.apiKey?.env[0], 'ANTHROPIC_API_KEY')
  assert.equal(find('openai')?.signIn?.label, 'Sign in with ChatGPT')
  assert.equal(find('google')?.signIn, undefined)
  assert.deepEqual(find('google')?.apiKey?.env, ['GEMINI_API_KEY'])
  assert.ok(find('amazon-bedrock')?.cloud)
  assert.ok(before.providers.every(({ connected }) => connected === false), 'nothing is connected with no credentials')
  assert.deepEqual(before.models, [])
  // Each provider names the model Pi starts on for it when nothing is saved: Pi's own table, for models its catalog has.
  const { loadPiDefaultModels } = await import('../src/pi.ts')
  const defaults = await loadPiDefaultModels()
  assert.ok(Object.keys(defaults).length > 10, "Pi's table was found")
  for (const provider of before.providers.filter(({ defaultModel }) => defaultModel)) {
    assert.equal(provider.defaultModel, defaults[provider.id], provider.id)
    assert.ok(access.runtime.getModels(provider.id).some(({ id }) => id === provider.defaultModel), provider.id)
  }
  for (const id of ['anthropic', 'openai', 'google']) assert.ok(find(id)?.defaultModel, id)

  // A key that is a command goes in through Pi's own key login. A harmless command stands in for the Keychain here.
  await access.storeKeyCommand('google', '!printf not-a-real-key')
  assert.equal(await access.hasStoredCredential('google'), true)
  // The file is the test's own. Pi wrote the line as given, private to the user.
  assert.deepEqual(JSON.parse(readFileSync(authPath, 'utf8')).google, { type: 'api_key', key: '!printf not-a-real-key' })

  const after = await access.list()
  assert.equal(after.providers.find(({ id }) => id === 'google')?.connected, true)
  assert.ok(after.models.length > 0 && after.models.every(({ provider }) => provider === 'google'))
  assert.ok(after.models.every(({ thinking, contextWindow }) => thinking.length > 0 && (contextWindow === null || contextWindow > 0)))

  // A provider whose key login asks more than a key is refused, and Pi stores nothing for it.
  await assert.rejects(access.storeKeyCommand('amazon-bedrock', '!printf nothing'), /asks for more than a key/)
  assert.equal(await access.hasStoredCredential('amazon-bedrock'), false)

  await access.logout('google')
  assert.equal(await access.hasStoredCredential('google'), false)
  assert.equal((await access.list()).providers.find(({ id }) => id === 'google')?.connected, false)
})

test("a sign-in runs through Pi's own login, opens only the provider's page, and Pi stores what it returns", async (t) => {
  const folder = temporaryDirectory(t)
  process.env.PI_CODING_AGENT_DIR = join(folder, 'agent')
  const authPath = join(folder, 'auth.json')
  const { piModelAccess } = await import('../src/model-access.ts')
  const access = await piModelAccess({ authPath, modelsPath: null, modelsStorePath: join(folder, 'models-store.json') })
  // A provider with a sign-in of its own, registered the way a Pi extension registers one. Its page is never loaded.
  const page = 'https://sign-in.example.invalid/authorize?state=public'
  ;(access.runtime as unknown as { registerProvider(id: string, config: object): void }).registerProvider('test-sso', {
    name: 'Test SSO',
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
    models: [{ id: 'sso-model', name: 'SSO Model', reasoning: false, input: ['text'], contextWindow: 8000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    oauth: {
      name: 'Test SSO',
      async login(callbacks: { onAuth(info: { url: string }): void; onPrompt(prompt: { message: string }): Promise<string> }) {
        callbacks.onAuth({ url: page })
        const code = await callbacks.onPrompt({ message: 'Paste the code from the page' })
        return { access: `access-for-${code}`, refresh: `refresh-for-${code}`, expires: Date.now() + 3600000 }
      },
      refreshToken: async (credentials: unknown) => credentials,
      getApiKey: (credentials: { access: string }) => credentials.access,
    },
  })

  // No test may reach a real browser: the host's opener here only writes down what it was asked to open.
  const opened: string[] = []
  const host = await hostFor(t, { access: async () => access, openUrl: (url) => void opened.push(url) })
  const client = await Client.connect(host)
  t.after(() => client.close())
  await client.until((view) => view.models?.providers.some(({ id }) => id === 'test-sso'), 'the provider in the slice')

  await client.run('signin.start', { provider: 'test-sso' })
  const asked = await client.until((view) => view.signIn?.status === 'signing-in' && view.signIn.prompt, "Pi's question")
  const signingIn = asked.signIn as Extract<SignInState, { status: 'signing-in' }>
  assert.equal(signingIn.authUrl, page)
  assert.deepEqual(opened, [page])
  await client.run('signin.answer', { prompt: signingIn.prompt!.id, value: 'code-1' })

  const done = await client.until((view) => view.signIn?.status === 'signed-in' && view.models?.providers.find(({ id }) => id === 'test-sso')?.connected, 'the provider connected')
  assert.ok(done.models?.models.some(({ provider, id }) => provider === 'test-sso' && id === 'sso-model'))
  // Pi stored what its login returned, in the test's own file, and none of it reached the window.
  assert.equal(await access.hasStoredCredential('test-sso'), true)
  assert.equal(JSON.parse(readFileSync(authPath, 'utf8'))['test-sso']?.type, 'oauth')
  assert.equal(JSON.stringify(client.received).includes('access-for-code-1'), false)
})
