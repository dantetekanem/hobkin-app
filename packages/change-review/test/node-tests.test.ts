import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nodeTestsOf, removedTestsOf, weakenedIn, type NodeTestsInput } from '../src/node-tests.ts'
import type { FileDiff, TestRun } from '../src/types.ts'

/** A diff of one file from its old and new lines, as one hunk from line 1. */
function diffOf(path: string, lines: string[]): FileDiff {
  const oldLines = lines.filter((line) => line[0] !== '+').length
  const newLines = lines.filter((line) => line[0] !== '-').length
  return { path, hunks: [{ oldStart: oldLines ? 1 : 0, oldLines, newStart: newLines ? 1 : 0, newLines, lines }] }
}

test('a test block the diff removes is a removed test, with the changed parts it names; one put back under its name is not', () => {
  const js = diffOf('test/total.test.js', [
    " import { total } from '../src/total.js'",
    ' ',
    "-test('rounds the total', () => {",
    '-  assert.equal(total(1.2, 1.4), 3)',
    '-})',
    "-test('adds', () => {",
    '-  assert.equal(total(1, 2), 3)',
    '-})',
    "+test('adds', () => {",
    '+  assert.equal(total(1, 2), 3)',
    '+})',
  ])
  const ruby = diffOf('spec/models/cart_spec.rb', [' describe Cart do', '-  it "keeps a legacy discount" do', '-    expect(cart.legacy_discount).to eq(0)', '-  end', ' end'])
  const python = diffOf('tests/test_total.py', ['-def test_total():', '-    assert total(1, 2) == 3', '-'])
  const code = diffOf('src/total.js', ["-test('not a test file', () => {})"])
  assert.deepEqual(removedTestsOf([js, ruby, python, code], ['total', 'Cart#legacy_discount']), [
    { path: 'test/total.test.js', symbol: 'rounds the total', base_line: 3, names: ['total'] },
    { path: 'spec/models/cart_spec.rb', symbol: 'keeps a legacy discount', base_line: 2, names: ['Cart#legacy_discount'] },
    { path: 'tests/test_total.py', symbol: 'test_total', base_line: 1, names: ['total'] },
  ])
})

test('an edited test that lost assertions says how many, and the lines they had at base', () => {
  const diff: FileDiff = {
    path: 'test/total.test.js',
    hunks: [{ oldStart: 4, oldLines: 4, newStart: 4, newLines: 3, lines: ["   test('rounds', () => {", '-    assert.equal(total(1.2, 1.4), 3)', '-    assert.equal(total(0.5, 0.5), 1)', '+    expect(total(1.2, 1.4)).toBe(3)', '   })'] }],
  }
  assert.deepEqual(weakenedIn(diff, [[4, 6]]), { assertions_removed: 1, lines: [5, 6] })
  assert.equal(weakenedIn(diff, [[20, 30]]), undefined, 'lines outside the test are not its own')
  // Git may put a whole removed test inside the kept one's lines: its assertions are its own, not the kept test's.
  const beside: FileDiff = {
    path: 'test/total.test.js',
    hunks: [{ oldStart: 6, oldLines: 7, newStart: 6, newLines: 2, lines: ['   assert.equal(total(1.2, 1.4), 3)', '-  assert.equal(total(0.5, 0.5), 1)', '-})', '-', "-test('adds', () => {", '-  assert.equal(total(1, 2), 3)', ' })'] }],
  }
  assert.deepEqual(weakenedIn(beside, [[5, 7]]), { assertions_removed: 1, lines: [7] })
})

const run = (kind: TestRun['kind'], tests: string[], failed: string[] = [], node?: string): TestRun => ({ command: 'node --test', tests, kind, ...(node ? { node } : {}), condition_state: 'default', exit_code: failed.length ? 1 : 0, seconds: 1, failed })

const input = (more: Partial<NodeTestsInput> = {}): NodeTestsInput => ({
  node: { id: 'n1', symbol: 'linkUserTags', path: 'src/helpers/posts.js', kind: 'function' },
  candidates: [
    { path: 'test/helpers/posts.test.js', why: 'the scan links it to linkUserTags', lifecycle: false, changed: true, found: 'scan' },
    { path: 'test/e2e/topics.test.js', why: 'life-cycle test of showTopic: route: showTopic', lifecycle: true, changed: false, found: 'entry' },
    { path: 'test/render.test.js', why: 'named after src/render.js', lifecycle: false, changed: true, found: 'convention' },
  ],
  definitions: [
    { id: 't1', symbol: 'repeated mentions are one lookup', path: 'test/helpers/posts.test.js', startLine: 6, endLine: 10, anchors: [{ id: 'n1', lines: [8] }], changed: true },
    { id: 't2', symbol: 'renders a mention', path: 'test/render.test.js', startLine: 4, endLine: 6, anchors: [{ id: 'n1', lines: [5] }], changed: true },
    { id: 't3', symbol: 'an old flow', path: 'test/flow/old.test.js', startLine: 2, endLine: 9, anchors: [{ id: 'n1', lines: [3] }], changed: false },
  ],
  testAnchors: [{ id: 't2', status: 'modified' }],
  proof: { value: 'lifecycle', evidence: '', observedBy: ['test/helpers/posts.test.js'], doubles: [], stillPass: ['test/e2e/topics.test.js', 'test/render.test.js'], reachedBy: ['test/e2e/topics.test.js'] },
  runs: [run('baseline', ['test/helpers/posts.test.js', 'test/e2e/topics.test.js', 'test/render.test.js']), run('revert', ['test/helpers/posts.test.js'], ['test/helpers/posts.test.js'], 'n1')],
  findings: [],
  status: (path) => ({ 'test/helpers/posts.test.js': 'added', 'test/render.test.js': 'modified' } as const)[path],
  diffs: [],
  removed: [{ path: 'test/helpers/old.test.js', symbol: 'counts each mention', base_line: 3, names: ['linkUserTags'] }],
  isLifecycleTest: (path) => /(^|\/)(e2e|flow)\//.test(path),
  ...more,
})

test('each test of a part says how it relates to the change, how it was found, how it did and what it showed, the older first', () => {
  const tests = nodeTestsOf(input())
  assert.deepEqual(tests, [
    { path: 'test/e2e/topics.test.js', relation: 'before', found: 'entry', lifecycle: true, at_head: 'passed', shows: 'reaches', why: 'life-cycle test of showTopic: route: showTopic' },
    { path: 'test/flow/old.test.js', symbol: 'an old flow', line: 2, relation: 'before', found: 'scan', lifecycle: true, at_head: 'not-run', why: 'the scan links it; it was not among the tests run' },
    { path: 'test/render.test.js', symbol: 'renders a mention', line: 4, relation: 'edited', found: 'convention', lifecycle: false, at_head: 'passed', shows: 'still-passes', why: 'named after src/render.js' },
    { path: 'test/helpers/posts.test.js', symbol: 'repeated mentions are one lookup', line: 6, relation: 'added', found: 'scan', lifecycle: false, at_head: 'passed', shows: 'proves', why: 'the scan links it to linkUserTags' },
    { path: 'test/helpers/old.test.js', symbol: 'counts each mention', line: 3, relation: 'removed', found: 'diff', lifecycle: false },
  ])
})

test('a test that fails or hangs at the commit says so, and one that fails only through a double mocks', () => {
  const tests = nodeTestsOf(
    input({
      runs: [run('baseline', ['test/helpers/posts.test.js', 'test/e2e/topics.test.js', 'test/render.test.js'], ['test/render.test.js'])],
      findings: [{ rule: 'test-timeout', text: 'test/e2e/topics.test.js did not finish within 120 seconds here, with the change in place.', by: 'proof' }],
      proof: { value: 'mocked', evidence: '', observedBy: ['test/helpers/posts.test.js'], doubles: ['test/helpers/posts.test.js:3: mock.method(posts, "linkUserTags")'], stillPass: [], reachedBy: [] },
    }),
  )
  const of = (path: string) => tests.find((entry) => entry.path === path)!
  assert.equal(of('test/render.test.js').at_head, 'failed')
  assert.equal(of('test/e2e/topics.test.js').at_head, 'timed-out')
  assert.equal(of('test/helpers/posts.test.js').shows, 'mocks')
})

test('an edited test of the part that lost assertions is weakened', () => {
  const diff: FileDiff = { path: 'test/render.test.js', hunks: [{ oldStart: 4, oldLines: 3, newStart: 4, newLines: 2, lines: ["   test('renders a mention', () => {", "-    assert.match(render('@1'), /Ana/)", '   })'] }] }
  const edited = nodeTestsOf(input({ diffs: [diff] })).find((entry) => entry.path === 'test/render.test.js')!
  assert.deepEqual(edited.weakened, { assertions_removed: 1, lines: [5] })
})

test('a test has no tests of its own', () => {
  assert.deepEqual(nodeTestsOf(input({ node: { id: 't1', symbol: 'rounds', path: 'test/total.test.js', kind: 'test' } })), [])
})

test('a test of a caller that fails once the part throws reaches it', () => {
  const caller = { path: 'test/services/reviews.test.js', why: 'a test of findReview, on the way from GET /reviews/:id', lifecycle: false, changed: false, found: 'entry' as const, through: 'findReview' }
  const proof = { value: 'isolated' as const, evidence: '', observedBy: [], doubles: [], stillPass: ['test/services/reviews.test.js'], reachedBy: [], reachedByCallers: ['test/services/reviews.test.js'] }
  const [entry] = nodeTestsOf(input({ candidates: [caller], definitions: [], proof, removed: [], runs: [run('baseline', ['test/services/reviews.test.js'])] }))
  assert.deepEqual([entry!.relation, entry!.found, entry!.shows], ['before', 'entry', 'reaches'])
})

test('each covering test in a changed file has its own relation: one there before stays before beside the one the change added', () => {
  const definitions = [
    { id: 'n8', symbol: 'ReviewTest test "score label"', path: 'test/models/review_test.rb', startLine: 4, endLine: 6, anchors: [{ id: 'n1', lines: [5] }], changed: false },
    { id: 'n3', symbol: 'ReviewTest test "score label caps at five"', path: 'test/models/review_test.rb', startLine: 8, endLine: 10, anchors: [{ id: 'n1', lines: [9] }], changed: true },
  ]
  const tests = nodeTestsOf(
    input({
      node: { id: 'n1', symbol: 'Review#score_label', path: 'app/models/review.rb', kind: 'function' },
      candidates: [{ path: 'test/models/review_test.rb', why: 'the scan links it to Review#score_label', lifecycle: false, changed: true, found: 'scan' }],
      definitions,
      testAnchors: [{ id: 'n3', status: 'added' }],
      status: (path) => (path === 'test/models/review_test.rb' ? 'modified' : undefined),
      removed: [],
      runs: [],
    }),
  )
  assert.deepEqual(tests.map((entry) => [entry.path, entry.symbol, entry.line, entry.relation]), [
    ['test/models/review_test.rb', 'ReviewTest test "score label"', 4, 'before'],
    ['test/models/review_test.rb', 'ReviewTest test "score label caps at five"', 8, 'added'],
  ])
})
