import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LauncherModels, parseLauncherModels, type Launcher, type LauncherRun } from '../src/launcher-models.ts'

const TABLE = [
  'provider   model            context  max-out  thinking  images',
  'acme       deep-1           200K     32K      yes       yes',
  'acme       quick-1          1M       8K       no        no',
  'other      plain.model-2    128K     16K      yes       no',
  '',
].join('\n')

const LAUNCHER: Launcher = { command: ['work-pi', '--flag'], env: { REGION: 'x' } }

/** Answers every ask with `text` and writes down what was run. Nothing real is ever started. */
const fakeRun = (text: string, calls: { file: string; args: string[]; env: NodeJS.ProcessEnv }[] = []): LauncherRun => async (file, args, env) => {
  calls.push({ file, args: [...args], env })
  return { text }
}

const clock = (start = 1_000) => {
  const time = { now: start }
  return { time, now: () => time.now }
}

test('the table Pi prints is read into models, thinking or not, with their context windows', () => {
  const models = parseLauncherModels(TABLE)
  assert.deepEqual(
    models.map(({ provider, id, thinks, contextWindow }) => [provider, id, thinks, contextWindow]),
    [['acme', 'deep-1', true, 200_000], ['acme', 'quick-1', false, 1_000_000], ['other', 'plain.model-2', true, 128_000]],
  )
  // A paragraph in place of a table, as Pi prints when it has no model, lists none.
  assert.deepEqual(parseLauncherModels('No models available. Check /path with spaces/auth.json\n'), [])
  assert.deepEqual(parseLauncherModels(''), [])
})

test('a launcher is asked for its models through its own command and environment, and they make one connected account named by the command', async () => {
  const calls: { file: string; args: string[]; env: NodeJS.ProcessEnv }[] = []
  const models = new LauncherModels({ launcher: () => LAUNCHER, run: fakeRun(TABLE, calls) })
  const found = await models.list()

  assert.deepEqual(calls.map(({ file, args }) => [file, ...args]), [['work-pi', '--flag', '--no-approve', '--list-models']])
  assert.equal(calls[0]?.env.REGION, 'x')
  assert.deepEqual(found?.account, { id: 'launcher', name: 'work-pi --flag', connected: true, connectedBy: 'launcher' })
  assert.deepEqual(found?.models.map(({ provider, id }) => `${provider}/${id}`), ['acme/deep-1', 'acme/quick-1', 'other/plain.model-2'])
})

test('a model that thinks offers every level, max too, and one that does not offers only off', async () => {
  const found = await new LauncherModels({ launcher: () => LAUNCHER, run: fakeRun(TABLE) }).list()
  const by = (id: string) => found?.models.find((model) => model.id === id)

  assert.deepEqual(by('deep-1')?.thinking, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(by('plain.model-2')?.thinking.at(-1), 'max')
  assert.deepEqual(by('quick-1')?.thinking, ['off'])
})

test('the answer is kept five minutes, then asked again', async () => {
  const calls: unknown[] = []
  const { time, now } = clock()
  const models = new LauncherModels({ launcher: () => LAUNCHER, run: fakeRun(TABLE, calls as never), now })

  await models.list()
  time.now += 5 * 60_000 - 1
  await models.list()
  assert.equal(calls.length, 1)
  time.now += 1
  await models.list()
  assert.equal(calls.length, 2)
})

test('the answer is asked again at once when the launcher in the config changes', async () => {
  const calls: unknown[] = []
  let launcher: Launcher | undefined = LAUNCHER
  const models = new LauncherModels({ launcher: () => launcher, run: fakeRun(TABLE, calls as never), now: () => 1 })

  await models.list()
  launcher = { command: ['other-pi'] }
  const found = await models.list()
  assert.equal(calls.length, 2)
  assert.equal(found?.account.name, 'other-pi')
})

test('without a launcher nothing is run, and a launcher that lists nothing or fails gives no account', async () => {
  const calls: unknown[] = []
  assert.equal(await new LauncherModels({ launcher: () => undefined, run: fakeRun(TABLE, calls as never) }).list(), null)
  assert.deepEqual(calls, [])

  assert.equal(await new LauncherModels({ launcher: () => LAUNCHER, run: fakeRun('Nothing here.\n') }).list(), null)
  const failing: LauncherRun = async () => {
    throw Error('exit 1')
  }
  assert.equal(await new LauncherModels({ launcher: () => LAUNCHER, run: failing }).list(), null)
  // A config that cannot be read is no launcher.
  const unreadable = () => {
    throw Error('bad config')
  }
  assert.equal(await new LauncherModels({ launcher: unreadable, run: fakeRun(TABLE) }).list(), null)
})
