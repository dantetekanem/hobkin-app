import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { FirstModels } from '#shared/tiers/first-models.ts'
import { Client, fakeModelServer, hostFor, piFolderFor, temporaryDirectory } from './support.ts'

// Pi reads keys from the environment. This file runs in a process of its own, so taking them out here touches nothing else.
for (const name of Object.keys(process.env)) {
  if (/(_API_KEY|_TOKEN|_SECRET|_KEY_ID)$|^(AWS|GOOGLE|GCLOUD|AZURE|CLOUDFLARE|ANTHROPIC|OPENAI|DEEPSEEK)_/.test(name)) delete process.env[name]
}
// Pi's catalog is its own built-in copy: no look at pi.dev.
process.env.PI_OFFLINE = '1'

// Every request this process makes passes here, and only this machine may be reached.
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.hostname !== '127.0.0.1') throw Error(`This test reaches nothing but this machine, not ${url.origin}.`)
  return realFetch(input, init)
}

test("on a new home the setup's account step sets hobkin's model and tiers from the account once, and the first chat runs on them", async (t) => {
  const server = await fakeModelServer(t, (request) => ({ text: `Reply from ${request.model}.` }))
  // DeepSeek by key, the only account. Pi's own settings would start it on DeepSeek Flash.
  const agent = piFolderFor(t, server.baseUrl, { providers: ['deepseek'] })
  process.env.PI_CODING_AGENT_DIR = agent
  const root = join(temporaryDirectory(t), 'home')
  const { piModelAccess } = await import('../src/model-access.ts')
  const pi = await piModelAccess({ authPath: join(agent, 'auth.json'), modelsPath: join(agent, 'models.json'), modelsStorePath: join(agent, 'models-store.json') })
  const opened: string[] = []
  const host = await hostFor(t, { root, live: true, access: async () => pi, openUrl: (url: string) => void opened.push(url) })
  const client = await Client.connect(host)
  await client.live()

  // Pi's default for DeepSeek is V4 Pro, which thinks off, high or max, so medium moves up to high. Flash is cheaper and reaches max too.
  const first = await client.run<FirstModels>('tiers.first', {})
  assert.ok(first.set)
  assert.deepEqual(first.lead, { model: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', effort: 'high' })
  assert.deepEqual(
    Object.fromEntries(Object.entries(first.tiers).map(([tier, { model, effort }]) => [tier, `${model} ${effort}`])),
    { fast: 'deepseek/deepseek-flash low', mid: 'deepseek/deepseek-v4-pro high', high: 'deepseek/deepseek-v4-pro high', max: 'deepseek/deepseek-v4-pro max' },
  )

  // Saved where hobkin keeps them, so the terminal app and every later run read the same.
  const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))
  assert.deepEqual(config.main, { cwd: root, model: 'deepseek/deepseek-v4-pro', effort: 'high' })
  assert.deepEqual(config.tiers.fast, { model: 'deepseek/deepseek-flash', effort: 'low' })
  assert.deepEqual(config.background, { harness: 'pi', model: 'deepseek/deepseek-v4-pro', effort: 'high' }, 'the checks on the mid pick')

  // The open conversation answers with it at once.
  await client.until((view) => view.snapshot.main?.model === 'deepseek/deepseek-v4-pro', 'the conversation on the first model')
  await client.run('conversation.send', { text: 'hello' })
  await client.until((view) => view.messages.some((message) => message.role === 'assistant' && message.content === 'Reply from deepseek-v4-pro.'), 'the reply')

  // Once only: from now on the home has a model chosen, and nothing is overwritten.
  assert.deepEqual(await client.run<FirstModels>('tiers.first', {}), { set: false, why: 'chosen' })
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')), config)
  assert.deepEqual(opened, [], 'nothing asked for a browser')
})

test('the scripted host sets nothing', async (t) => {
  const host = await hostFor(t)
  const client = await Client.connect(host)
  await client.live()
  const refused = await client.command('tiers.first', {})
  assert.equal(!refused.ok && refused.error.code, 'unavailable')
  assert.match(!refused.ok ? refused.error.message : '', /scripted model.*--live/)
  const { loadConfig } = await import('hobkin/src/cli/config.mjs')
  assert.equal(loadConfig(host.root).main.model, null)
})
