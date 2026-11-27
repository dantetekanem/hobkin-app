import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { isNewer, NewVersion, runProgram, type Run } from '../src/new-version.ts'
import { temporaryDirectory } from './support.ts'

const GIT = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main']
const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function versionIn(folder: string): string {
  return (JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as { version: string }).version
}

/** An origin on disk, a clone that publishes to it, and the copy of hobkin under test, cloned at 0.2.3. */
function copies(t: TestContext) {
  const folder = temporaryDirectory(t)
  const origin = join(folder, 'origin.git')
  const seed = join(folder, 'seed')
  const copy = join(folder, 'copy')
  git(folder, 'init', '-q', '--bare', '-b', 'main', origin)
  git(folder, 'init', '-q', '-b', 'main', seed)
  git(seed, 'remote', 'add', 'origin', origin)

  const publish = (version: string, note = version) => {
    writeFileSync(join(seed, 'package.json'), `${JSON.stringify({ name: 'hobkin-client', version }, null, 2)}\n`)
    writeFileSync(join(seed, 'notes.txt'), `${note}\n`)
    git(seed, 'add', '-A')
    git(seed, 'commit', '-q', '-m', `Version ${version}, ${note}`)
    git(seed, 'push', '-q', 'origin', 'main')
  }

  publish('0.2.3')
  git(folder, 'clone', '-q', origin, copy)
  return { origin, copy, publish }
}

/** The real runner, with every program it runs written down. */
function counted(): { run: Run; calls: string[][] } {
  const calls: string[][] = []
  const run: Run = (file, args, options) => {
    calls.push([file, ...args])
    return runProgram(file, args, options)
  }
  return { run, calls }
}

/** Stands in for `pnpm run bootstrap`: leaves a file that says where it ran. */
const INSTALL = [process.execPath, '-e', "require('node:fs').writeFileSync('installed', process.cwd())"]

test("a copy one version behind its origin's default branch hears of the newest, and a merge without a bump is not new", async (t) => {
  const { copy, publish } = copies(t)

  publish('0.2.3', 'a merge without a version bump')
  const merged = await new NewVersion({ repo: copy, looks: true, restarts: true }).read()
  assert.deepEqual(
    { current: merged.current, newest: merged.newest, available: merged.available, problem: merged.problem },
    { current: '0.2.3', newest: '0.2.3', available: false, problem: null },
  )

  publish('0.2.4')
  const bumped = await new NewVersion({ repo: copy, looks: true, restarts: true }).read()
  assert.deepEqual(
    { current: bumped.current, newest: bumped.newest, available: bumped.available, blocked: bumped.blocked, problem: bumped.problem },
    { current: '0.2.3', newest: '0.2.4', available: true, blocked: null, problem: null },
  )
  assert.ok(bumped.checkedAt && !Number.isNaN(Date.parse(bumped.checkedAt)))
  assert.equal(versionIn(copy), '0.2.3', 'looking changes nothing in the copy')
})

test('versions compare as numbers', () => {
  assert.equal(isNewer('0.2.10', '0.2.9'), true)
  assert.equal(isNewer('1.0.0', '0.9.9'), true)
  assert.equal(isNewer('0.2.4', '0.2.4'), false)
  assert.equal(isNewer('0.2.3', '0.2.4'), false)
  assert.equal(isNewer('0.3.0', '0.3.0-beta.1'), true, 'a release is newer than its pre-release')
  assert.equal(isNewer('0.3.0-beta.1', '0.3.0'), false)
  assert.equal(isNewer('not a version', '0.2.3'), false)
  assert.equal(isNewer('0.2.4', null), false)
})

test('Update fast-forwards a clean copy on the default branch and installs its packages in it', async (t) => {
  const { copy, origin, publish } = copies(t)
  publish('0.2.4')
  const versions = new NewVersion({ repo: copy, looks: true, restarts: true, install: INSTALL })

  const updated = await versions.update()

  assert.deepEqual(updated, { version: '0.2.4', restarts: true })
  assert.equal(versionIn(copy), '0.2.4')
  assert.equal(git(copy, 'rev-parse', 'HEAD'), git(origin, 'rev-parse', 'main'))
  assert.equal(readFileSync(join(copy, 'installed'), 'utf8'), copy, 'the install ran in the copy')
  const after = await versions.read()
  assert.deepEqual({ current: after.current, available: after.available }, { current: '0.2.4', available: false })

  publish('0.2.5')
  const unkept = new NewVersion({ repo: copy, looks: true, restarts: false, install: INSTALL })
  assert.deepEqual(await unkept.update(), { version: '0.2.5', restarts: false }, 'a host the app does not keep says the user restarts it')
})

test('Update leaves alone a copy on another branch, with uncommitted changes, or with commits its origin lacks, and says why', async (t) => {
  const onAnotherBranch = (copy: string) => {
    git(copy, 'switch', '-q', '-c', 'feature')
  }
  const withUncommittedChanges = (copy: string) => {
    writeFileSync(join(copy, 'notes.txt'), 'mine\n')
  }
  const withItsOwnCommit = (copy: string) => {
    writeFileSync(join(copy, 'mine.txt'), 'mine\n')
    git(copy, 'add', '-A')
    git(copy, 'commit', '-q', '-m', 'Mine')
  }
  const cases: [string, (copy: string) => void, RegExp][] = [
    ['another branch', onAnotherBranch, /only on main, and this copy is on feature/],
    ['uncommitted changes', withUncommittedChanges, /uncommitted changes/],
    ['its own commit', withItsOwnCommit, /commits that main on origin does not have/],
  ]

  for (const [what, make, why] of cases) {
    const { copy, publish } = copies(t)
    publish('0.2.4')
    make(copy)
    const head = git(copy, 'rev-parse', 'HEAD')
    const versions = new NewVersion({ repo: copy, looks: true, restarts: true, install: INSTALL })

    const status = await versions.read()

    assert.equal(status.available, true, what)
    assert.match(status.blocked ?? '', why, what)
    await assert.rejects(versions.update(), why, what)
    assert.equal(git(copy, 'rev-parse', 'HEAD'), head, `${what}: the copy stays where it was`)
    assert.equal(existsSync(join(copy, 'installed')), false, `${what}: nothing was installed`)
  }
})

test("a failed install says the copy is at the new version, with the install's last lines", async (t) => {
  const { copy, publish } = copies(t)
  publish('0.2.4')
  const failing = [process.execPath, '-e', "console.error('ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with frozen-lockfile'); process.exit(1)"]
  const versions = new NewVersion({ repo: copy, looks: true, restarts: true, install: failing })

  await assert.rejects(versions.update(), (error: Error) => {
    assert.match(error.message, /at 0\.2\.4 now/)
    assert.match(error.message, /ERR_PNPM_OUTDATED_LOCKFILE/)
    assert.ok(error.message.includes(`Run \`${failing.join(' ')}\` in ${copy}`), 'it names the install to run by hand, and where')
    return true
  })
  assert.equal(versionIn(copy), '0.2.4')
})

test("a look that can't reach the origin says so, and a host that is not live or not a checkout never runs git", async (t) => {
  const { copy, origin } = copies(t)
  rmSync(origin, { recursive: true, force: true })
  const unreachable = await new NewVersion({ repo: copy, looks: true, restarts: true }).read()
  assert.deepEqual(
    { current: unreachable.current, newest: unreachable.newest, available: unreachable.available },
    { current: '0.2.3', newest: null, available: false },
  )
  assert.match(unreachable.problem ?? '', /could not be reached/)

  const scripted = counted()
  const notLive = new NewVersion({ repo: copy, looks: false, restarts: true, run: scripted.run })
  const off = await notLive.read()
  assert.equal(off.available, false)
  assert.match(off.problem ?? '', /live/)
  await assert.rejects(notLive.update(), /live/)
  assert.deepEqual(scripted.calls, [])

  const release = temporaryDirectory(t)
  writeFileSync(join(release, 'package.json'), '{ "version": "0.2.3" }\n')
  const bundled = counted()
  const inApp = await new NewVersion({ repo: release, looks: true, restarts: false, run: bundled.run }).read()
  assert.deepEqual({ current: inApp.current, available: inApp.available }, { current: '0.2.3', available: false })
  assert.match(inApp.problem ?? '', /not run from a git checkout/)
  assert.deepEqual(bundled.calls, [])
})

test('a look holds six hours, and one that failed is made again after half an hour', async (t) => {
  const { copy, origin, publish } = copies(t)
  let now = Date.parse('2026-11-27T12:00:00Z')
  const { run, calls } = counted()
  const versions = new NewVersion({ repo: copy, looks: true, restarts: true, run, now: () => now })
  const fetches = () => calls.filter((call) => call.includes('fetch')).length

  await versions.read()
  publish('0.2.4')
  now += 5 * HOUR
  assert.equal((await versions.read()).available, false, 'five hours later it has not looked again')
  assert.equal(fetches(), 1)

  now += 1 * HOUR
  assert.equal((await versions.read()).newest, '0.2.4', 'six hours after its last look it looks again')
  assert.equal(fetches(), 2)
  await Promise.all([versions.read(), versions.read()])
  assert.equal(fetches(), 2)

  renameSync(origin, `${origin}.away`)
  now += 6 * HOUR
  assert.match((await versions.read()).problem ?? '', /could not be reached/)
  renameSync(`${origin}.away`, origin)
  now += 29 * MINUTE
  assert.match((await versions.read()).problem ?? '', /could not be reached/, 'a failed look holds for half an hour')
  assert.equal(fetches(), 3)

  now += 1 * MINUTE
  assert.equal((await versions.read()).problem, null)
  assert.equal(fetches(), 4)
})
