import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { OpenOptions } from 'hobkin/src/cli/application.mjs'
import { APP_ORIGIN } from '../src/access.ts'
import { afterTest, Client, fakeCommands, fakeModelServer, hostFor, piFolderFor, runHostProcess, temporaryDirectory } from './support.ts'

// Pi reads keys from the environment. This file runs in a process of its own, so taking them out here touches nothing else.
for (const name of Object.keys(process.env)) {
  if (/(_API_KEY|_TOKEN|_SECRET|_KEY_ID)$|^(AWS|GOOGLE|GCLOUD|AZURE|CLOUDFLARE|ANTHROPIC|OPENAI|DEEPSEEK)_/.test(name)) delete process.env[name]
}
// Pi's catalog is its own built-in copy: no look at pi.dev.
process.env.PI_OFFLINE = '1'

// Every request this process makes passes here, and only this machine may be reached.
const reached: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  reached.push(url.origin)
  if (url.hostname !== '127.0.0.1') throw Error(`This test reaches nothing but this machine, not ${url.origin}.`)
  return realFetch(input, init)
}

const HERDR_PANE = { HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w-test', HERDR_TAB_ID: 't-test', HERDR_PANE_ID: 'p-test' }
const reply = (view: Client['view'], text: string) => view.messages.some((message) => message.role === 'assistant' && message.content === text)

test("a live host on a development home goes on with the model Pi picks, and never reaches hobkin's server", async (t) => {
  const server = await fakeModelServer(t, (request) => ({ text: `Live reply from ${request.model}.` }))
  const agent = piFolderFor(t, server.baseUrl)
  process.env.PI_CODING_AGENT_DIR = agent
  const root = join(temporaryDirectory(t), 'home')
  // No test may reach a real browser. Anything the hosts would open is written down here.
  const opened: string[] = []
  const openUrl = (url: string) => void opened.push(url)

  // The development home as the scripted model leaves it: a conversation it answered.
  const scripted = await hostFor(t, { root, openUrl })
  const before = await Client.connect(scripted)
  await before.live()
  await before.run('conversation.send', { text: 'hello from the scripted days' })
  await before.until((view) => view.messages.some(({ role }) => role === 'assistant'), 'the scripted reply')
  before.close()
  await scripted.close()
  // And a home that never turned upload off, as one made by `hobkin init` would be.
  const config = await import('hobkin/src/cli/config.mjs')
  config.setTelemetryUpload(root, true)

  // What the host hands hobkin, seen on the way in.
  const { HobkinApplication } = await import('hobkin/src/cli/application.mjs')
  const open = HobkinApplication.open
  const handed: OpenOptions[] = []
  HobkinApplication.open = (home, options) => {
    handed.push(options ?? {})
    return open.call(HobkinApplication, home, options)
  }
  afterTest(t, () => void (HobkinApplication.open = open))
  Object.assign(process.env, HERDR_PANE)

  // Pi's real runtime on the test's own files: the same runtime the main session gets.
  const { piModelAccess } = await import('../src/model-access.ts')
  const pi = await piModelAccess({ authPath: join(agent, 'auth.json'), modelsPath: join(agent, 'models.json'), modelsStorePath: join(agent, 'models-store.json') })
  const host = await hostFor(t, { root, live: true, access: async () => pi, openUrl })
  const client = await Client.connect(host)
  let view = await client.live()

  // The scripted conversation goes on with Pi's saved default, a model of the models slice.
  assert.equal(view.snapshot.main?.model, 'deepseek/deepseek-flash')
  assert.ok(view.models?.models.some(({ provider, id }) => provider === 'deepseek' && id === 'deepseek-flash'))
  await client.run('conversation.send', { text: 'hello, live' })
  view = await client.until((now) => reply(now, 'Live reply from deepseek-flash.'), 'the live reply')
  assert.equal(server.requests[0].model, 'deepseek-flash')
  assert.match(JSON.stringify(server.requests[0].messages), /hello from the scripted days/, 'the conversation went on')

  // hobkin's server is never reached: upload is off again, and the fetch hobkin got refuses.
  assert.equal(config.telemetryUploadEnabled(root), false)
  await assert.rejects(handed[0].fetch!('https://api.hobkin.dev/api/v1/enrollments', { method: 'POST' }), /sends nothing to hobkin's server/)
  assert.deepEqual([...new Set(reached)], [server.origin])
  assert.equal(existsSync(join(root, 'runtime', 'remote.json')), false, 'no enrollment key')

  // hobkin and what it starts see no Herdr pane, and `hobkin` commands land in this home.
  assert.deepEqual(Object.keys(process.env).filter((name) => name.startsWith('HERDR_')), [])
  assert.equal(process.env.HOBKIN_HOME, root)

  // Signing out while hobkin is open: the window learns at once, and hobkin stays open.
  const out = await client.run<{ stillConnected: boolean; message: string }>('signin.out', { provider: 'deepseek' })
  assert.deepEqual(out, { ok: true, stillConnected: false, message: 'Signed out of DeepSeek.' })
  view = await client.until((now) => now.signIn?.status === 'signed-out', 'signed out')
  assert.equal(view.models?.models.length, 0)
  assert.equal(view.owner?.state, 'live')

  // A key given to Pi again reaches the open conversation, with no restart.
  await pi.storeKeyCommand('deepseek', '!printf not-a-real-key')
  await client.run('models.list')
  await client.until((now) => now.signIn?.status === 'signed-in', 'signed in again')
  await client.run('conversation.send', { text: 'still there?' })
  await client.until((now) => now.messages.filter((message) => message.content === 'Live reply from deepseek-flash.').length === 2, 'the second live reply')
  assert.equal(server.requests.length, 2)
  assert.deepEqual(opened, [], 'nothing asked for a browser')
})

test('a live host started inside Herdr touches no pane, and what its agent runs stays in its home', async (t) => {
  const served = join(temporaryDirectory(t), 'home')
  const userHome = temporaryDirectory(t)
  const hobkinCli = fileURLToPath(import.meta.resolve('hobkin/src/cli/main.mjs'))
  // The agent's one tool call: what its shell sees, and a `hobkin` command with no --home, as the hobkin skill writes them.
  const command = `printenv HOBKIN_HOME; env | grep -c '^HERDR_'; '${process.execPath}' '${hobkinCli}' remember 'Kept in the served home.'`
  const server = await fakeModelServer(t, (_request, index) => (index === 0 ? { toolCall: { name: 'bash', arguments: { command } } } : { text: 'Done.' }))
  const agent = piFolderFor(t, server.baseUrl)

  // Herdr's own socket and command, standing in for the user's panes. Nothing may reach either.
  const socketPath = join(temporaryDirectory(t), 'herdr.sock')
  let knocks = 0
  const socket = createServer((connection) => {
    knocks += 1
    connection.destroy()
  })
  await new Promise<void>((resolve) => socket.listen(socketPath, resolve))
  afterTest(t, () => new Promise((resolve) => socket.close(resolve)))
  // A live host opens pages with the system's `open`. This one only writes down that it was asked.
  const fake = fakeCommands(t, ['herdr', 'qmd', 'open', 'xdg-open'])

  const host = await runHostProcess(t, ['--live', '--home', served, '--port', '0'], {
    ...HERDR_PANE,
    HERDR_SOCKET_PATH: socketPath,
    HERDR_BIN_PATH: join(fake.bin, 'herdr'),
    PATH: `${fake.bin}:${process.env.PATH}`,
    HOME: userHome,
    PI_CODING_AGENT_DIR: agent,
  })
  const client = await Client.connect(host.address(served), { origin: APP_ORIGIN })
  await client.live()
  await client.run('conversation.send', { text: 'remember something' })
  await client.until((view) => reply(view, 'Done.'), 'the end of the turn')

  // A new conversation starts on Pi's saved default.
  assert.equal(server.requests[0].model, 'deepseek-flash')
  const toolResult = JSON.stringify(server.requests[1].messages.filter(({ role }) => role === 'tool'))
  assert.match(toolResult, new RegExp(`${served}\\\\n0\\\\n`), 'the shell had HOBKIN_HOME and no Herdr variable')
  assert.match(readFileSync(join(served, 'runtime', 'inbox.jsonl'), 'utf8'), /Kept in the served home\./, toolResult)
  assert.equal(existsSync(join(userHome, '.hobkin')), false, 'nothing reached ~/.hobkin')
  assert.equal(existsSync(fake.log), false, `nothing ran herdr, qmd or a browser: ${existsSync(fake.log) ? readFileSync(fake.log, 'utf8') : ''}`)
  assert.equal(knocks, 0, "nothing knocked on Herdr's socket")
  assert.equal(JSON.parse(readFileSync(join(served, 'config.json'), 'utf8')).telemetryUpload?.enabled, false)
  assert.equal(await host.kill('SIGTERM'), 0)
})

test("the model the user chooses is saved in hobkin's config, and the open conversation answers with it at once", async (t) => {
  const server = await fakeModelServer(t, (request) => ({ text: `Reply from ${request.model}.` }))
  const agent = piFolderFor(t, server.baseUrl, { providers: ['deepseek', 'groq'] })
  process.env.PI_CODING_AGENT_DIR = agent
  const root = join(temporaryDirectory(t), 'home')
  const opened: string[] = []
  const { piModelAccess } = await import('../src/model-access.ts')
  const pi = await piModelAccess({ authPath: join(agent, 'auth.json'), modelsPath: join(agent, 'models.json'), modelsStorePath: join(agent, 'models-store.json') })
  const live = { root, live: true, access: async () => pi, openUrl: (url: string) => void opened.push(url) }
  const host = await hostFor(t, live)
  const client = await Client.connect(host)
  await client.live()
  const saved = () => JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')).main

  // A model Pi cannot use now is refused, with what is wrong in plain words, and nothing is saved.
  const refusals: [Record<string, string>, RegExp][] = [
    [{ model: 'anthropic/claude-test' }, /Anthropic is not connected/],
    [{ model: 'nobody/model' }, /Pi has no provider named nobody/],
    [{ model: 'deepseek/no-such-model' }, /Pi knows no DeepSeek model named no-such-model/],
    [{ model: 'groq/llama-3.3-70b-versatile', effort: 'high' }, /thinking levels: off\b/],
  ]
  for (const [args, reason] of refusals) {
    const refused = await client.command('models.select', args)
    assert.equal(!refused.ok && refused.error.code, 'unavailable', JSON.stringify(args))
    assert.match(!refused.ok ? refused.error.message : '', reason)
  }
  const unknownLevel = await client.command('models.select', { model: 'groq/llama-3.3-70b-versatile', effort: 'turbo' })
  assert.equal(!unknownLevel.ok && unknownLevel.error.code, 'invalid-arguments')
  assert.deepEqual(saved(), { cwd: root, model: null, effort: 'medium' })

  // The choice goes where hobkin keeps it, and the open conversation answers with it at once.
  const chosen = await client.run('models.select', { model: 'groq/llama-3.3-70b-versatile', effort: 'off' })
  assert.deepEqual(chosen, { ok: true, model: 'groq/llama-3.3-70b-versatile', effort: 'off', applied: true })
  assert.deepEqual(saved(), { cwd: root, model: 'groq/llama-3.3-70b-versatile', effort: 'off' })
  await client.until((view) => view.snapshot.main?.model === 'groq/llama-3.3-70b-versatile', 'the conversation on the chosen model')
  await client.run('conversation.send', { text: 'hello' })
  await client.until((view) => reply(view, 'Reply from llama-3.3-70b-versatile.'), 'the reply from the chosen model')
  assert.deepEqual(server.requests.map(({ model }) => model), ['llama-3.3-70b-versatile'])

  // The next start opens on it.
  await host.close()
  const next = await Client.connect(await hostFor(t, live))
  assert.equal((await next.live()).snapshot.main?.model, 'groq/llama-3.3-70b-versatile')
  assert.deepEqual(opened, [], 'nothing asked for a browser')
})
