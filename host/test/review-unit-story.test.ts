import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Unit } from '#shared/review/assessment.ts'
import { captureChange, type ChangeReader } from '#shared/review/capture.ts'
import { prepareReview } from '#shared/review/prepare.ts'
import { NO_SPEC_NOTICE, type ReviewNode } from '#shared/review/types.ts'
import { unitStory, unitWords, type UnitPlace } from '../src/review/unit-story.ts'

/** A change in memory: the cart's total rounds, an old total goes, a locale changes, and its test changes. */
const BASE: Record<string, string> = {
  'app/models/cart.rb': 'class Cart\n  def total = 1\n\n  def old_total = 0\nend\n',
  'config/locales/en.yml': 'en:\n  cart: Cart\n',
  'test/models/cart_test.rb': 'class CartTest\n  test "total is one" do\n    assert_equal 1, Cart.new.total\n  end\nend\n',
}
const HEAD: Record<string, string> = {
  'app/models/cart.rb': 'class Cart\n  def total = 1.round\nend\n',
  'config/locales/en.yml': 'en:\n  cart: Basket\n',
  'test/models/cart_test.rb': 'class CartTest\n  test "total is rounded" do\n    assert_equal 1, Cart.new.total\n  end\nend\n',
}

async function review() {
  const reader: ChangeReader = {
    changed: async () => Object.keys(HEAD).map((path) => ({ path, status: 'modified' as const })),
    read: async (commit, path) => {
      const text = (commit === 'b'.repeat(40) ? BASE : HEAD)[path]
      return text == null ? { kind: 'missing' } : { kind: 'text', text }
    },
  }
  const capture = await captureChange(reader, 'b'.repeat(40), 'c'.repeat(40))
  return prepareReview({ id: 'pr:acme/shop/12', change: { project: 'acme/shop', item: '#12', title: 'Round the total', branch: 'round', risk: 'Totals change for everyone.' }, capture, spec: null, readHead: async () => null })
}

const unit = (id: string, story_order: number, more: Partial<Unit>): Unit => ({
  id,
  title: `${id} title`,
  level: 'mid',
  critical: false,
  nodes: [],
  grouping: 'single',
  story_order,
  where: 'Stop 1.',
  what: `${id} what`,
  code: [],
  facts: { effect: { value: 'behaviour', evidence: '' }, proof: { value: 'none', evidence: '' }, exposure: { value: 'everyone', evidence: '' }, undo: { value: 'rollback', evidence: '' } },
  why_level: [],
  would_change: [],
  watch: 'not assessed',
  questions: [],
  reading_minutes: 1,
  ...more,
})

const places: UnitPlace[] = [
  { id: 'n1', kind: 'function', path: 'app/models/cart.rb', lines: [2, 2], change: 'modified' },
  // Removed: its lines are the base's.
  { id: 'n2', kind: 'function', path: 'app/models/cart.rb', lines: [4, 4], change: 'removed' },
  { id: 'n3', kind: 'test', path: 'test/models/cart_test.rb', lines: [2, 4], change: 'modified' },
]

const STORY = '# Round the total\n\n## Opening\n\n**Does:** Rounds the total and drops the old one.\n'

test('each unit is a step in the order the story walks, focused on the graph nodes that hold its definitions', async () => {
  const graph = await review()
  assert.ok(graph.notices.includes(NO_SPEC_NOTICE))
  const units = [
    unit('u1', 3, { nodes: ['n1'], level: 'high' }),
    // A unit of files: its focus is its bucket's files.
    unit('u2', 1, { nodes: [], buckets: ['b2'], grouping: 'bucket', level: 'safe' }),
    unit('u3', 2, { nodes: ['n2', 'n3'], level: 'mid' }),
  ]
  const story = unitStory(graph, { units, places, words: null, story: STORY, buckets: [{ id: 'b2', paths: ['config/locales/en.yml'] }] })

  const idOf = (title: string) => graph.nodes.find((node) => node.title === title)!.id
  assert.deepEqual(
    story.map(({ id, kind, title, text, unit: told, level, focus }) => ({ id, kind, title, text, told, level, focus })),
    [
      // No words were saved: the story's own heading and "Does" line open it.
      { id: 'outcome', kind: 'outcome', title: 'Round the total', text: 'Rounds the total and drops the old one.', told: undefined, level: undefined, focus: [] },
      { id: 'unit-u2', kind: 'walk', title: 'u2 title', text: 'u2 what', told: 'u2', level: 'safe', focus: [idOf('en.yml')] },
      // The removed total is found on the base side; the test is never in a focus.
      { id: 'unit-u3', kind: 'walk', title: 'u3 title', text: 'u3 what', told: 'u3', level: 'mid', focus: [idOf('old_total')] },
      { id: 'unit-u1', kind: 'walk', title: 'u1 title', text: 'u1 what', told: 'u1', level: 'high', focus: [idOf('total')] },
      // The closing the review had stays last.
      { id: 'closing', kind: 'closing', title: graph.story.at(-1)!.title, text: graph.story.at(-1)!.text, told: undefined, level: undefined, focus: [] },
    ],
  )
  assert.ok(!story.some((step) => step.focus.includes(idOf('total is rounded'))), 'no step is a test')
})

test('the story’s words name the change and its units, and a long title is kept within what a step may hold', async () => {
  const graph = await review()
  const long = `${'A very long claim about the total '.repeat(4)}that goes on`
  const story = unitStory(graph, {
    units: [unit('u1', 1, { nodes: ['n1'] })],
    places,
    words: { title: 'Round the cart total', does: 'Rounds every total once.', units: { u1: { title: long, what: 'Rounded where it is read.' } } },
    story: STORY,
    buckets: [],
  })
  assert.deepEqual([story[0]!.title, story[0]!.text], ['Round the cart total', 'Rounds every total once.'])
  assert.equal(story[1]!.text, 'Rounded where it is read.')
  assert.ok(story[1]!.title.length <= 80 && story[1]!.title.endsWith('…'))
})

test('file-only receipts cannot prove or pass a named case', async () => {
  const graph = await review()
  const file = 'test/models/cart_test.rb'
  const nodes = unitWords(graph, { units: [], places, words: null, runs: [{ kind: 'baseline', tests: [file], failed: [] }, { kind: 'probe', node: 'n1', tests: [file], failed: [file] }] })
  assert.equal(nodes.find((node) => node.kind === 'test')?.status, 'not-run')
})

test('local failures identify failed or proving cases, while file success leaves a case unknown', async () => {
  const graph = await review()
  const test = graph.nodes.find((node) => node.kind === 'test')!
  const words = (runs: Parameters<typeof unitWords>[1]['runs'], notRun?: string) =>
    unitWords(graph, { units: [], places, words: null, runs, ...(notRun ? { notRun } : {}) }).find((node) => node.id === test.id)!
  const file = 'test/models/cart_test.rb'
  assert.deepEqual([words([{ kind: 'baseline', tests: [file], failed: [file], failed_at: [{ path: file, line: 3 }] }]).status, words([{ kind: 'baseline', tests: [file], failed: [file], failed_at: [{ path: file, line: 3 }] }]).summary], ['failed', `${words([]).summary.split('. ')[0]}. It fails at the change's commit.`])
  assert.equal(words([{ kind: 'baseline', tests: [file], failed: [] }, { kind: 'probe', node: 'n1', tests: [file], failed: [file], failed_at: [{ path: file, line: 3 }] }]).status, 'proves-change')
  assert.equal(words([{ kind: 'baseline', tests: [file], failed: [] }, { kind: 'revert', node: 'n1', tests: [file], failed: [] }]).status, 'not-run')
  assert.match(words([], 'no way to run this repository’s tests was found.').summary, /Not run: no way to run this repository’s tests was found\.$/)
})

test('a case without a local receipt preserves startup, stopped and skipped explanations', async () => {
  const graph = await review()
  const test = graph.nodes.find((node) => node.kind === 'test')!
  const file = 'test/models/cart_test.rb'
  const other = 'test/models/order_test.rb'
  type Parts = Parameters<typeof unitWords>[1]
  const words = (runs: Parts['runs'], unrun?: Parts['unrun']) => unitWords(graph, { units: [], places, words: null, runs, ...(unrun ? { unrun } : {}) }).find((node) => node.id === test.id)!
  const notRun = (node: ReviewNode, why: string) => {
    assert.equal(node.status, 'not-run', why)
    assert.ok(node.summary.endsWith(`Not run: ${why}`), node.summary)
  }
  const gems = 'the test command could not start here (Could not find rails-8.1.3.1 in locally installed gems).'
  notRun(words([{ kind: 'baseline', tests: [file], failed: [], not_run: gems }]), gems)
  notRun(words([{ kind: 'baseline', tests: [file, other], failed: [], not_run: 'the proof was stopped.' }]), 'the proof was stopped.')
  // The batch failed in another file, and run alone this one held no test the runner runs.
  const none = 'the test runner found no test to run.'
  notRun(words([{ kind: 'baseline', tests: [file, other], failed: [other] }, { kind: 'baseline', tests: [file], failed: [], not_run: none }, { kind: 'baseline', tests: [other], failed: [other] }]), none)
  const notTaken = 'this review runs tests with bin/rails with a test folder, which does not take it.'
  notRun(words([{ kind: 'baseline', tests: [other], failed: [] }], [{ path: file, why: notTaken }]), notTaken)
  assert.equal(words([{ kind: 'baseline', tests: [file, other], failed: [other] }, { kind: 'baseline', tests: [file], failed: [] }]).status, 'not-run', 'running the file alone is still not a case receipt')
})

test('only a test the run failed in proves the change: a sibling remains unknown', async () => {
  const graph = await review()
  const test = graph.nodes.find((node) => node.kind === 'test')!
  const file = 'test/models/cart_test.rb'
  const reverted = (failed_at: { path: string; line: number }[]) =>
    unitWords(graph, { units: [], places, words: null, runs: [{ kind: 'baseline', tests: [file], failed: [] }, { kind: 'revert', node: 'n1', tests: [file], failed: [file], failed_at }] }).find((node) => node.id === test.id)!
  // The test is lines 2 to 4 of its file.
  assert.equal(reverted([{ path: file, line: 3 }]).status, 'proves-change')
  const other = reverted([{ path: file, line: 40 }])
  assert.equal(other.status, 'not-run')
  assert.match(other.summary, /No individual result/)
  assert.equal(reverted([{ path: 'test/models/order_test.rb', line: 3 }]).status, 'not-run', 'a failure in another file is not this test’s')
})

test('a file-level reach result does not establish a named case passed', async () => {
  const graph = await review()
  const test = graph.nodes.find((node) => node.kind === 'test')!
  const file = 'test/models/cart_test.rb'
  const told = unitWords(graph, {
    units: [],
    places: places.map((place) => (place.id === 'n1' ? { ...place, symbol: 'Cart#total' } : place)),
    words: null,
    runs: [{ kind: 'baseline', tests: [file], failed: [] }, { kind: 'revert', node: 'n1', tests: [file], failed: [] }, { kind: 'reach', node: 'n1', tests: [file], failed: [file] }],
  }).find((node) => node.id === test.id)!
  assert.equal(told.status, 'not-run')
  assert.match(told.summary, /No individual result/)
})

test('the named case result wins over a stack frame from a sibling and a trailing context line', async () => {
  const graph = await review()
  const file = 'test/models/cart_test.rb'
  const parts = { units: [], words: null, places: places.map((place) => place.kind === 'test' ? { ...place, symbol: 'describe "cart".rounds', lines: [2, 3] as [number, number] } : place) }
  const nodes = unitWords(graph, { ...parts, runs: [
    { kind: 'baseline', tests: [file], failed: [], cases: [{ path: file, name: 'cart > rounds', status: 'passed' }] },
    { kind: 'probe', node: 'n1', tests: [file], failed: [file], failed_at: [{ path: file, line: 3 }], cases: [{ path: file, name: 'cart > rounds', status: 'passed' }, { path: file, name: 'other > rounds', status: 'failed' }] },
  ] })
  assert.equal(nodes.find((node) => node.kind === 'test')?.status, 'passed')
})

test('a case whose file was never selected does not claim its file ran', async () => {
  const node = unitWords(await review(), { units: [], places, words: null, runs: [] }).find((node) => node.kind === 'test')
  assert.match(node!.summary, /file was not run/)
})

test('native exact case receipts establish success, not a sibling name', async () => {
  const graph = await review()
  const file = 'test/models/cart_test.rb'
  const own = graph.nodes.find((node) => node.kind === 'test')!
  const parts = {units: [], words: null, places: places.map((place) => place.kind === 'test' ? {...place, symbol: 'total is rounded'} : place)}
  const told = (name: string) => unitWords(graph, {...parts, runs: [{kind: 'baseline', tests: [file], failed: [], cases: [{path: file, name, status: 'passed'}]}]}).find((node) => node.id === own.id)!
  assert.equal(told('total is rounded').status, 'passed')
  assert.equal(told('another case').status, 'not-run')
})

test('code of a unit says what the unit says of it: its member line, else what changed', async () => {
  const graph = await review()
  const units = [unit('u1', 1, { nodes: ['n1', 'n2'], members: [{ node: 'n1', name: 'total', what: 'Rounds the total.' }], what: 'The totals change.' })]
  const told = unitWords(graph, { units, places, words: null, runs: [] })
  const titled = (title: string) => told.find((node) => node.title === title)!.summary
  assert.equal(titled('total'), 'Rounds the total.')
  assert.equal(titled('old_total'), 'The totals change.')
  assert.equal(titled('en.yml'), graph.nodes.find((node) => node.title === 'en.yml')!.summary, 'a node of no unit keeps its own words')
})

test('the walk goes to each node once: a node an earlier step holds is not in a later step’s focus', async () => {
  const graph = await review()
  // Two units of the change review whose places both fall on the lines of `total`, as when the map held one twice.
  const twice: UnitPlace[] = [...places, { id: 'n9', kind: 'general', path: 'app/models/cart.rb', lines: [2, 2], change: 'modified' }]
  const units = [unit('u1', 1, { nodes: ['n1'] }), unit('u2', 2, { nodes: ['n9', 'n2'] })]
  const story = unitStory(graph, { units, places: twice, words: null, story: STORY, buckets: [] })
  const walks = story.filter((step) => step.kind === 'walk')
  const seen = walks.flatMap((step) => step.focus)
  assert.equal(new Set(seen).size, seen.length, 'no node is the focus of two steps')
  assert.equal(walks[0]!.focus.length, 1)
  assert.equal(walks[1]!.focus.length, 1, 'the later step keeps the node that is its alone')
})

test('a unit whose nodes an earlier step showed goes back to them, so no step of the walk is left with none', async () => {
  const graph = await review()
  // The second unit's only place is `total`, which the first step showed already.
  const again: UnitPlace[] = [...places, { id: 'n9', kind: 'general', path: 'app/models/cart.rb', lines: [2, 2], change: 'modified' }]
  const units = [unit('u1', 1, { nodes: ['n1'] }), unit('u2', 2, { nodes: ['n9'] })]
  const walks = unitStory(graph, { units, places: again, words: null, story: STORY, buckets: [] }).filter((step) => step.kind === 'walk')
  assert.equal(walks.length, 2)
  assert.ok(walks.every((step) => step.focus.length > 0), 'every step of the walk has a node')
  assert.deepEqual(walks[1]!.focus, walks[0]!.focus, 'it goes back to the node that holds its code')
})

test('a part the Reviewer renamed takes its words, one it took out says why, and unchanged code it put in a unit is in that step', async () => {
  const graph = await review()
  const cart = graph.files.find((file) => file.path === 'app/models/cart.rb')!
  // Unchanged code the graph shows beside the change, as the call-graph scan finds it.
  const context: ReviewNode = { id: 'c9', kind: 'context', title: 'Cart', subtitle: 'app/models/cart.rb', change: 'unchanged', summary: 'Unchanged. It calls the change.', anchors: [{ fileId: cart.id, side: 'added', startLine: 1, endLine: 1, hash: '' }], position: { x: 0, y: 0 } }
  const shown = { ...graph, nodes: [...graph.nodes, context] }
  const reshaped: UnitPlace[] = [
    { id: 'n1', kind: 'function', path: 'app/models/cart.rb', lines: [2, 2], change: 'modified', told: { title: 'The rounded total', what: 'It rounds the total now.' } },
    { id: 'n2', kind: 'function', path: 'app/models/cart.rb', lines: [4, 4], change: 'removed', hidden: 'nothing calls it any more' },
    { id: 'm1', kind: 'general', path: 'app/models/cart.rb', lines: [1, 1], change: 'none', told: { what: 'The class the total lives in.' } },
  ]
  const units = [unit('u1', 1, { nodes: ['n1', 'm1'], grouping: 'regrouped' })]
  const nodes = unitWords(shown, { units, places: reshaped, words: null, runs: [] })
  const of = (id: string) => nodes.find((node) => node.id === id)!
  const idOf = (title: string) => graph.nodes.find((node) => node.title === title)!.id

  assert.deepEqual([of(idOf('total')).title, of(idOf('total')).summary], ['The rounded total', 'It rounds the total now.'])
  assert.equal(of(idOf('old_total')).summary, 'Left out of the story by the Reviewer: nothing calls it any more.')
  assert.equal(of(idOf('old_total')).title, 'old_total')
  assert.deepEqual([of('c9').title, of('c9').summary], ['Cart', 'The class the total lives in.'])

  const story = unitStory({ ...shown, nodes }, { units, places: reshaped, words: null, story: STORY, buckets: [] })
  const step = story.find((item) => item.unit === 'u1')!
  assert.ok(step.focus.includes(idOf('total')) && step.focus.includes('c9'), `the step frames the change and the context put with it: ${step.focus.join(', ')}`)
  assert.ok(!story.some((item) => item.focus.includes(idOf('old_total'))), 'no step goes to the part taken out')
})
