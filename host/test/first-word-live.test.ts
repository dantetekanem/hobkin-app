import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { firstWordTable, summarizeFirstWord } from '../src/first-word.ts'
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

interface Timing {
  type: string
  runId?: string
  kind?: string
  engine?: string
  model?: string
  origin?: string
  stages?: Record<string, number>
  steps?: unknown[]
}

function eventsOf(root: string): Timing[] {
  const folder = join(root, 'runtime', 'events')
  return readdirSync(folder).flatMap((name) => readFileSync(join(folder, name), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Timing))
}

/** Waits for something that changes nothing in the window, so no message from the host says to look again. */
async function eventually(passes: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 15000
  while (!passes()) {
    if (Date.now() > deadline) throw Error(`Timed out waiting for ${what}.`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

const inOrder = (stages: Record<string, number>, names: string[]) => {
  const values = names.map((name) => stages[name])
  assert.ok(values.every((value) => typeof value === 'number'), `every stage of ${names.join(', ')} in ${JSON.stringify(stages)}`)
  assert.deepEqual(values, values.toSorted((left, right) => left! - right!), `${names.join(' ≤ ')} in ${JSON.stringify(stages)}`)
}

test('real Pi turns write their stages from the window\'s send to the first text: the main chat, a durable hobkin, and one whose process started ahead', async (t) => {
  const server = await fakeModelServer(t, () => ({ text: 'A reply from the model.' }))
  const agent = piFolderFor(t, server.baseUrl)
  process.env.PI_CODING_AGENT_DIR = agent
  const root = join(temporaryDirectory(t), 'home')
  // No test may reach a real browser.
  const opened: string[] = []
  const openUrl = (url: string) => void opened.push(url)

  // The home as the scripted model leaves it, which a live host then goes on with.
  const scripted = await hostFor(t, { root, openUrl })
  const before = await Client.connect(scripted)
  await before.live()
  await before.run('conversation.send', { text: 'hello from the scripted days' })
  await before.until((view) => view.messages.some(({ role }) => role === 'assistant'), 'the scripted reply')
  before.close()
  await scripted.close()

  const { piModelAccess } = await import('../src/model-access.ts')
  const pi = await piModelAccess({ authPath: join(agent, 'auth.json'), modelsPath: join(agent, 'models.json'), modelsStorePath: join(agent, 'models-store.json') })
  const host = await hostFor(t, { root, live: true, access: async () => pi, openUrl })
  const client = await Client.connect(host)
  await client.live()

  // The main chat: one process that stays up, so its turn has no process start.
  const sent = await client.run<{ id: string }>('conversation.send', { text: 'hello, live', sentAt: Date.now() })
  await client.until((view) => view.messages.some((message) => message.role === 'assistant' && message.content === 'A reply from the model.'), 'the live reply')
  await client.until(() => eventsOf(root).some((event) => event.type === 'run_performance' && event.runId === sent.id), "the main turn's timing")

  // A durable hobkin on Pi: its first turn starts a process, which stays up for the next.
  const folder = temporaryDirectory(t)
  const engine = { kind: 'pi', model: 'deepseek/deepseek-flash', effort: 'high' }
  const { id } = await client.run<{ id: string }>('hobkin.start', { cwd: folder, engine, text: 'first turn' })
  const durableTimings = () => eventsOf(root).filter((event) => event.type === 'run_performance' && event.kind === 'durable')
  const waiting = (hobkin: string, turns: number) => client.until(
    (view) => (view.snapshot.hobkins ?? []).some((item) => item.id === hobkin && item.state === 'waiting' && item.turns === turns), `the hobkin waiting after turn ${turns}`)
  await waiting(id, 1)
  await client.run('hobkin.say', { id, text: 'second turn', sentAt: Date.now() })
  await waiting(id, 2)
  await client.until(() => durableTimings().length === 2, 'both durable timings')

  // One started from the New hobkin sheet has no first message yet, so its process starts while the user writes it.
  const blank = await client.run<{ id: string }>('hobkin.start', { cwd: folder, engine })
  await eventually(() => eventsOf(root).some((event) => event.type === 'kept_process_warmed'), 'the process started ahead')
  await client.run('hobkin.say', { id: blank.id, text: 'first words', sentAt: Date.now() })
  await waiting(blank.id, 1)
  await client.until(() => durableTimings().length === 3, "the new hobkin's timing")

  const events = eventsOf(root)
  const timings = events.filter((event) => event.type === 'run_performance')
  const main = timings.find((event) => event.runId === sent.id)!
  assert.deepEqual([main.kind, main.engine, main.model, main.origin], ['main', 'pi', 'deepseek/deepseek-flash', 'window'])
  inOrder(main.stages!, ['host', 'handed', 'admitted', 'prompted', 'started', 'requested', 'text', 'ended'])
  assert.equal(main.steps!.length, 1)

  const [started, said, ahead] = timings.filter((event) => event.kind === 'durable')
  assert.deepEqual([started!.engine, started!.model, started!.origin], ['pi', 'deepseek/deepseek-flash', 'run'])
  inOrder(started!.stages!, ['admitted', 'resolved', 'spawned', 'ready', 'prompted', 'started', 'requested', 'text', 'ended'])
  // The second turn finds the first one's process still up, so it starts none.
  assert.equal(said!.origin, 'window')
  inOrder(said!.stages!, ['host', 'admitted', 'resolved', 'prompted', 'started', 'requested', 'text', 'ended'])
  assert.deepEqual(['spawned', 'ready'].filter((stage) => stage in said!.stages!), [])
  // Nor does the first turn of the one whose process was started ahead, and the model was asked nothing before it.
  assert.equal(ahead!.origin, 'window')
  inOrder(ahead!.stages!, ['host', 'admitted', 'resolved', 'prompted', 'started', 'requested', 'text', 'ended'])
  assert.deepEqual(['spawned', 'ready'].filter((stage) => stage in ahead!.stages!), [])
  assert.equal(events.filter((event) => event.type === 'kept_process_replaced').length, 0, 'the process started ahead was the one the turn would have started')
  assert.equal(server.requests.length, 4, 'one model request for each turn, and none to start a process')

  // With a model that answers at once, what is left is hobkin's and Pi's own time.
  t.diagnostic(`\n${firstWordTable(summarizeFirstWord(events))}`)
  const warm = events.find((event) => event.type === 'kept_process_warmed') as { ms?: number } | undefined
  t.diagnostic(`process started ahead in ${warm?.ms} ms`)
  for (const event of [main, started!, said!, ahead!]) t.diagnostic(`${event.kind} (${event.origin}): ${JSON.stringify(event.stages)}`)
  assert.deepEqual(opened, [], 'nothing asked for a browser')
})
