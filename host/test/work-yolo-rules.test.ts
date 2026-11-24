import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import * as hobkinYolo from 'hobkin/src/cli/work/yolo.mjs'
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

/** A runtime that keeps what it was given and refuses what it is told to, as hobkin's own setter does with a value out of range. */
function fakeRules() {
  const calls: unknown[][] = []
  const setYoloRules = (...args: unknown[]) => {
    calls.push(args)
    const change = args[2] as Record<string, unknown>
    if ((change.lowestRate as number) > 10) throw new Error('The lowest general rate is from 1 to 10.')
    return { lowestRate: 8.4, mostLines: null }
  }
  return { calls, yolo: { setYoloRules: setYoloRules as never } }
}

test('work.yolo.rules is outside: only the window sends it, and the runtime\'s refusal passes on in its words', async () => {
  const { app, calls } = fakeHobkin()
  const rules = fakeRules()
  const handlers = workHandlers({ app: () => app, root: () => '/home/none', yolo: rules.yolo })

  assert.deepEqual(await runCommand(handlers, 'work.yolo.rules', { rules: { lowestRate: 8.4 } }), {
    ok: true,
    value: { slug: null, rules: { lowestRate: 8.4, mostLines: null } },
  })
  assert.deepEqual(rules.calls, [['/home/none', null, { lowestRate: 8.4 }]])
  assert.deepEqual(calls, [['refresh']], 'the window hears of it at once, and no work action ran')

  assert.equal((await runCommand(handlers, 'work.yolo.rules', { slug: 'web', rules: { mostLines: null }, clear: ['lowestRate'] })).ok, true)
  assert.deepEqual(rules.calls[1], ['/home/none', 'web', { mostLines: null, same: ['lowestRate'] }])

  // The runtime's sentence, as it wrote it, and no refresh for a change it refused.
  const refused = await runCommand(handlers, 'work.yolo.rules', { rules: { lowestRate: 11 } })
  assert.deepEqual(refused, { ok: false, error: { code: 'failed', message: 'The lowest general rate is from 1 to 10.' } })
  assert.deepEqual(calls, [['refresh'], ['refresh']])

  // hobkin's own tool neither lists it nor runs it.
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })
  await assert.rejects(tool.execute('1', { action: 'run', name: 'work.yolo.rules', args: { rules: { lowestRate: 1 } } }), /needs the user's yes in the window/)
  const listed = (JSON.parse((await tool.execute('2', { action: 'list' })).content[0]!.text) as { name: string }[]).map(({ name }) => name)
  assert.equal(listed.includes('work.yolo.rules'), false)
  assert.equal(rules.calls.length, 3, 'nothing reached the runtime from the tool')

  for (const args of [{}, { rules: {} }, { clear: ['lowestRate'] }, { slug: 'web', rules: { a: 1 }, clear: ['a'] }, { rules: { a: { deep: 1 } } }]) {
    const bad = await runCommand(handlers, 'work.yolo.rules', args)
    assert.equal(!bad.ok && bad.error.code, 'invalid-arguments', JSON.stringify(args))
  }
})

test('with a hobkin that has no rules, setting one says so, and the window gets none from it', async () => {
  const { app } = fakeHobkin()
  const older = workHandlers({ app: () => app, root: () => '/home/none', yolo: {} })
  assert.deepEqual(await runCommand(older, 'work.yolo.rules', { rules: { lowestRate: 8 } }), {
    ok: false,
    error: { code: 'unavailable', message: 'This hobkin has no YOLO rules to set yet. Update hobkin.' },
  })

  const sent = { on: true, rate: 8, lowest: 6, highest: 10, ready: 0, projects: [{ slug: 'api', name: 'api', ready: false, needs: [], changes: [{ item: 'a', title: 'A', kind: null, rate: null, why: 'x' }] }] }
  const yolo = workFrom({ work: { enabled: true, plan: [], projects: [], yolo: sent }, waiting: null })!.yolo!
  assert.equal('rules' in yolo, false)
  assert.equal('rules' in yolo.projects[0]!, false)
  assert.equal('overrides' in yolo.projects[0]!, false)
  assert.equal('holdBy' in yolo.projects[0]!.changes![0]!, false)
})

test('rules, the ones a project sets for itself and the setting that holds a change reach the window as the runtime sent them, and only well-formed', () => {
  const sent = {
    on: true,
    rate: 8,
    lowest: 1,
    highest: 10,
    ready: 1,
    rules: { lowestRate: 8, mostLines: null, kinds: ['bug-fix'], bad: { a: 1 } },
    projects: [
      {
        slug: 'api',
        name: 'api',
        ready: true,
        needs: [],
        rules: { lowestRate: 7 },
        overrides: ['lowestRate'],
        changes: [
          { item: 'a', title: 'A', kind: null, rate: null, why: 'Its rate is under 8.', holdBy: 'lowestRate' },
          { item: 'b', title: 'B', kind: null, rate: null, why: null, holdBy: 4 },
        ],
      },
      { slug: 'web', name: 'web', ready: true, needs: [], rules: 'on', overrides: [1] },
    ],
  }
  const yolo = workFrom({ work: { enabled: true, plan: [], projects: [], yolo: sent }, waiting: null })!.yolo!
  assert.deepEqual(yolo.rules, { lowestRate: 8, mostLines: null, kinds: ['bug-fix'] })
  assert.deepEqual(yolo.projects[0]!.rules, { lowestRate: 7 })
  assert.deepEqual(yolo.projects[0]!.overrides, ['lowestRate'])
  assert.deepEqual(yolo.projects[0]!.changes!.map((change) => change.holdBy), ['lowestRate', undefined])
  assert.equal('rules' in yolo.projects[1]!, false)
  assert.equal('overrides' in yolo.projects[1]!, false)
})

test('against the real runtime: rules set for all projects and for one come back in the snapshot, a refusal writes nothing, and the answer is in the runtime\'s words', { skip: typeof (hobkinYolo as { setYoloRules?: unknown }).setYoloRules !== 'function' }, async (t) => {
  const root = temporaryDirectory(t)
  const folder = join(root, 'checkouts', 'api')
  mkdirSync(folder, { recursive: true })
  chooseProject(root, folder, 'important')
  const { app } = fakeHobkin()
  const handlers = workHandlers({ app: () => app, root: () => root })
  const seen = async () => workFrom({ work: await runWorkCommand(root, []), waiting: null })!.yolo!

  const set = await runCommand(handlers, 'work.yolo.rules', { rules: { lowestRate: 8.4, mostLines: null } })
  assert.equal(set.ok && (set.value as { rules: Record<string, unknown> }).rules.lowestRate, 8.4)
  assert.equal((await runCommand(handlers, 'work.yolo.rules', { slug: 'api', rules: { mostAreas: 4 } })).ok, true)
  const yolo = await seen()
  assert.equal(yolo.rules?.mostLines, null)
  assert.equal(yolo.projects[0]!.rules?.mostAreas, 4)
  assert.deepEqual(yolo.projects[0]!.overrides, ['mostAreas'])

  const refused = await runCommand(handlers, 'work.yolo.rules', { rules: { lowestRate: 11, mostLines: 50 } })
  assert.deepEqual(!refused.ok && refused.error.message, 'The lowest general rate is from 1 to 10.')
  assert.equal((await seen()).rules?.mostLines, null, 'nothing was written when one value was refused')

  assert.equal((await runCommand(handlers, 'work.yolo.rules', { slug: 'api', clear: ['mostAreas'] })).ok, true)
  assert.equal((await seen()).projects[0]!.overrides?.length, 0)
})
