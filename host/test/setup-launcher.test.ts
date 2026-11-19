import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LauncherRun } from '../src/launcher-models.ts'
import { splitCommand, useLauncher, type UseLauncherDeps } from '../src/setup-launcher.ts'

const TABLE = 'provider  model   context  max-out  thinking  images\nacme      deep-1  200K     32K      yes       yes\n'

/** A home whose config is a plain object: writes and restarts are written down, and nothing real is ever started. */
const home = (text: string, config: Record<string, unknown> = { main: {} }) => {
  const saw = { asked: [] as string[][], written: [] as Record<string, unknown>[], restarts: 0 }
  const run: LauncherRun = async (file, args) => (saw.asked.push([file, ...args]), { text })
  const deps: UseLauncherDeps = {
    run,
    validate: (launcher) => {
      if (launcher.command[0]?.startsWith('-')) throw Error('launcher.command must not start with -')
    },
    read: () => config,
    write: (next) => saw.written.push(next),
    restart: async () => void saw.restarts++,
  }
  return { saw, deps }
}

test('a command is split into words, with quotes keeping a word whole', () => {
  assert.deepEqual(splitCommand('  work-pi --profile  "my team" \'a b\' '), ['work-pi', '--profile', 'my team', 'a b'])
  assert.deepEqual(splitCommand(''), [])
  assert.throws(() => splitCommand('work-pi "open'), /quote/)
})

test('a command that lists models is kept as the launcher in the config, and the main conversation starts again behind it', async () => {
  const { saw, deps } = home(TABLE)
  const launcher = await useLauncher('work-pi --flag', deps)

  assert.deepEqual(saw.asked, [['work-pi', '--flag', '--no-approve', '--list-models']])
  assert.deepEqual(launcher, { command: ['work-pi', '--flag'] })
  assert.deepEqual(saw.written, [{ main: {}, launcher: { command: ['work-pi', '--flag'] } }])
  assert.equal(saw.restarts, 1)
})

test('a command that lists none is refused with what it printed, and nothing is kept or restarted', async () => {
  const { saw, deps } = home('Please log in first.\nNo models available.\n')
  await assert.rejects(useLauncher('work-pi', deps), /listed no models.*Please log in first\.\nNo models available\./s)
  assert.deepEqual(saw.written, [])
  assert.equal(saw.restarts, 0)

  const failing = home(TABLE)
  failing.deps.run = async () => {
    throw Error('command not found: work-pi')
  }
  await assert.rejects(useLauncher('work-pi', failing.deps), /command not found/)
  assert.deepEqual(failing.saw.written, [])
})

test('a command hobkin would refuse is never run, and a config that names a launcher already is left alone', async () => {
  const refused = home(TABLE)
  await assert.rejects(useLauncher('--evil', refused.deps), /cannot use that command/)
  assert.deepEqual(refused.saw.asked, [])

  const named = home(TABLE, { launcher: { command: ['x'] } })
  await assert.rejects(useLauncher('work-pi', named.deps), /already names a launcher/)
  assert.deepEqual(named.saw.asked, [])
  assert.deepEqual(named.saw.written, [])
})
