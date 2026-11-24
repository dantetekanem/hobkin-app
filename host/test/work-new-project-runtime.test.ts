import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runWorkCommand } from 'hobkin/src/cli/work/commands.mjs'
import { readProjects } from 'hobkin/src/cli/work/store.mjs'
import { newProjectHandlers } from '../src/work-new-project.ts'
import { workFrom } from '../src/work.ts'
import { temporaryDirectory } from './support.ts'

/**
 * New project against hobkin's own functions, in a home of the test's own (059-new-project): the seam the fakes in
 * `work-new-project.test.ts` stand in for. Nothing runs here but the add and the reads.
 */

const git = (folder: string, ...args: string[]) => execFileSync('git', ['-C', folder, ...args], { encoding: 'utf8' }).trim()

type Record = { slug: string; kind?: string; state?: string; path?: string }

/** A temporary hobkin home, and a folder of the user's with a plain folder and a repository in it. */
function world(t: Parameters<typeof temporaryDirectory>[0]) {
  const base = temporaryDirectory(t)
  const root = join(base, 'hobkin-home')
  const home = join(base, 'user')
  const plain = join(home, 'papers', 'thesis')
  const repository = join(home, 'code', 'storefront')
  mkdirSync(root, { recursive: true })
  mkdirSync(plain, { recursive: true })
  mkdirSync(join(repository, '.git'), { recursive: true })
  writeFileSync(join(plain, 'plan.md'), '# Plan\n')

  const handlers = newProjectHandlers({ root: () => root, refresh: async () => {}, home })
  const look = handlers['work.project.look']
  const add = handlers['work.project.new']
  assert.ok(look && add)

  const directions = (slug: string) => join(root, 'work', slug, 'directions.md')
  const record = (slug: string) => (readProjects(root) as Record[]).find((project) => project.slug === slug)
  return { root, plain, repository, look, add, directions, record }
}

test('a folder that is no repository is added as a goal: hobkin takes it with its kind, and the words are its directions', async (t) => {
  const { root, plain, look, add, directions, record } = world(t)
  const wants = 'Get the thesis submitted. Tell me what only I can sign.'

  const before = await look({ folder: '~/papers/thesis' })
  const added = await add({ folder: '~/papers/thesis', kind: 'goal', wants })
  const after = await look({ folder: plain })

  assert.deepEqual({ found: before.found, git: before.git, known: before.known }, { found: 'folder', git: false, known: null })
  assert.deepEqual({ slug: added.slug, name: added.name, kind: added.kind }, { slug: 'thesis', name: 'thesis', kind: 'goal' })
  assert.match(added.message, /goal/)
  assert.deepEqual({ kind: record('thesis')?.kind, state: record('thesis')?.state }, { kind: 'goal', state: 'chosen' })
  assert.equal(readFileSync(directions('thesis'), 'utf8').trim(), wants)
  assert.deepEqual(after.known, { slug: 'thesis', name: 'thesis', state: 'chosen' })

  // Every project has a repository of its own: hobkin started one here, with what the folder held and no remote.
  assert.match(added.message, /started a git repository/)
  assert.equal(git(plain, 'ls-files'), 'plan.md')
  assert.equal(git(plain, 'rev-list', '--count', 'HEAD'), '1')
  assert.equal(git(plain, 'status', '--porcelain'), '')
  assert.equal(git(plain, 'remote'), '')

  // What the window is sent: hobkin's status in a snapshot, folded as the Work screen reads it.
  const snapshot = { work: await runWorkCommand(root, []) } as Parameters<typeof workFrom>[0]
  const shown = workFrom(snapshot)?.projects.find((project) => project.slug === 'thesis')
  assert.deepEqual({ kind: shown?.kind, done: shown?.done, state: shown?.state }, { kind: 'goal', done: 0, state: 'chosen' })
})

test('a repository is added as code as it is, a folder with none is added as code with one started, and a second add is refused', async (t) => {
  const { repository, plain, add, directions, record } = world(t)

  const added = await add({ folder: repository, kind: 'code', wants: 'Keep checkout fast.' })
  const fromPlain = await add({ folder: plain, kind: 'code' })

  assert.equal(added.kind, 'code')
  assert.doesNotMatch(added.message, /started a git repository/, 'a folder that holds a repository is left as it is')
  assert.equal(record('storefront')?.kind, undefined, 'a code project carries no kind')
  assert.equal(readFileSync(directions('storefront'), 'utf8').trim(), 'Keep checkout fast.')

  assert.equal(fromPlain.kind, 'code')
  assert.equal(existsSync(join(plain, '.git')), true)
  assert.equal(git(plain, 'rev-list', '--count', 'HEAD'), '1')

  await assert.rejects(() => Promise.resolve(add({ folder: repository, kind: 'code' })), /Work already has this folder as storefront, taken\./)
})
