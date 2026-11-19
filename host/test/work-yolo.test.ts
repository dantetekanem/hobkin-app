import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runWorkCommand } from 'hobkin/src/cli/work/commands.mjs'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'
import { workFrom, workHandlers, type WorkApp } from '../src/work.ts'
import { temporaryDirectory } from './support.ts'

/** Stands in for hobkin's application: it only writes down what it was asked. */
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

const score = (value: number) => ({ score: value, evidence: 'What the review saw.' })

/** A finished change as hobkin lists it, with what its review scored it (`readyRow` in its `src/cli/work/reads.mjs`). */
const change = (item: string, review: Record<string, unknown> | null) => ({
  slug: 'api',
  project: 'api',
  item,
  title: `Change ${item}`,
  grade: 'P1',
  branch: `hobkin/${item}-change`,
  head: `${item}${'0'.repeat(34)}`,
  proof: 'pnpm test passes',
  behind: 0,
  conflict: false,
  size: { additions: 10, deletions: 2, files: 2 },
  safety: null,
  gap: 'land',
  holds: 0,
  proved: true,
  review,
})

const scoresOn = (rows: ReturnType<typeof change>[]) =>
  Object.fromEntries(
    workFrom({ work: { enabled: true, plan: [], projects: [] }, waiting: { branches: rows } })!
      .finished.flatMap(({ changes }) => changes)
      .map(({ item, scores }) => [item, scores]),
  )

test("a finished change's card says its kind, rate and scores", () => {
  const scores = { coverage: score(8), proof: score(8), safety: score(9), visibility: score(8), rollback: score(9) }
  const said = scoresOn([
    change('aaaaaa', { kind: 'bug-fix', rate: 8.4, scores, floors: [], stale: false }),
    change('bbbbbb', { kind: 'feature', rate: 9, scores: { ...scores, safety: score(7) }, floors: [{ criterion: 'safety', score: 7, needs: 8 }], stale: true }),
    change('cccccc', null),
  ])

  assert.equal(said.aaaaaa, 'Bug fix, general rate 8.4: coverage 8, proof 8, deploy and data 9, visibility 8, rollback 9.')
  assert.equal(
    said.bbbbbb,
    'Feature, general rate 9: coverage 8, proof 8, deploy and data 7, visibility 8, rollback 9. Held whatever the rate: deploy and data is under 8. Scored on an older commit, not this one.',
  )
  assert.equal(said.cccccc, null)
})

test('only the window changes YOLO mode', async (t) => {
  // hobkin's own store in a home of the test's.
  const root = temporaryDirectory(t)
  const { app, calls } = fakeHobkin()
  const handlers = workHandlers({ app: () => app, root: () => root })
  const reported = async () => workFrom({ work: await runWorkCommand(root, []), waiting: null })!.yolo!

  assert.deepEqual(await reported(), { on: false, rate: 8, lowest: 6, highest: 10, ready: 0, projects: [] }, 'off until the user turns it on')

  // hobkin's own tool is refused, and does not even list it.
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })
  await assert.rejects(tool.execute('1', { action: 'run', name: 'work.yolo', args: { on: true } }), /needs the user's yes in the window/)
  const listed = (JSON.parse((await tool.execute('2', { action: 'list' })).content[0]!.text) as { name: string }[]).map(({ name }) => name)
  assert.equal(listed.includes('work.yolo'), false)
  assert.equal((await reported()).on, false)

  // The window's own command turns it on, and the window hears of it at once.
  assert.deepEqual(await runCommand(handlers, 'work.yolo', { on: true }), { ok: true, value: { on: true, rate: 8 } })
  assert.deepEqual(await runCommand(handlers, 'work.yolo', { rate: 9 }), { ok: true, value: { on: true, rate: 9 } })
  assert.deepEqual([(await reported()).on, (await reported()).rate], [true, 9])
  assert.deepEqual(calls, [['refresh'], ['refresh']])

  for (const args of [{ rate: 5 }, { rate: 11 }, { rate: 7.5 }, {}, { on: 'yes' }]) {
    const refused = await runCommand(handlers, 'work.yolo', args)
    assert.equal(!refused.ok && refused.error.code, 'invalid-arguments', JSON.stringify(args))
  }
  assert.deepEqual([(await reported()).on, (await reported()).rate], [true, 9])
})
