import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { temporaryDirectory } from './support.ts'

// Pi reads keys from the environment. This test runs in a process of its own, so taking them out here touches nothing else.
for (const name of Object.keys(process.env)) {
  if (/(_API_KEY|_TOKEN|_SECRET|_KEY_ID)$|^(AWS|GOOGLE|GCLOUD|AZURE|CLOUDFLARE|ANTHROPIC|OPENAI)_/.test(name)) delete process.env[name]
}

test('a connected provider says how Pi reaches it, and nothing else about the credential', async (t) => {
  const { connectedByOf } = await import('../src/model-access.ts')
  const statuses: Record<string, { configured: boolean; source?: string }> = {
    signed: { configured: true, source: 'stored' },
    keyed: { configured: true, source: 'stored' },
    env: { configured: true, source: 'environment' },
    'amazon-bedrock': { configured: true, source: 'environment' },
    file: { configured: true, source: 'models_json_key' },
    flag: { configured: true, source: 'runtime' },
    off: { configured: false },
  }
  const runtime = { getProviderAuthStatus: (id: string) => statuses[id] ?? { configured: false } }
  const credentials = [
    { providerId: 'signed', type: 'oauth' },
    { providerId: 'keyed', type: 'api_key' },
  ]
  const by = (id: string) => connectedByOf(runtime, credentials, id)
  assert.equal(by('signed'), 'sign-in')
  assert.equal(by('keyed'), 'key')
  assert.equal(by('env'), 'environment')
  assert.equal(by('amazon-bedrock'), 'cloud')
  assert.equal(by('file'), 'key')
  // Pi cannot tell where a key given on the command line came from, and a provider that is not connected has nothing to say.
  assert.equal(by('flag'), undefined)
  assert.equal(by('off'), undefined)

  // On Pi's real runtime, over files of the test's own: a stored key reads as a key, and a provider with nothing is silent.
  const folder = temporaryDirectory(t)
  process.env.PI_CODING_AGENT_DIR = join(folder, 'agent')
  const { piModelAccess } = await import('../src/model-access.ts')
  const access = await piModelAccess({ authPath: join(folder, 'auth.json'), modelsPath: null, modelsStorePath: join(folder, 'models-store.json') })
  await access.storeKeyCommand('google', '!printf not-a-real-key')
  const { providers } = await access.list()
  const google = providers.find(({ id }) => id === 'google')
  assert.equal(google?.connectedBy, 'key')
  assert.ok(providers.filter(({ id }) => id !== 'google').every((provider) => provider.connectedBy === undefined))
  assert.doesNotMatch(JSON.stringify(providers), /not-a-real-key/)
})
