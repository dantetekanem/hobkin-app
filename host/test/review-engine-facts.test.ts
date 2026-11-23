import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { captureChange } from '#shared/review/capture.ts'
import { lines, memoryReader, type Tree } from '#shared/review/memory.ts'
import { prepareReview } from '#shared/review/prepare.ts'
import type { Review, ReviewFileContents, ReviewNode } from '#shared/review/types.ts'
import type { Vicinity } from '#shared/review/vicinity.ts'
import { assessmentFolder, Assessments } from '../src/review/assessment.ts'
import { temporaryDirectory } from './support.ts'

const TARGET = { kind: 'change' as const, slug: 'hobkin', item: '7d02c9' }

// The change: doingAfter says a tool means research. Its unit test was there before; a request test was too.
const base: Tree = { 'src/doing.ts': lines('export function doingAfter(previous: string) {', '  return previous;', '}') }
const head: Tree = { 'src/doing.ts': lines('export function doingAfter(previous: string, event: string) {', "  if (event === 'tool') return 'researching';", '  return previous;', '}') }
const around: Tree = {
  'test/doing.test.ts': lines("import { doingAfter } from '../src/doing.ts';", "test('says researching', () => {", "  expect(doingAfter('idle', 'tool')).toBe('researching');", '});'),
}

async function prepared(vicinity: Vicinity = { links: [], tests: [{ changed: { path: 'src/doing.ts', line: 2 }, test: { path: 'test/doing.test.ts', symbol: 'says researching', line: 3, changed: false } }] }) {
  const atHead = { ...head, ...around }
  const capture = await captureChange(memoryReader({ ...base, ...around }, atHead), 'base', 'head')
  const review = await prepareReview({
    id: 'change:hobkin:7d02c9',
    change: { project: 'hobkin', item: '7d02c9', title: 'Say a tool is research', branch: 'hobkin/7d02c9' },
    capture,
    spec: null,
    readHead: async (path) => (typeof atHead[path] === 'string' ? (atHead[path] as string) : null),
    vicinity,
  })
  const files: ReviewFileContents[] = review.files.map((file) => ({ fileId: file.id, path: file.path, base: base[file.path] ?? around[file.path] ?? null, head: atHead[file.path] ?? null, binary: false }))
  return { review, files }
}

/** What the change review left in the home for the review's commit: one unit over doingAfter, and `graph`. */
function reviewed(t: TestContext, review: Review, graph: object): Assessments {
  const root = temporaryDirectory(t)
  const folder = assessmentFolder(root, TARGET, review.change.head)
  mkdirSync(folder, { recursive: true })
  const write = (name: string, value: unknown) => writeFileSync(join(folder, name), typeof value === 'string' ? value : JSON.stringify(value))
  const facts = { effect: { value: 'behaviour', evidence: '' }, proof: { value: 'lifecycle', evidence: '' }, exposure: { value: 'everyone', evidence: '' }, undo: { value: 'rollback', evidence: '' } }
  write('summary.json', { level: 'mid', critical: false, needsYou: 0, worthALook: 1, safe: 0, storyBy: 'host', at: '2026-11-23T10:00:00.000Z' })
  write('units.json', {
    schema: 'review-units/1',
    map: 'node-level',
    attention: { units: 1, reading_minutes: 1 },
    units: [{ id: 'u1', title: 'A tool is research', level: 'mid', critical: false, nodes: ['n1'], grouping: 'single', story_order: 1, where: '', what: '', code: [], facts, why_level: [], would_change: [], watch: 'not assessed', questions: [], reading_minutes: 1 }],
  })
  write('story.md', '# Say a tool is research\n')
  write('graph.json', graph)
  return new Assessments({ root, run: async () => Promise.reject(new Error('not run here')), repoOf: () => null })
}

const doingAfterNode = { id: 'n1', kind: 'function', symbol: 'doingAfter', path: 'src/doing.ts', lines: [1, 4], change: 'modified', level: { current: 'mid' }, critical: false, findings: [], questions: [], sensitive: [] }
const titled = (nodes: readonly ReviewNode[], title: string) => nodes.find((node) => node.title === title)!

test("an unchanged test that covered the code before takes its status from the runs at the change's commit", async (t) => {
  const { review, files } = await prepared()
  const assessments = reviewed(t, review, { nodes: [doingAfterNode], runs: [{ kind: 'baseline', tests: ['test/doing.test.ts'], failed: [], exit_code: 0 }] })

  const shown = assessments.present(TARGET, review, files)!

  const before = titled(shown.nodes, 'says researching')
  assert.deepEqual([before.change, before.status], ['unchanged', 'passed'])
})

test('a review prepared before zones, covers and ways in, with an older graph.json, reads as it did', async (t) => {
  const { review: now, files } = await prepared({ links: [] })
  const older: Review = {
    ...now,
    nodes: now.nodes.map(({ zone: _zone, covers: _covers, lifecycle: _lifecycle, ...node }) => node),
  }
  delete older.zones
  const assessments = reviewed(t, older, { nodes: [doingAfterNode] })

  const shown = assessments.present(TARGET, older, files)!

  assert.equal(shown.zones, undefined)
  for (const node of shown.nodes) assert.deepEqual([node.zone, node.covers, node.lifecycle], [undefined, undefined, undefined], node.id)
})
