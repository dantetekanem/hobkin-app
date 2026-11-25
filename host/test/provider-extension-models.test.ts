import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ModelsState } from '#shared/protocol/models.ts'
import { Client, hostFor, temporaryDirectory } from './support.ts'

for (const name of Object.keys(process.env)) {
  if (/(_API_KEY|_TOKEN|_SECRET|_KEY_ID)$|^(AWS|GOOGLE|GCLOUD|AZURE|CLOUDFLARE|ANTHROPIC|OPENAI)_/.test(name)) delete process.env[name]
}

test('only the selected provider extension reaches the host model picker, with Pi metadata', async (t) => {
  const folder = temporaryDirectory(t)
  const agentDir = join(folder, 'agent')
  process.env.PI_CODING_AGENT_DIR = agentDir
  process.env.PI_OFFLINE = '1'
  mkdirSync(join(agentDir, 'extensions'), { recursive: true })
  writeFileSync(join(agentDir, 'extensions', 'unrelated.ts'), 'throw Error("unrelated extension loaded")')
  const entry = join(folder, 'provider.ts')
  writeFileSync(entry, `export default function(pi) {
    pi.registerProvider('picker-fixture', {
      name: 'Picker Fixture', baseUrl: 'https://example.invalid', api: 'openai-completions', apiKey: 'fixture-only',
      models: [{ id: 'fixture-reasoner', name: 'Fixture Reasoner', reasoning: true, input: ['text'], contextWindow: 123456, maxTokens: 1024,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      oauth: { name: 'Fixture Login', login: async () => { throw Error('no auth in this test') },
        refreshToken: async c => c, getApiKey: c => c.access }
    })
  }`)
  const { piModelAccess } = await import('../src/model-access.ts')
  const options = { authPath: join(folder, 'auth.json'), modelsPath: null, modelsStorePath: join(folder, 'models-store.json') }
  const absent = await piModelAccess(options)
  assert.equal((await absent.list()).providers.some(({ id }) => id === 'picker-fixture'), false)
  const access = await piModelAccess(options, { 'picker-fixture': entry })
  const { initialize, atomicJson } = await import('hobkin/src/cli/config.mjs')
  const root = join(folder, 'home')
  const config = initialize(root, { cwd: root })
  const providerExtensions = { 'picker-fixture': entry }
  atomicJson(join(root, 'config.json'), { ...config, providerExtensions, main: { cwd: root, model: 'picker-fixture/fixture-reasoner', effort: 'medium' } })
  const host = await hostFor(t, { root, live: true })
  const client = await Client.connect(host)
  t.after(() => client.close())
  const view = await client.until(v => v.models?.models.some(m => m.provider === 'picker-fixture'), 'selected extension in picker')
  const listed = await client.run<ModelsState>('models.list')
  assert.deepEqual(listed, view.models)
  assert.equal((await client.live()).snapshot.main?.model, 'picker-fixture/fixture-reasoner')
  const { loadPiAi } = await import('../src/pi.ts')
  const ai = await loadPiAi()
  const model = access.runtime.getModels('picker-fixture')[0]!
  assert.deepEqual(view.models?.models.filter(m => m.provider === 'picker-fixture'), [{
    provider: 'picker-fixture', id: 'fixture-reasoner', name: 'Fixture Reasoner',
    thinking: ai.getSupportedThinkingLevels(model), contextWindow: 123456,
  }])
  assert.deepEqual(view.models?.providers.find(p => p.id === 'picker-fixture'), {
    id: 'picker-fixture', name: 'Picker Fixture', signIn: { label: 'Fixture Login', subscription: false }, connected: true,
  })
})
