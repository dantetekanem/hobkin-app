import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ActivityEntry } from '#shared/protocol/activity.ts'

// The agent's page reads the review's diffs through `@/`, which points at ui/src as Vite resolves it. Here that module is
// the review's own, with each diff and each set of rows it works out counted. Components are TSX, which Node reads once
// Vite's own transformer has turned it into JavaScript, and style sheets are nothing.
const { transformSync } = (await import(createRequire(import.meta.resolve('vite')).resolve('rolldown/experimental'))) as {
  transformSync: (file: string, source: string, options: object) => { code: string }
}
const DIFF_ROWS = new URL('../src/features/review/code/diff-rows.ts', import.meta.url).href
const COUNTED = `data:text/javascript,${encodeURIComponent(`
  import * as real from ${JSON.stringify(DIFF_ROWS)}
  export * from ${JSON.stringify(DIFF_ROWS)}
  export const calls = { diffOf: 0, unifiedRows: 0 }
  export function diffOf(...args) { calls.diffOf += 1; return real.diffOf(...args) }
  export function unifiedRows(...args) { calls.unifiedRows += 1; return real.unifiedRows(...args) }
`)}`
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === '@/features/review/code/diff-rows.ts') return { url: COUNTED, shortCircuit: true }
    return next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context)
  },
  load: (url, context, next) => {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }
    if (!url.endsWith('.tsx')) return next(url, context)
    const file = fileURLToPath(url)
    return { format: 'module', source: transformSync(file, readFileSync(file, 'utf8'), { jsx: { runtime: 'automatic' } }).code, shortCircuit: true }
  },
})
const { calls } = (await import(COUNTED)) as { calls: { diffOf: number; unifiedRows: number } }
const { stepsOf } = await import('../src/features/agent-activity/steps.ts')
const { partsOf } = await import('../src/features/agent-activity/change-parts.ts')
const { ChangeDiff } = await import('../src/features/agent-activity/ChangeDiff.tsx')

type Parts = ReturnType<typeof partsOf>
type Change = Extract<ReturnType<typeof stepsOf>[number], { kind: 'change' }>['change']

const edit = (id: string, path: string, oldText: string, newText: string, state: ActivityEntry['state'] = 'completed'): ActivityEntry => ({
  id: `tool:${id}`,
  kind: 'tool',
  name: 'edit',
  state,
  input: JSON.stringify({ path, edits: [{ oldText, newText }] }),
})
const changesOf = (entries: readonly ActivityEntry[], ended = false) => stepsOf(entries, { ended }).flatMap((step) => (step.kind === 'change' ? [step.change] : []))
const changeOf = (entries: readonly ActivityEntry[]) => changesOf(entries).at(-1)!

/** What `run` asked of the review's diffs. */
function counting<Value>(run: () => Value): { value: Value; diffs: number; rows: number } {
  calls.diffOf = 0
  calls.unifiedRows = 0
  const value = run()
  return { value, diffs: calls.diffOf, rows: calls.unifiedRows }
}

test('each new edit to a file diffs only the place it changed, and the newest call finishing diffs nothing', () => {
  const five = [1, 2, 3, 4, 5].map((n) => edit(`${n}`, 'src/a.ts', `line ${n}`, `line ${n} changed`))
  const first = counting(() => partsOf(changeOf(five)))
  assert.equal(first.diffs, 5)

  // A sixth edit, still running: only its own place is new.
  const sixth = counting(() => partsOf(changeOf([...five, edit('6', 'src/a.ts', 'line 6', 'line 6 changed', 'running')]), first.value))
  assert.equal(sixth.diffs, 1)

  // It finishes: the same places, so nothing to diff.
  const finished = [...five, edit('6', 'src/a.ts', 'line 6', 'line 6 changed')]
  const done = counting(() => partsOf(changeOf(finished), sixth.value))
  assert.equal(done.diffs, 0)
  assert.ok(done.value.every((part, index) => part === sixth.value[index]), 'the parts are the ones worked out before')

  // An edit to text an earlier edit wrote changes that earlier place: it alone is diffed again.
  const twice = counting(() => partsOf(changeOf([...finished, edit('7', 'src/a.ts', 'line 2 changed', 'line 2 changed twice')]), done.value))
  assert.equal(twice.diffs, 1)
})

test('the run ending and a change drawn again work out no diff', () => {
  const entries = [
    edit('1', 'src/a.ts', 'one', 'two'),
    edit('2', 'src/a.ts', 'three', 'four'),
    { id: 'message:1:0', kind: 'assistant', text: 'Now the other file.' } as ActivityEntry,
    edit('3', 'src/b.ts', 'five', 'six'),
    edit('4', 'src/b.ts', 'seven', 'eight', 'running'),
  ]
  const before = changesOf(entries)
  const drawn = new Map<Change, Parts>(before.map((change) => [change, partsOf(change)]))

  // Each change block keeps the parts it drew, and works them out again only for a change that is a new object.
  const ended = changesOf(entries, true)
  assert.equal(ended[0], before[0], 'a change with nothing running is the same object when the run ends')
  assert.notEqual(ended[1], before[1], 'the one still running is now stopped')
  const ending = counting(() => ended.map((change, index) => drawn.get(change) ?? partsOf(change, drawn.get(before[index]!))))
  assert.equal(ending.diffs, 0)

  const again = counting(() => before.map((change) => partsOf(change, drawn.get(change))))
  assert.equal(again.diffs, 0)
})

test("a diff's rows are worked out once, for the change's counts and for drawing it", () => {
  const parts = counting(() => partsOf(changeOf([edit('1', 'src/a.ts', 'const a = 1\nconst b = 2', 'const a = 3\nconst b = 2')])))
  assert.equal(parts.rows, 1)
  const [part] = parts.value
  const drawing = counting(() => renderToStaticMarkup(createElement(ChangeDiff, { file: part!.file, diff: part!.diff, rows: part!.rows, near: false })))
  assert.match(drawing.value, /const b = 2/)
  assert.equal(drawing.rows, 0, 'drawn from the rows the counts were made from')
  assert.equal(drawing.diffs, 0)
})
