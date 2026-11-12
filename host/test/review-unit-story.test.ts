import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Unit } from '#shared/review/assessment.ts'
import { captureChange, type ChangeReader } from '#shared/review/capture.ts'
import { prepareReview } from '#shared/review/prepare.ts'
import { NO_SPEC_NOTICE } from '#shared/review/types.ts'
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

test('a test says how the change review ran it: failing at the change’s commit, proving the change, passing, or not run and why', async () => {
  const graph = await review()
  const test = graph.nodes.find((node) => node.kind === 'test')!
  const words = (runs: Parameters<typeof unitWords>[1]['runs'], notRun?: string) =>
    unitWords(graph, { units: [], places, words: null, runs, ...(notRun ? { notRun } : {}) }).find((node) => node.id === test.id)!
  const file = 'test/models/cart_test.rb'
  assert.deepEqual([words([{ kind: 'baseline', tests: [file], failed: [file] }]).status, words([{ kind: 'baseline', tests: [file], failed: [file] }]).summary], ['failed', `${words([]).summary.split('. ')[0]}. It fails at the change's commit.`])
  assert.equal(words([{ kind: 'baseline', tests: [file], failed: [] }, { kind: 'probe', node: 'n1', tests: [file], failed: [file] }]).status, 'proves-change')
  assert.equal(words([{ kind: 'baseline', tests: [file], failed: [] }, { kind: 'revert', node: 'n1', tests: [file], failed: [] }]).status, 'passed')
  assert.match(words([], 'no way to run this repository’s tests was found.').summary, /Not run: no way to run this repository’s tests was found\.$/)
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
