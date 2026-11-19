import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ModelsState, ModelsUpdate } from '#shared/protocol/models.ts'
import { createClientTool } from '../src/client-tool.ts'
import { LauncherModels, withLauncher, type Launcher, type LauncherRun } from '../src/launcher-models.ts'
import { CATALOG_REFRESH_MS, refreshCatalogs, updatingAccess } from '../src/model-access.ts'
import type { PiModelRuntime } from '../src/pi.ts'
import { scriptedModelAccess } from '../src/scripted-access.ts'
import { afterTest, Client, fakeModelAccess, hostFor } from './support.ts'

type Refresh = (options: { allowNetwork?: boolean; force?: boolean; signal?: AbortSignal }) => Promise<unknown>

/** Only `refresh` is ever called on this runtime. It writes down how, and never goes to a network. */
const fakeRuntime = (refresh: Refresh) => ({ refresh }) as unknown as PiModelRuntime

const choice = (provider: string, id: string) => ({ id, provider, name: id, thinking: ['off'], contextWindow: null })
const state = (...ids: string[]): ModelsState => ({ providers: [], models: ids.map((entry) => choice(entry.split('/')[0]!, entry.split('/')[1]!)) })

test("the update is Pi's own refresh: the network on, every provider forced, and the signal of a time limit", async () => {
  const calls: Parameters<Refresh>[0][] = []
  const errors = await refreshCatalogs(fakeRuntime(async (options) => (calls.push(options), { aborted: false, errors: new Map() })))
  assert.deepEqual(errors, [])
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.allowNetwork, true)
  assert.equal(calls[0]!.force, true)
  assert.ok(calls[0]!.signal instanceof AbortSignal)
  assert.equal(CATALOG_REFRESH_MS, 15_000)
})

test('an update lists again, names the models that are new, and keeps what it got when one provider failed', async () => {
  let listed = 0
  const lists = [state('a/old'), state('a/old', 'a/fresh', 'b/other')]
  const refreshed: string[] = []
  const access = updatingAccess(
    fakeRuntime(async () => (refreshed.push('refresh'), { aborted: false, errors: new Map([['c', Error('c answered 500 with api_key=sk-secret-value')]]) })),
    async () => lists[Math.min(listed++, 1)]!,
  )
  await access.list()
  const result = await access.update()
  assert.deepEqual(result.added, ['a/fresh', 'b/other'])
  assert.deepEqual(result.models.map(({ id }) => id), ['old', 'fresh', 'other'], 'the partial refresh still answers its models')
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0]!.provider, 'c')
  assert.match(result.errors[0]!.message, /c answered 500/)
  assert.doesNotMatch(result.errors[0]!.message, /sk-secret-value/)

  // The next update compares with the list it just gave.
  listed = 1
  assert.deepEqual((await access.update()).added, [])
  assert.equal(listed, 2)
})

test('an update with no list before it still has something to compare with', async () => {
  const lists = [state('a/old'), state('a/old', 'a/fresh')]
  let listed = 0
  const access = updatingAccess(fakeRuntime(async () => ({ aborted: false, errors: new Map() })), async () => lists[listed++]!)
  assert.deepEqual((await access.update()).added, ['a/fresh'])
})

test('an update that runs out of time gives up with a plain error', async () => {
  let signal: AbortSignal | undefined
  const access = updatingAccess(
    fakeRuntime((options) => ((signal = options.signal), new Promise(() => {}))),
    async () => state('a/old'),
    20,
  )
  await assert.rejects(access.update(), /Model catalog refresh timed out\./)
  assert.equal(signal?.aborted, true)

  // Pi's own answer for an aborted refresh reads the same.
  const aborted = updatingAccess(fakeRuntime(async () => ({ aborted: true, errors: new Map() })), async () => state(), 20)
  await assert.rejects(aborted.update(), /Model catalog refresh timed out\./)
})

test('an update asks the launcher again at once and adds what it newly lists', async () => {
  const launcher: Launcher = { command: ['work-pi'] }
  const table = (...ids: string[]) => ['provider model context thinking', ...ids.map((id) => `acme ${id} 200K yes`)].join('\n')
  let text = table('deep-1')
  const asked: string[][] = []
  const run: LauncherRun = async (_file, args) => (asked.push([...args]), { text })
  const models = new LauncherModels({ launcher: () => launcher, run })
  const base = {
    list: async () => state('a/old'),
    update: async (): Promise<ModelsUpdate> => ({ ...state('a/old', 'a/fresh'), added: ['a/fresh'], errors: [] }),
  } as unknown as Parameters<typeof withLauncher>[0]
  const access = withLauncher(base, models)

  await access.list()
  assert.equal(asked.length, 1)
  await access.list()
  assert.equal(asked.length, 1, 'kept five minutes')

  text = table('deep-1', 'deep-2')
  const result = await access.update()
  assert.equal(asked.length, 2, 'the update does not wait out the kept answer')
  assert.deepEqual(result.added, ['a/fresh', 'acme/deep-2'])
  assert.deepEqual(result.models.map(({ id }) => id), ['old', 'fresh', 'deep-1', 'deep-2'])
})

test('the scripted host updates without a network call and finds nothing new', async () => {
  const access = await scriptedModelAccess({ connected: ['openai'] })
  const result = await access.update()
  assert.deepEqual([result.added, result.errors], [[], []])
  assert.deepEqual(result.models, (await access.list()).models)
})

test('the window runs models.update, and the slice carries the new list', async (t) => {
  const pi = fakeModelAccess({ ambient: ['openai'] })
  const host = await hostFor(t, { access: async () => pi.access })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  const result = await client.run<ModelsUpdate>('models.update')
  assert.deepEqual([result.added, result.errors], [[], []])
  assert.ok(result.models.length > 0)
  await client.until((view) => (view.models?.models.length ?? 0) === result.models.length, 'the slice to carry the list')
})

test("hobkin's own client tool neither lists nor runs models.update", async () => {
  const ran: string[] = []
  const tool = createClientTool({ run: async (name) => (ran.push(name), { ok: true, value: {} }) })
  const listed = JSON.parse((await tool.execute('call-1', { action: 'list' })).content[0]!.text) as { name: string }[]
  assert.ok(!listed.some(({ name }) => name === 'models.update'))
  await assert.rejects(tool.execute('call-2', { action: 'run', name: 'models.update', args: {} }), /hobkin cannot run|needs the user/)
  assert.deepEqual(ran, [])
})
