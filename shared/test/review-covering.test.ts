import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureChange } from '../review/capture.ts'
import { hashLines } from '../review/lines.ts'
import { lines, memoryReader, type Tree } from '../review/memory.ts'
import { prepareReview } from '../review/prepare.ts'
import type { Review, ReviewNode } from '../review/types.ts'
import { validateReview } from '../review/validate.ts'
import type { Vicinity, VicinityTest } from '../review/vicinity.ts'

// The change: doingAfter now says a tool means research. Its tests were there before, and still are.
const base: Tree = { 'src/doing.ts': lines('export function doingAfter(previous: string) {', '  return previous;', '}') }
const head: Tree = { 'src/doing.ts': lines('export function doingAfter(previous: string, event: string) {', "  if (event === 'tool') return 'researching';", '  return previous;', '}') }
const testFile = lines(
  "import { doingAfter } from '../src/doing.ts';",
  "test('says researching', () => {",
  "  expect(doingAfter('idle', 'tool')).toBe('researching');",
  '});',
  "test('keeps what it was doing', () => {",
  "  expect(doingAfter('idle', 'read')).toBe('idle');",
  '});',
)
const unchanged: Tree = { 'test/doing.test.ts': testFile }

async function prepared(vicinity: Vicinity, trees: { base: Tree; head: Tree } = { base, head }, around: Tree = unchanged): Promise<Review> {
  const atHead = { ...trees.head, ...around }
  return prepareReview({
    id: 'r1',
    change: { project: 'hobkin', item: '7d02c9', title: 'Say a tool is research', branch: 'hobkin/7d02c9' },
    capture: await captureChange(memoryReader({ ...trees.base, ...around }, atHead), 'base', 'head'),
    spec: null,
    readHead: async (path) => (typeof atHead[path] === 'string' ? (atHead[path] as string) : null),
    vicinity,
  })
}

const uses = (path: string, symbol: string, line: number, changed?: boolean, at = { path: 'src/doing.ts', line: 2 }): VicinityTest => ({ changed: at, test: { path, symbol, line, ...(changed === undefined ? {} : { changed }) } })
const titled = (review: Review, title: string): ReviewNode => {
  const node = review.nodes.find((entry) => entry.title === title)
  assert.ok(node, `a node titled ${title}: ${review.nodes.map((entry) => entry.title).join(', ')}`)
  return node
}

test('an unchanged test that covered changed code before the change joins the review, wired to that code, and says so', async () => {
  const review = await prepared({ links: [], tests: [uses('test/doing.test.ts', 'says researching', 3, false)] })
  assert.deepEqual(validateReview(review), [])
  const doingAfter = titled(review, 'doingAfter')
  const before = titled(review, 'says researching')
  assert.deepEqual(
    [before.kind, before.change, before.subtitle, before.status, before.covers, before.anchors],
    ['test', 'unchanged', 'test/doing.test.ts', 'not-run', [doingAfter.id], [{ fileId: 'test/doing.test.ts', side: 'added', startLine: 2, endLine: 4, hash: hashLines(testFile, 2, 4) }]],
  )
  assert.ok(review.edges.some((edge) => edge.kind === 'exercises' && edge.from === before.id && edge.to === doingAfter.id))
  assert.equal(before.summary, 'This test did not change. It covered doingAfter before this change.')
  assert.ok(review.files.some((file) => file.path === 'test/doing.test.ts' && file.status === 'unchanged'))
})

test('a test the change touched, or one that is not at head, is not taken for a test that was there before', async () => {
  const review = await prepared({ links: [], tests: [uses('test/doing.test.ts', 'says researching', 3, true), uses('test/gone.test.ts', 'went away', 2, false), uses('test/doing.test.ts', 'never written', 6, false)] })
  assert.deepEqual(review.nodes.filter((node) => node.kind === 'test'), [])
})

test('at most 3 unchanged tests join for a changed definition and 12 for a review, the life-cycle tests first', async () => {
  const names = Array.from({ length: 6 }, (_, index) => `step${index}`)
  const code = (body: string) => lines(...names.flatMap((name) => [`export function ${name}(value: number) {`, `  return ${body};`, '}']))
  const many: Tree = {}
  const tests: VicinityTest[] = []
  for (const [index, name] of names.entries()) {
    for (const folder of ['test/unit', 'test/unit', 'test/e2e', 'test/unit']) {
      const path = `${folder}/${name}-${tests.length}.test.ts`
      many[path] = lines(`import { ${name} } from '../../src/doing.ts';`, `test('${name} ${tests.length}', () => {`, `  expect(${name}(1)).toBe(2);`, '});')
      tests.push(uses(path, `${name} ${tests.length}`, 3, false, { path: 'src/doing.ts', line: index * 3 + 2 }))
    }
  }
  const review = await prepared({ links: [], tests }, { base: { 'src/doing.ts': code('value') }, head: { 'src/doing.ts': code('value + 1') } }, many)
  assert.deepEqual(validateReview(review), [])
  const before = review.nodes.filter((node) => node.kind === 'test')
  assert.equal(before.length, 12)
  const perDefinition = new Map<string, string[]>()
  for (const node of before) for (const id of node.covers ?? []) perDefinition.set(id, [...(perDefinition.get(id) ?? []), node.subtitle!])
  assert.ok([...perDefinition.values()].every((paths) => paths.length <= 3))
  // Every definition gets its request test first, before any definition gets a third test.
  assert.equal(before.filter((node) => node.subtitle!.startsWith('test/e2e/')).length, 6)
})

test('every test says which code it covers, a changed test as well as one that was there before', async () => {
  const added = lines("import { doingAfter } from '../src/doing.ts';", "test('a tool is research', () => {", "  expect(doingAfter('', 'tool')).toBe('researching');", '});')
  const lonely = lines("test('adds numbers', () => {", '  expect(1 + 1).toBe(2);', '});')
  const review = await prepared({ links: [], tests: [uses('test/doing.test.ts', 'keeps what it was doing', 6, false)] }, { base, head: { ...head, 'test/new.test.ts': added, 'test/math.test.ts': lonely } })
  assert.deepEqual(validateReview(review), [])
  const doingAfter = titled(review, 'doingAfter')
  assert.deepEqual([titled(review, 'a tool is research').change, titled(review, 'a tool is research').covers], ['added', [doingAfter.id]])
  assert.deepEqual(titled(review, 'keeps what it was doing').covers, [doingAfter.id])
  assert.deepEqual(titled(review, 'adds numbers').covers, [])
  const wrong = { ...review, nodes: review.nodes.map((node) => (node.kind === 'test' ? { ...node, covers: ['nowhere'] } : node)) }
  assert.equal(validateReview(wrong).length, 3, 'a test covers code of this review')
})

test('a test whose only changed line is a blank one beside it was there before the change, so it is unchanged', async () => {
  const before = lines('require "test_helper"', '', 'class ReviewTest < ActiveSupport::TestCase', '  test "score label" do', '    assert_equal "3 of 5", reviews(:one).score_label', '  end', 'end')
  const after = lines('require "test_helper"', '', 'class ReviewTest < ActiveSupport::TestCase', '  test "score label" do', '    assert_equal "3 of 5", reviews(:one).score_label', '  end', '', '  test "score label caps at five" do', '    assert_equal "5 of 5", reviews(:many).score_label', '  end', 'end')
  const review = await prepared({ links: [] }, { base: { ...base, 'test/models/review_test.rb': before }, head: { ...head, 'test/models/review_test.rb': after } }, {})

  const scoreLabel = titled(review, 'score label')

  assert.deepEqual([scoreLabel.change, scoreLabel.stats], ['unchanged', { additions: 0, deletions: 0 }])
  assert.equal(titled(review, 'score label caps at five').change, 'added')
  assert.deepEqual(validateReview(review), [])
})
