import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runWorkCommand } from 'hobkin/src/cli/work/commands.mjs'
import { chooseProject, readMode, readProjects, startWork } from 'hobkin/src/cli/work/store.mjs'
import type { SetupWorkDone } from '#shared/protocol/setup.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import { runCommand } from '../src/commands.ts'
import { fateOf, HOBKIN_WORK, setupWorkHandlers, type PickedFacts, type SetupWorkRuntime } from '../src/setup-work.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

/** A folder of projects in a test's own place: a git repository and a plain folder. Nothing here runs git. */
function projectsIn(t: Parameters<typeof temporaryDirectory>[0]) {
  const folder = join(temporaryDirectory(t), 'code')
  const repo = join(folder, 'storefront')
  const plain = join(folder, 'notes')
  mkdirSync(join(repo, '.git'), { recursive: true })
  mkdirSync(plain, { recursive: true })
  return { folder, repo, plain }
}

/** The handler on a home of the test's, with hobkin's own work functions unless others are given. */
function setupWorkOn(root: string, runtime: SetupWorkRuntime = HOBKIN_WORK) {
  const refreshed: string[] = []
  const handlers = setupWorkHandlers({ root: () => root, refresh: async () => void refreshed.push('refresh'), runtime })
  const work = async (folder: string, projects: string[]): Promise<SetupWorkDone> => {
    const outcome = await runCommand(handlers, 'setup.work', { folder, projects })
    if (!outcome.ok) throw Error(outcome.error.message)
    return outcome.value as SetupWorkDone
  }
  return { work, refreshed }
}

const stateOf = (root: string, path: string) => readProjects(root).find((project) => project.path === path)?.state ?? null

test('what the setup does with a picked project, for each state of the project and of work mode', () => {
  const fresh: PickedFacts = { known: null, namesake: null, folder: true, git: true }
  const off = { enabled: false, autoPick: true }
  const choosing = { enabled: true, autoPick: false }
  const pickingByItself = { enabled: true, autoPick: true }

  // Work mode off, or on and waiting for the user's pick: taking starts nothing.
  assert.equal(fateOf(fresh, off).outcome, 'taken')
  assert.equal(fateOf(fresh, choosing).outcome, 'taken')
  // On and picking by itself, a taken project would start a paid study at once, so it is only offered.
  assert.equal(fateOf(fresh, pickingByItself).outcome, 'proposed')

  // A project work mode already knows, in any state, stays as it is, whatever work mode is doing.
  for (const known of ['chosen', 'proposed', 'skipped', 'dropped']) {
    for (const mode of [off, choosing, pickingByItself]) {
      const fate = fateOf({ ...fresh, known }, mode)
      assert.equal(fate.outcome, 'left', `${known} with ${JSON.stringify(mode)}`)
      assert.equal(fate.why, 'known')
    }
  }
  assert.match(fateOf({ ...fresh, known: 'skipped' }, off).reason ?? '', /skipped/)

  const skippedFor = (facts: Partial<PickedFacts>) => {
    const { outcome, why } = fateOf({ ...fresh, ...facts }, off)
    return [outcome, why]
  }
  assert.deepEqual(skippedFor({ git: false }), ['skipped', 'not-git'])
  assert.deepEqual(skippedFor({ folder: false, git: false }), ['skipped', 'not-folder'])
  assert.deepEqual(skippedFor({ namesake: '/elsewhere/storefront' }), ['skipped', 'namesake'])
  const namesakeFate = fateOf({ ...fresh, namesake: '/elsewhere/storefront' }, off)
  assert.match(namesakeFate.reason ?? '', /\/elsewhere\/storefront/)

  // Taken or offered has nothing to explain.
  assert.deepEqual(fateOf(fresh, off), { outcome: 'taken', why: null, reason: null })
  assert.deepEqual(fateOf(fresh, pickingByItself), { outcome: 'proposed', why: null, reason: null })
})

test('with work mode off, a picked repository is taken, the folder is saved, and work mode stays off', async (t) => {
  const root = temporaryDirectory(t)
  const { folder, repo } = projectsIn(t)
  const { work, refreshed } = setupWorkOn(root)

  const done = await work(folder, [repo])

  assert.deepEqual(done.folder, { typed: folder, saved: folder, changed: true, problem: null })
  assert.deepEqual(done.workMode, { enabled: false, autoPick: true })
  assert.deepEqual(done.projects, [{ path: repo, name: 'storefront', outcome: 'taken', why: null, reason: null }])
  assert.equal(stateOf(root, repo), 'chosen')
  assert.equal(readMode(root).enabled, false, 'the setup never turns work mode on')
  assert.equal(readMode(root).folder, folder, 'work mode will start from the folder that was named')
  assert.deepEqual(refreshed, ['refresh'], "hobkin's state is read again, so the Work screen shows it")

  // The same again changes nothing: the folder is there, and the project is known now.
  const again = await work(folder, [repo])
  assert.equal(again.folder.changed, false)
  assert.deepEqual(again.projects.map(({ outcome, why }) => [outcome, why]), [['left', 'known']])
  assert.equal(stateOf(root, repo), 'chosen')
})

test('with work mode on and picking by itself, a picked repository is only proposed, and the running folder is kept', async (t) => {
  const root = temporaryDirectory(t)
  const { folder, repo } = projectsIn(t)
  const running = temporaryDirectory(t)
  // A home of the test's, with no hobkin open in it, so nothing ever plans or starts here.
  startWork(root, running, { autoPick: true })
  const { work } = setupWorkOn(root)

  const done = await work(folder, [repo])

  assert.deepEqual(done.workMode, { enabled: true, autoPick: true })
  assert.deepEqual(done.projects.map(({ outcome }) => outcome), ['proposed'])
  assert.equal(stateOf(root, repo), 'proposed', 'it waits in Work for the user to take')
  assert.deepEqual(done.folder, { typed: folder, saved: running, changed: false, problem: null })
  assert.equal(readMode(root).folder, running)
  assert.equal(readMode(root).enabled, true)
})

test('with work mode on and waiting for the user, a picked repository is taken', async (t) => {
  const root = temporaryDirectory(t)
  const { folder, repo } = projectsIn(t)
  startWork(root, folder)
  const { work } = setupWorkOn(root)

  const done = await work(folder, [repo])

  assert.deepEqual(done.workMode, { enabled: true, autoPick: false })
  assert.deepEqual(done.projects.map(({ outcome }) => outcome), ['taken'])
  assert.equal(stateOf(root, repo), 'chosen')
})

test('a project the user skipped before is left as it is, and so is one with a known name', async (t) => {
  const root = temporaryDirectory(t)
  const { folder, repo } = projectsIn(t)
  const { slug } = chooseProject(root, repo, 'important')
  await runWorkCommand(root, ['skip', slug])
  assert.equal(stateOf(root, repo), 'skipped')
  // Another folder by the same name, somewhere else.
  const other = join(temporaryDirectory(t), 'storefront')
  mkdirSync(join(other, '.git'), { recursive: true })
  const { work } = setupWorkOn(root)

  const done = await work(folder, [repo, other])

  assert.deepEqual(done.projects.map(({ outcome, why }) => [outcome, why]), [['left', 'known'], ['skipped', 'namesake']])
  assert.equal(stateOf(root, repo), 'skipped', 'taking it again would undo the user\'s own word')
  assert.equal(stateOf(root, other), null)
})

test('a folder that is not a git repository, or not there, is skipped with the reason', async (t) => {
  const root = temporaryDirectory(t)
  const { folder, repo, plain } = projectsIn(t)
  const gone = join(folder, 'gone')
  const { work } = setupWorkOn(root)

  const done = await work(folder, [plain, gone, repo])

  assert.deepEqual(done.projects.map(({ name, outcome, why }) => [name, outcome, why]), [
    ['notes', 'skipped', 'not-git'],
    ['gone', 'skipped', 'not-folder'],
    ['storefront', 'taken', null],
  ])
  assert.match(done.projects[0]!.reason ?? '', /git repository/)
  assert.deepEqual(readProjects(root).map(({ path }) => path), [repo])
})

test('a projects folder that is not there is reported, not thrown, and the projects are still handled', async (t) => {
  const root = temporaryDirectory(t)
  const { repo } = projectsIn(t)
  const missing = join(temporaryDirectory(t), 'nowhere')
  const { work } = setupWorkOn(root)

  const done = await work(missing, [repo])

  assert.equal(done.folder.saved, null)
  assert.equal(done.folder.changed, false)
  assert.match(done.folder.problem ?? '', /Not a folder/)
  assert.equal(readMode(root).folder, null)
  assert.deepEqual(done.projects.map(({ outcome }) => outcome), ['taken'])
})

test('a running work mode without a folder keeps none, and that is reported', async (t) => {
  const root = temporaryDirectory(t)
  const { folder } = projectsIn(t)
  const asked: string[] = []
  // An old state hobkin's own functions no longer write: on, with no folder.
  const runtime: SetupWorkRuntime = {
    ...HOBKIN_WORK,
    readMode: () => ({ enabled: true, autoPick: false }),
    setFolder: () => ({ folder: null, changed: false }),
    take: async (_root, path) => void asked.push(path),
  }
  const { work } = setupWorkOn(root, runtime)

  const done = await work(folder, [])

  assert.equal(done.folder.saved, null)
  assert.match(done.folder.problem ?? '', /running/)
  assert.deepEqual(done.projects, [])
})

test("hobkin's refusal to take a project is said in its own words, and the rest go on", async (t) => {
  const root = temporaryDirectory(t)
  const { folder, repo } = projectsIn(t)
  const runtime: SetupWorkRuntime = {
    ...HOBKIN_WORK,
    take: async () => {
      throw Error('Not a git repository: ~/code/storefront')
    },
  }
  const { work } = setupWorkOn(root, runtime)

  const done = await work(folder, [repo])

  assert.deepEqual(done.projects, [{ path: repo, name: 'storefront', outcome: 'skipped', why: 'refused', reason: 'Not a git repository: ~/code/storefront' }])
})

/** The work slice a window holds after the messages received so far. */
function workOf(client: Client): WorkState | null {
  let work: WorkState | null = null
  for (const message of client.received) {
    if (message.type !== 'state') continue
    if (message.reset) work = null
    if (message.work) work = message.work
  }
  return work
}

test('through the host: a picked repository shows in Work at once, work mode stays off, and nothing starts', async (t) => {
  const host = await hostFor(t)
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()
  await client.until(() => workOf(client)?.enabled === false, 'work mode, off')
  const { folder, repo } = projectsIn(t)

  const done = await client.run<SetupWorkDone>('setup.work', { folder, projects: [repo] })

  assert.deepEqual(done.projects.map(({ outcome }) => outcome), ['taken'])
  await client.until(() => workOf(client)?.projects.some(({ name, state }) => name === 'storefront' && state === 'chosen'), 'the project in Work')
  assert.equal(workOf(client)?.enabled, false)
  assert.equal(workOf(client)?.folder, folder)
  assert.deepEqual((client.view.snapshot.runs ?? []).filter((run) => run.state === 'running' && run.work), [])

  const relative = await client.command('setup.work', { folder, projects: ['code/storefront'] })
  assert.equal(!relative.ok && relative.error.code, 'invalid-arguments', 'a project is named by its whole path')

  // The window's own, never hobkin's through its client tool, and nothing that needs a yes outside the app.
  const { COMMANDS } = await import('#shared/commands/registry.ts')
  for (const name of ['setup.save', 'setup.saved', 'setup.work'] as const) {
    assert.equal('hobkin' in COMMANDS[name] || 'outside' in COMMANDS[name], false, name)
  }
})
