import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { captureChange } from '#shared/review/capture.ts'
import { lines, memoryReader, type Tree } from '#shared/review/memory.ts'
import { prepareReview } from '#shared/review/prepare.ts'
import type { Review, ReviewFileContents, ReviewNode } from '#shared/review/types.ts'
import { validateReview } from '#shared/review/validate.ts'
import type { Vicinity } from '#shared/review/vicinity.ts'
import { assessmentFolder, Assessments } from '../src/review/assessment.ts'
import { temporaryDirectory } from './support.ts'

const TARGET = { kind: 'change' as const, slug: 'hobkin', item: '7d02c9' }

// The change: doingAfter says a tool means research. Its unit test was there before; a request test was too.
const base: Tree = { 'src/doing.ts': lines('export function doingAfter(previous: string) {', '  return previous;', '}') }
const head: Tree = { 'src/doing.ts': lines('export function doingAfter(previous: string, event: string) {', "  if (event === 'tool') return 'researching';", '  return previous;', '}') }
const testFile = lines(
  "import { doingAfter } from '../src/doing.ts';",
  "test('says researching', () => {",
  "  expect(doingAfter('idle', 'tool')).toBe('researching');",
  '});',
  "test('keeps idle', () => {",
  "  expect(doingAfter('idle', 'read')).toBe('idle');",
  '});',
)
const around: Tree = { 'test/doing.test.ts': testFile }
/** A test file the change deletes, whose one test reaches doingAfter by no name the host can see. */
const oldTest = lines("test('old way', () => {", "  expect(globalThis.app.run('tool')).toBe('idle');", '});')
const saysResearching: Vicinity = { links: [], tests: [{ changed: { path: 'src/doing.ts', line: 2 }, test: { path: 'test/doing.test.ts', symbol: 'says researching', line: 3, changed: false } }] }

async function prepared(vicinity: Vicinity = saysResearching, removed: Tree = {}) {
  const atHead = { ...head, ...around }
  const capture = await captureChange(memoryReader({ ...base, ...around, ...removed }, atHead), 'base', 'head')
  const review = await prepareReview({
    id: 'change:hobkin:7d02c9',
    change: { project: 'hobkin', item: '7d02c9', title: 'Say a tool is research', branch: 'hobkin/7d02c9' },
    capture,
    spec: null,
    readHead: async (path) => (typeof atHead[path] === 'string' ? (atHead[path] as string) : null),
    vicinity,
  })
  const before: Tree = { ...base, ...around, ...removed }
  const files: ReviewFileContents[] = review.files.map((file) => ({ fileId: file.id, path: file.path, base: (before[file.path] as string | undefined) ?? null, head: (atHead[file.path] as string | undefined) ?? null, binary: false }))
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

test('an unchanged test only the change review found joins the review when its file is there to show, wired to the code it covered', async (t) => {
  const { review, files } = await prepared()
  const tests = [
    { path: 'test/doing.test.ts', symbol: 'keeps idle', line: 6, relation: 'before', found: 'scan', lifecycle: false, at_head: 'passed' },
    // Its file is not one the review holds, so the window could not show it.
    { path: 'test/elsewhere.test.ts', symbol: 'goes elsewhere', line: 3, relation: 'before', found: 'scan', lifecycle: false, at_head: 'passed' },
  ]
  const assessments = reviewed(t, review, { nodes: [{ ...doingAfterNode, tests }] })

  const shown = assessments.present(TARGET, review, files)!

  const doingAfter = titled(shown.nodes, 'doingAfter')
  const keepsIdle = titled(shown.nodes, 'keeps idle')
  assert.deepEqual([keepsIdle.change, keepsIdle.status, keepsIdle.covers, keepsIdle.anchors.map(({ startLine, endLine }) => [startLine, endLine])], ['unchanged', 'passed', [doingAfter.id], [[5, 7]]])
  assert.ok(shown.zones?.some((zone) => zone.id === keepsIdle.zone))
  assert.equal(titled(shown.nodes, 'goes elsewhere'), undefined)
  assert.deepEqual(validateReview(shown), [])
})

test("a test the host shows takes the change review's result at the change's commit when no run told it", async (t) => {
  const { review, files } = await prepared()
  const tests = [{ path: 'test/doing.test.ts', symbol: 'says researching', line: 3, relation: 'before', found: 'scan', lifecycle: false, at_head: 'failed' }]
  const assessments = reviewed(t, review, { nodes: [{ ...doingAfterNode, tests }] })

  const shown = assessments.present(TARGET, review, files)!

  assert.equal(titled(shown.nodes, 'says researching').status, 'failed')
})

test('a test the change removed is wired to what it covered, and code it alone covered says so', async (t) => {
  const { review, files } = await prepared({ links: [] }, { 'test/old.test.ts': oldTest })
  const assessments = reviewed(t, review, { nodes: [doingAfterNode], removed_tests: [{ path: 'test/old.test.ts', symbol: "test('old way')", base_line: 1, names: ['doingAfter'] }] })

  const shown = assessments.present(TARGET, review, files)!

  const doingAfter = titled(shown.nodes, 'doingAfter')
  const oldWay = titled(shown.nodes, 'old way')
  assert.deepEqual([oldWay.change, oldWay.covers], ['deleted', [doingAfter.id]])
  assert.ok(doingAfter.attention?.reasons.includes('The change removed the only test that covered it.'))
})

test("the change review's way in stands where the host found none, its words whole and its steps where the host shows them", async (t) => {
  const { review, files } = await prepared({ links: [] })
  const origin = (label: string) => ({ kind: 'route', label, exact: true, by: 'scan', chain: [{ symbol: 'DoingController#show', path: 'src/controller.ts', line: 1 }], hops: 2 })
  const assessments = reviewed(t, review, { nodes: [{ ...doingAfterNode, runs_from: { found: 'origins', origins: [origin('GET /doing'), origin('POST /doing')] } }] })

  const shown = assessments.present(TARGET, review, files)!

  assert.deepEqual(titled(shown.nodes, 'doingAfter').lifecycle, {
    role: 'changed',
    hops: 2,
    path: 'GET /doing → DoingController#show → doingAfter',
    origin: { kind: 'route', label: 'GET /doing', exact: true, chain: [], more: 1 },
  })
})

test('a zone the Reviewer named is shown by its name', async (t) => {
  const { review, files } = await prepared()
  const zone = titled(review.nodes, 'doingAfter').zone!
  const assessments = reviewed(t, review, { nodes: [doingAfterNode], zones: [{ id: zone, layer: 'root', subject: 'doing', label: 'Top level · doing', told: 'What hobkin is doing' }] })

  const shown = assessments.present(TARGET, review, files)!

  assert.equal(shown.zones?.find((entry) => entry.id === zone)?.label, 'What hobkin is doing')
})
