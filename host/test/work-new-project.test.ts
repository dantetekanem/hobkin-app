import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { COMMANDS } from '#shared/commands/registry.ts'
import type { FolderLook, NewProjectDone } from '#shared/protocol/work.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'
import { newProjectHandlers, type NewProjectRuntime } from '../src/work-new-project.ts'
import { temporaryDirectory } from './support.ts'

type Known = { slug: string; name?: string; path?: string; remote?: string; state?: string }
type Added = { root: string; path: string; kind: string; wants?: string; level: string }

/** A home of the test's own with a repository, a plain folder, a file and a link, and a fake hobkin that records what it is asked. */
function world(t: Parameters<typeof temporaryDirectory>[0], projects: (paths: Record<string, string>) => Known[] = () => []) {
  const base = temporaryDirectory(t)
  const home = join(base, 'home')
  const repo = join(home, 'code', 'storefront')
  const plain = join(home, 'code', 'notes')
  const file = join(home, 'code', 'readme.txt')
  const link = join(home, 'code', 'alias')
  const worktree = join(home, 'code', 'wt')
  mkdirSync(join(repo, '.git'), { recursive: true })
  mkdirSync(plain, { recursive: true })
  mkdirSync(worktree)
  writeFileSync(join(worktree, '.git'), 'gitdir: /elsewhere')
  writeFileSync(file, 'x')
  symlinkSync(repo, link)
  const paths = { repo, plain, file, link, worktree, home }
  const added: Added[] = []
  const refreshed: string[] = []
  let answer: (() => unknown) | null = null
  const runtime: NewProjectRuntime = {
    readProjects: () => projects(paths),
    newProject: async (root, request) => {
      added.push({ root, ...request })
      if (answer) return answer() as never
      return { ok: true, message: `Took ${request.path}.`, slug: 'storefront', name: 'storefront', kind: request.kind }
    },
  }
  const handlers = newProjectHandlers({ root: () => '/root', refresh: async () => void refreshed.push('refresh'), runtime, home })
  const look = async (folder: string) => {
    const outcome = await runCommand(handlers, 'work.project.look', { folder })
    assert.ok(outcome.ok)
    return outcome.value as FolderLook
  }
  const add = (args: Record<string, unknown>) => runCommand(handlers, 'work.project.new', args)
  return { paths, added, refreshed, look, add, answerWith: (next: () => unknown) => (answer = next), handlers, withoutFunction: newProjectHandlers({ root: () => '/root', refresh: async () => {}, runtime: { readProjects: runtime.readProjects }, home }) }
}

const refusedWith = (outcome: { ok: boolean; error?: { message: string } }, words: RegExp) => !outcome.ok && words.test(outcome.error?.message ?? '')

test('the look says what is at the folder, for each thing it can be', async (t) => {
  const { paths, look } = world(t)
  const none = { folder: null, name: null, git: false, known: null, namesake: null }
  assert.deepEqual(await look(join(paths.home, 'nothing')), { typed: join(paths.home, 'nothing'), found: 'missing', ...none })
  assert.deepEqual(await look(paths.file), { typed: paths.file, found: 'file', ...none })
  assert.deepEqual(await look(paths.plain), { typed: paths.plain, found: 'folder', folder: paths.plain, name: 'notes', git: false, known: null, namesake: null })
  assert.deepEqual(await look(paths.repo), { typed: paths.repo, found: 'folder', folder: paths.repo, name: 'storefront', git: true, known: null, namesake: null })
  // A worktree's .git is a file, and still a repository of its own.
  assert.equal((await look(paths.worktree)).git, true)
  // A link is the folder it points to.
  const linked = await look(paths.link)
  assert.deepEqual([linked.found, linked.folder, linked.git, linked.name], ['folder', paths.repo, true, 'storefront'])
  // Not absolute reads as missing, and so does a blank.
  assert.equal((await look('code/storefront')).found, 'missing')
})

test('~ and ~/... mean the home folder', async (t) => {
  const { paths, look } = world(t)
  assert.equal((await look('~')).folder, paths.home)
  const under = await look('~/code/storefront')
  assert.deepEqual([under.found, under.folder, under.git, under.typed], ['folder', paths.repo, true, '~/code/storefront'])
  assert.equal((await look('~storefront')).found, 'missing')
})

test('the look finds the project Work has for this very folder by any spelling, and another folder under its name', async (t) => {
  const { paths, look } = world(t, ({ repo, link }) => [{ slug: 'storefront', name: 'Storefront', path: repo, state: 'skipped' }, { slug: 'notes', path: '/elsewhere/notes', state: 'chosen' }, { slug: 'other', path: link, state: 'chosen' }])
  assert.deepEqual((await look(paths.repo)).known, { slug: 'storefront', name: 'Storefront', state: 'skipped' })
  assert.equal((await look(paths.repo)).namesake, null)
  // The same folder, written as a link and as ~.
  assert.equal((await look('~/code/storefront')).known?.slug, 'storefront')
  assert.equal((await look(paths.link)).known?.slug, 'storefront')
  // Another folder with the same project name.
  const notes = await look(paths.plain)
  assert.equal(notes.known, null)
  assert.equal(notes.namesake, '/elsewhere/notes')
})

test('the look reads only: it never calls hobkin to add and never refreshes', async (t) => {
  const { paths, look, added, refreshed } = world(t)
  await look(paths.repo)
  assert.deepEqual([added, refreshed], [[], []])
})

test('an add passes hobkin the real folder, the kind and the words, then reads hobkin again', async (t) => {
  const { paths, add, added, refreshed } = world(t)
  const outcome = await add({ folder: '~/code/alias', kind: 'code', wants: '  Make checkout faster.  ' })
  assert.deepEqual(outcome, { ok: true, value: { slug: 'storefront', name: 'storefront', kind: 'code', message: `Took ${paths.repo}.` } satisfies NewProjectDone })
  assert.deepEqual(added, [{ root: '/root', path: paths.repo, kind: 'code', wants: '  Make checkout faster.  ', level: 'important' }])
  assert.deepEqual(refreshed, ['refresh'])
  // Code needs no words, and a goal may live in a folder with no repository.
  await add({ folder: paths.repo, kind: 'code' })
  assert.equal(added[1]?.wants, undefined)
  assert.equal((await add({ folder: paths.plain, kind: 'goal', wants: 'Plan the move.' })).ok, true)
  assert.equal(added[2]?.kind, 'goal')
})

test('an add refuses in plain words what cannot be added, and calls hobkin for none of it', async (t) => {
  const { paths, add, added, refreshed } = world(t, ({ repo }) => [{ slug: 'storefront', path: repo, state: 'chosen' }, { slug: 'notes', path: '/elsewhere/notes', state: 'chosen' }])
  assert.ok(refusedWith(await add({ folder: join(paths.home, 'nothing'), kind: 'goal', wants: 'x' }) as never, /There is no folder at/))
  assert.ok(refusedWith(await add({ folder: paths.file, kind: 'goal', wants: 'x' }) as never, /is a file, not a folder/))
  assert.ok(refusedWith(await add({ folder: paths.link, kind: 'code' }) as never, /Work already has this folder as storefront \(chosen\)/))
  assert.ok(refusedWith(await add({ folder: paths.plain, kind: 'goal', wants: 'x' }) as never, /already has a project named notes, at \/elsewhere\/notes/))
  assert.deepEqual([added, refreshed], [[], []])
})

test('code in a folder with no repository is refused, and a goal there is not', async (t) => {
  const { paths, add, added } = world(t)
  assert.ok(refusedWith(await add({ folder: paths.plain, kind: 'code' }) as never, /not a git repository/))
  assert.deepEqual(added, [])
  assert.equal((await add({ folder: paths.plain, kind: 'goal', wants: 'Sort the notes.' })).ok, true)
})

test('a goal needs words that are not blank, before any handler runs', async (t) => {
  const { paths, add, added } = world(t)
  for (const wants of [undefined, '', '   \n']) {
    const outcome = await add({ folder: paths.plain, kind: 'goal', ...(wants === undefined ? {} : { wants }) })
    assert.equal(outcome.ok, false)
  }
  assert.equal((await add({ folder: paths.plain, kind: 'tomb', wants: 'x' })).ok, false)
  assert.deepEqual(added, [])
})

test("hobkin's refusal is passed on in its words, and nothing is refreshed", async (t) => {
  const { paths, add, answerWith, refreshed } = world(t)
  answerWith(() => {
    throw Error('Work mode needs a folder first.')
  })
  const outcome = await add({ folder: paths.repo, kind: 'code' })
  assert.deepEqual(outcome, { ok: false, error: { code: 'failed', message: 'Work mode needs a folder first.' } })
  assert.deepEqual(refreshed, [])
})

test('a hobkin without the function says it cannot add from here yet', async (t) => {
  const { paths, withoutFunction } = world(t)
  const outcome = await runCommand(withoutFunction, 'work.project.new', { folder: paths.repo, kind: 'code' })
  assert.deepEqual(outcome, { ok: false, error: { code: 'unavailable', message: 'This hobkin cannot add a project from here yet. Update hobkin.' } })
  // The look still works without it.
  assert.equal((await runCommand(withoutFunction, 'work.project.look', { folder: paths.repo })).ok, true)
})

test("hobkin's client tool lists the look and the add, and runs them through the host", async (t) => {
  const { paths, handlers } = world(t)
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })
  const listed = ((await tool.execute('1', { action: 'list' })).details as { name: string }[]).map((command) => command.name)
  assert.ok(listed.includes('work.project.look') && listed.includes('work.project.new'))
  assert.equal(COMMANDS['work.project.look'].hobkin, true)
  await tool.execute('2', { action: 'run', name: 'work.project.look', args: { folder: paths.repo } })
})
