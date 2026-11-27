import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { isNewer, NewVersion, runProgram, versionHandlers, type Run, type VersionSeat } from '../src/new-version.ts'
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

/** Update's handlers over a copy, with the agents they start written down instead of run. */
function updates(copy: string, { looks = true, restarts = true, run }: { looks?: boolean; restarts?: boolean; run?: Run } = {}) {
  const started: Parameters<VersionSeat['start']>[0][] = []
  const ended = new Set<string>()
  const handlers = versionHandlers({
    versions: new NewVersion({ repo: copy, looks, run }),
    restarts,
    start: async (agent) => {
      started.push(agent)
      return { id: `hobkin-${started.length}`, run: `run-${started.length}` }
    },
    exists: async (id) => !ended.has(id),
  })
  const update = async () => handlers['version.update']!({})
  const read = async () => handlers['version.read']!({})
  return { started, ended, update, read }
}

test("a copy one version behind its origin's default branch hears of the newest, and a merge without a bump is not new", async (t) => {
  const { copy, publish } = copies(t)

  publish('0.2.3', 'a merge without a version bump')
  const merged = await new NewVersion({ repo: copy, looks: true }).read()
  assert.deepEqual(
    { current: merged.current, newest: merged.newest, available: merged.available, problem: merged.problem },
    { current: '0.2.3', newest: '0.2.3', available: false, problem: null },
  )

  publish('0.2.4')
  const bumped = await new NewVersion({ repo: copy, looks: true }).read()
  assert.deepEqual(
    { current: bumped.current, newest: bumped.newest, available: bumped.available, inTheWay: bumped.inTheWay, problem: bumped.problem, branch: bumped.branch },
    { current: '0.2.3', newest: '0.2.4', available: true, inTheWay: null, problem: null, branch: 'main' },
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

test('Update opens one agent in the copy, told both versions and the branch, and opens it again while it is there', async (t) => {
  const { copy, publish } = copies(t)
  publish('0.2.4')
  const kept = updates(copy)

  const first = await kept.update()

  assert.deepEqual(first, { hobkin: 'hobkin-1', run: 'run-1', already: false })
  assert.equal(kept.started.length, 1)
  const [agent] = kept.started
  assert.deepEqual({ cwd: agent!.cwd, title: agent!.title }, { cwd: copy, title: 'Update hobkin to 0.2.4' })
  for (const fact of ['0.2.3', '0.2.4', copy, 'origin/main', 'a fast-forward should do', 'restarts into the new version by itself']) {
    assert.ok(agent!.text.includes(fact), `the agent is told: ${fact}`)
  }
  assert.equal(versionIn(copy), '0.2.3', 'the host itself changes nothing in the copy')

  assert.deepEqual(await kept.update(), { hobkin: 'hobkin-1', run: null, already: true }, 'a second press opens the same agent')
  assert.equal(kept.started.length, 1)
  kept.ended.add('hobkin-1')
  await kept.update()
  assert.equal(kept.started.length, 2, 'once that agent is ended, Update starts another')

  const unkept = updates(copy, { restarts: false })
  await unkept.update()
  assert.ok(unkept.started[0]!.text.includes('Tell the user to restart hobkin'), 'a host the app does not keep has the agent say the user restarts it')
})

test('a copy on another branch, with uncommitted changes, or with commits its origin lacks reads what is in the way, and its agent is told', async (t) => {
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
  const cases: [string, (copy: string) => void, string][] = [
    ['another branch', onAnotherBranch, 'This copy is on feature, not main.'],
    ['uncommitted changes', withUncommittedChanges, 'This copy has uncommitted changes.'],
    ['its own commit', withItsOwnCommit, 'This copy has commits that main on origin does not have.'],
  ]

  for (const [what, make, inTheWay] of cases) {
    const { copy, publish } = copies(t)
    publish('0.2.4')
    make(copy)
    const head = git(copy, 'rev-parse', 'HEAD')
    const copyUpdates = updates(copy)

    const status = await copyUpdates.read()
    await copyUpdates.update()

    assert.deepEqual({ available: status.available, inTheWay: status.inTheWay }, { available: true, inTheWay }, what)
    assert.ok(copyUpdates.started[0]!.text.includes(inTheWay), `${what}: the agent is told`)
    assert.equal(git(copy, 'rev-parse', 'HEAD'), head, `${what}: the host leaves the copy where it was`)
  }
})

test("a look that can't reach the origin says so, a host that is not live or not a checkout never runs git, and Update then opens no agent", async (t) => {
  const { copy, origin } = copies(t)
  const newest = updates(copy)
  await assert.rejects(newest.update(), /0\.2\.3, the newest on GitHub/)

  rmSync(origin, { recursive: true, force: true })
  const unreachable = updates(copy)
  const status = await unreachable.read()
  assert.deepEqual({ current: status.current, newest: status.newest, available: status.available }, { current: '0.2.3', newest: null, available: false })
  assert.match(status.problem ?? '', /could not be reached/)
  await assert.rejects(unreachable.update(), /could not be reached/)

  const scripted = counted()
  const notLive = updates(copy, { looks: false, run: scripted.run })
  assert.match((await notLive.read()).problem ?? '', /live/)
  await assert.rejects(notLive.update(), /live/)
  assert.deepEqual(scripted.calls, [])

  const release = temporaryDirectory(t)
  writeFileSync(join(release, 'package.json'), '{ "version": "0.2.3" }\n')
  const bundled = counted()
  const inApp = await new NewVersion({ repo: release, looks: true, run: bundled.run }).read()
  assert.deepEqual({ current: inApp.current, available: inApp.available }, { current: '0.2.3', available: false })
  assert.match(inApp.problem ?? '', /not run from a git checkout/)
  assert.deepEqual(bundled.calls, [])

  for (const nothing of [newest, unreachable, notLive]) assert.deepEqual(nothing.started, [])
})

test('a look holds six hours, and one that failed is made again after half an hour', async (t) => {
  const { copy, origin, publish } = copies(t)
  let now = Date.parse('2026-11-27T12:00:00Z')
  const { run, calls } = counted()
  const versions = new NewVersion({ repo: copy, looks: true, run, now: () => now })
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
