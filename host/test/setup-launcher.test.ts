import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { LauncherRun } from '../src/launcher-models.ts'
import { configDeps, configLauncher, splitCommand, useLauncher, type UseLauncherDeps } from '../src/setup-launcher.ts'

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

test('a new home, which has no config yet, keeps the launcher: the step makes its config as its first conversation would', async () => {
  // On a work computer Pi starts only through the launcher, so the main conversation, which makes a new home's config,
  // cannot open before this step has kept it.
  const root = mkdtempSync(join(tmpdir(), 'hobkin-new-home-'))
  try {
    const file = join(root, 'config.json')
    assert.equal(existsSync(file), false)
    const run: LauncherRun = async () => ({ text: TABLE })
    let restarts = 0

    const launcher = await useLauncher('devx pi', { ...(await configDeps(root)), run, restart: async () => void restarts++ })

    assert.deepEqual(launcher, { command: ['devx', 'pi'] })
    const config = JSON.parse(readFileSync(file, 'utf8')) as { version: number; main: { cwd: string }; launcher: unknown }
    assert.deepEqual(config.launcher, { command: ['devx', 'pi'] })
    assert.equal(config.version, 2)
    assert.equal(config.main.cwd, root, 'the main agent works in the home until the user points it somewhere, as in a home the host opened')
    assert.deepEqual(await configLauncher(root), { command: ['devx', 'pi'] })
    assert.equal(restarts, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a home that has its config keeps everything in it when the launcher is added', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-kept-home-'))
  try {
    const { initialize } = await import('hobkin/src/cli/config.mjs')
    const before = initialize(root, { cwd: '/Users/someone/work', now: '2026-11-01T10:00:00.000Z' })
    const run: LauncherRun = async () => ({ text: TABLE })

    await useLauncher('devx pi', { ...(await configDeps(root)), run, restart: async () => {} })

    const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')) as Record<string, unknown>
    assert.deepEqual(config, { ...before, launcher: { command: ['devx', 'pi'] } })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
