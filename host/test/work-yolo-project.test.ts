import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runWorkCommand } from 'hobkin/src/cli/work/commands.mjs'
import { chooseProject } from 'hobkin/src/cli/work/store.mjs'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'
import { workFrom, workHandlers, type WorkApp } from '../src/work.ts'
import { temporaryDirectory } from './support.ts'

/** Stands in for hobkin's application: it only writes down that the window was refreshed. */
function fakeHobkin() {
  const calls: unknown[][] = []
  const app: WorkApp = {
    workAction: async (...args: unknown[]) => {
      calls.push(args)
      return { ok: true }
    },
    refresh: async () => {
      calls.push(['refresh'])
    },
  }
  return { app, calls }
}

/** A home of the test's, with hobkin's own store, and two projects work mode works on. */
function home(t: Parameters<typeof temporaryDirectory>[0]) {
  const root = temporaryDirectory(t)
  for (const name of ['api', 'web']) {
    const folder = join(root, 'checkouts', name)
    mkdirSync(folder, { recursive: true })
    chooseProject(root, folder, 'important')
  }
  return root
}

const switches = async (root: string) =>
  Object.fromEntries(workFrom({ work: await runWorkCommand(root, []), waiting: null })!.yolo!.projects.map(({ slug, on }) => [slug, on]))

test('only the window turns YOLO mode on or off on one project, and every other project keeps its switch', async (t) => {
  const root = home(t)
  const { app, calls } = fakeHobkin()
  const handlers = workHandlers({ app: () => app, root: () => root })
  assert.deepEqual(await switches(root), { api: true, web: true }, 'a home that never set one is as it was')

  assert.deepEqual(await runCommand(handlers, 'work.yolo.project', { slug: 'web', on: false }), { ok: true, value: { slug: 'web', on: false } })
  assert.deepEqual(await switches(root), { api: true, web: false })
  assert.deepEqual(calls, [['refresh']], 'the window hears of it at once, and no work action ran')

  // hobkin's own tool is refused, and does not even list it.
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })
  await assert.rejects(tool.execute('1', { action: 'run', name: 'work.yolo.project', args: { slug: 'web', on: true } }), /needs the user's yes in the window/)
  const listed = (JSON.parse((await tool.execute('2', { action: 'list' })).content[0]!.text) as { name: string }[]).map(({ name }) => name)
  assert.equal(listed.includes('work.yolo.project'), false)
  assert.equal((await switches(root)).web, false)

  for (const args of [{ slug: 'web' }, { on: true }, { slug: 'web', on: 'yes' }, { slug: 'Not a slug', on: true }, { slug: 'web', on: true, rate: 8 }]) {
    const refused = await runCommand(handlers, 'work.yolo.project', args)
    assert.equal(!refused.ok && refused.error.code, 'invalid-arguments', JSON.stringify(args))
  }
  const unknown = await runCommand(handlers, 'work.yolo.project', { slug: 'nowhere', on: true })
  assert.match(!unknown.ok ? unknown.error.message : '', /nowhere is not a project work mode works on/)
})

test('with a hobkin that has no switch for each project, the window shows none and setting one says so', async (t) => {
  const root = home(t)
  const { app } = fakeHobkin()
  const older = workHandlers({ app: () => app, root: () => root, yolo: {} })

  assert.deepEqual(await runCommand(older, 'work.yolo.project', { slug: 'web', on: false }), {
    ok: false,
    error: { code: 'unavailable', message: 'This hobkin has no YOLO mode switch for each project yet. Update hobkin to set one from here.' },
  })
  // What an older hobkin sends: its projects without `on`, which the window reads as no switch.
  const sent = { on: true, rate: 8, lowest: 6, highest: 10, ready: 0, projects: [{ slug: 'api', name: 'api', ready: false, needs: [] }] }
  const yolo = workFrom({ work: { enabled: true, plan: [], projects: [], yolo: sent }, waiting: null })!.yolo!
  assert.equal('on' in yolo.projects[0]!, false)
})
