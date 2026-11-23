import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { captureChange, type ChangedPath, type ChangeReader } from '#shared/review/capture.ts'
import { prepareReview } from '#shared/review/prepare.ts'
import type { Review, ReviewFileContents, ReviewNode } from '#shared/review/types.ts'
import { assessmentFolder, Assessments } from '../src/review/assessment.ts'
import { Reviews } from '../src/review/reviews.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const BASE_SHA = 'b'.repeat(40)
const HEAD_SHA = 'c'.repeat(40)
const ID = 'change:shop:4c9e21'
const TARGET = { kind: 'change' as const, slug: 'shop', item: '4c9e21' }

const fn = (name: string, body: string) => `export function ${name}(value: number) {\n  ${body}\n}\n`

/** Both sides of a change of every kind: code the review rates, a test, and files read at a glance. */
const BASE: Record<string, string> = {
  'src/cart.ts': fn('total', 'return 0'),
  'src/tax.ts': fn('tax', 'return value'),
  'src/label.ts': fn('label', 'return String(value)'),
  'src/spaced.ts': 'export const add = (a,b) => a+b\n',
  'src/old.ts': fn('kept', 'return value'),
  'test/cart.test.ts': "test('total', () => {\n  expect(total(1)).toBe(0)\n})\n",
  'pnpm-lock.yaml': 'lockfileVersion: 8\n',
  'config/locales/en.yml': 'en:\n  cart: Cart\n',
  'README.md': 'A shop.\n',
  'dist/bundle.js': 'var a=1\n',
}
const HEAD: Record<string, string> = {
  ...BASE,
  'src/cart.ts': fn('total', 'return value * 100'),
  'src/tax.ts': fn('tax', 'return Math.round(value * 0.13)'),
  'src/label.ts': fn('label', 'return `#${value}`'),
  'src/spaced.ts': 'export const add = (a, b) => a + b\n',
  'test/cart.test.ts': "test('total', () => {\n  expect(total(1)).toBe(100)\n})\n",
  'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  'config/locales/en.yml': 'en:\n  cart: Basket\n',
  'README.md': 'A shop that rounds.\n',
  'dist/bundle.js': 'var a=2\n',
}

async function change(): Promise<{ review: Review; files: ReviewFileContents[] }> {
  const reader: ChangeReader = {
    changed: async () => [
      ...Object.keys(BASE)
        .filter((path) => path !== 'src/old.ts' && BASE[path] !== HEAD[path])
        .map((path): ChangedPath => ({ path, status: 'modified' })),
      { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'renamed' },
    ],
    read: async (commit, path) => {
      const text = commit === BASE_SHA ? BASE[path] : (HEAD[path] ?? (path === 'src/new.ts' ? HEAD['src/old.ts'] : undefined))
      return text == null ? { kind: 'missing' } : { kind: 'text', text }
    },
  }
  const capture = await captureChange(reader, BASE_SHA, HEAD_SHA)
  const review = await prepareReview({ id: ID, change: { project: 'shop', item: '4c9e21', title: 'Round the totals', branch: 'hobkin/4c9e21' }, capture, spec: null, readHead: async () => null })
  const files = capture.files.map(({ id, path, oldPath, base, head, binary }) => ({ fileId: id, path, ...(oldPath ? { oldPath } : {}), base, head, binary }))
  return { review, files }
}

/** What the change review left in the home: `total` high and critical with nothing testing it, `tax` mid where the blind check disagreed, `label` safe. */
function reviewed(t: TestContext, { review, files }: { review: Review; files: ReviewFileContents[] }) {
  const root = temporaryDirectory(t)
  reviewStore(root).write(TARGET, review, files)
  const folder = assessmentFolder(root, TARGET, HEAD_SHA)
  mkdirSync(folder, { recursive: true })
  const write = (name: string, value: unknown) => writeFileSync(join(folder, name), typeof value === 'string' ? value : JSON.stringify(value))
  const facts = (effect: string, proof: string) => ({
    effect: { value: effect, evidence: '' },
    proof: { value: proof, evidence: '' },
    exposure: { value: 'everyone', evidence: '' },
    undo: { value: 'rollback', evidence: '' },
  })
  const unit = (id: string, level: string, nodes: string[]) => ({
    id,
    title: id,
    level,
    critical: level === 'high',
    nodes,
    grouping: 'single',
    story_order: 1,
    where: '',
    what: '',
    code: [],
    facts: facts('behaviour', 'none'),
    why_level: [],
    would_change: [],
    watch: 'not assessed',
    questions: [],
    reading_minutes: 1,
  })
  write('summary.json', { level: 'high', critical: true, needsYou: 1, worthALook: 1, safe: 1, storyBy: 'model', at: '2026-11-21T10:00:00.000Z' })
  write('units.json', { schema: 'review-units/1', map: 'node-level', attention: { units: 3, reading_minutes: 3 }, units: [unit('u1', 'high', ['n1']), unit('u2', 'mid', ['n2']), unit('u3', 'safe', ['n3'])] })
  write('story.md', '# Round the totals\n')
  const node = (id: string, symbol: string, path: string, level: string, more: object) => ({
    id,
    kind: 'function',
    symbol,
    path,
    lines: [1, 3],
    change: 'modified',
    level: { current: level },
    critical: false,
    findings: [],
    questions: [],
    sensitive: [],
    ...more,
  })
  write('graph.json', {
    nodes: [
      node('n1', 'total', 'src/cart.ts', 'high', { critical: true, facts: facts('data', 'none'), questions: [{ text: 'Do totals stay in cents?', why: 'unknown' }], sensitive: ['money'] }),
      node('n2', 'tax', 'src/tax.ts', 'mid', { facts: facts('behaviour', 'isolated') }),
      node('n3', 'label', 'src/label.ts', 'safe', { facts: facts('behaviour', 'lifecycle') }),
    ],
  })
  write('blind-check.json', { ran: true, check: { units: [{ id: 'u2', agree: 'no', level_i_would_give: 'high', understood: 'yes', context: 'about right' }], needs: [] } })
  const assessments = new Assessments({ root, run: async () => Promise.reject(new Error('not run here')), repoOf: () => null })
  const source = { head: async () => HEAD_SHA, read: async () => Promise.reject(new Error('not read here')) }
  const reviews = new Reviews({ store: reviewStore(root), sources: { change: source, pull: source }, work: () => ({ workAction: async () => ({}) }), card: () => null, head: () => HEAD_SHA, assessments })
  t.after(() => reviews.close())
  return { reviews, assessments, root }
}

const at = (nodes: readonly ReviewNode[], path: string, kind = 'code') => nodes.find((node) => node.subtitle === path && node.kind === kind)!

test('a review opens with every node saying how much attention it asks for, why, its place, and what kind of change it is', async (t) => {
  const { reviews, assessments } = reviewed(t, await change())
  const { review } = reviews.get(ID)
  const { nodes } = review

  const total = at(nodes, 'src/cart.ts')
  assert.deepEqual([total.attention?.tier, total.bucket], ['needs-you', 'code'])
  assert.deepEqual(total.attention?.reasons, ['Needs a fix, not only a look.', 'Changes data it writes, and no test covers it.', 'It leaves you a question to answer.'])
  const tax = at(nodes, 'src/tax.ts')
  assert.equal(tax.attention?.tier, 'needs-you', 'the blind check disagreed with its unit')
  assert.ok(tax.attention?.reasons.includes('A second, blind reading would rate it high risk.'))
  const label = at(nodes, 'src/label.ts')
  assert.deepEqual([label.attention?.tier, label.attention?.reasons], ['safe', []])

  // What the change review did not rate still has a kind and a tier, from what is known of its file.
  const unrated = ['pnpm-lock.yaml', 'config/locales/en.yml', 'README.md', 'dist/bundle.js', 'src/new.ts', 'src/spaced.ts']
  const nodeAt = (path: string) => nodes.find((node) => node.subtitle === path)
  const kinds = Object.fromEntries(unrated.map((path) => [path, nodeAt(path)?.bucket]))
  assert.deepEqual(kinds, {
    'pnpm-lock.yaml': 'lockfile',
    'config/locales/en.yml': 'locale',
    'README.md': 'docs',
    'dist/bundle.js': 'generated',
    'src/new.ts': 'moved',
    'src/spaced.ts': 'format',
  })
  // Safe by its kind alone only when nobody reads it line by line; anything else the review did not rate is worth a look.
  const tiers = Object.fromEntries(unrated.map((path) => [path, nodeAt(path)?.attention?.tier]))
  assert.deepEqual(tiers, {
    'pnpm-lock.yaml': 'safe',
    'config/locales/en.yml': 'safe',
    'dist/bundle.js': 'safe',
    'README.md': 'worth-a-look',
    'src/new.ts': 'worth-a-look',
    'src/spaced.ts': 'worth-a-look',
  })
  assert.equal(nodes.find((node) => node.kind === 'test')?.bucket, 'test')

  // Every node has its place, from 1, and the reviewer's go first.
  assert.ok(nodes.every((node) => node.attention && node.bucket), 'every node')
  assert.deepEqual(nodes.map((node) => node.attention!.rank).sort((a, b) => a - b), nodes.map((_, index) => index + 1))
  const order = { 'needs-you': 0, 'worth-a-look': 1, safe: 2 }
  const ranked = [...nodes].sort((a, b) => a.attention!.rank - b.attention!.rank)
  const tierOrder = ranked.map((node) => order[node.attention!.tier])
  assert.deepEqual(tierOrder, [...tierOrder].sort())
  assert.equal(ranked[0], total, 'the strongest reasons first')

  // The rated definitions carry what the change review found, for the window.
  const read = assessments.read(TARGET, HEAD_SHA)!.nodes
  const rated = read.find((node) => node.id === 'n1')!
  assert.deepEqual([rated.effect, rated.proof, rated.questions, rated.sensitive, rated.blind], ['data', 'none', 1, ['money'], undefined])
  assert.deepEqual(read.find((node) => node.id === 'n2')!.blind, { agrees: false, level: 'high' })
})

test('a test the change edits that did not run needs the reviewer, with why: its command could not start, or no command takes it', async (t) => {
  const prepared = await change()
  const testOf = async (graph: object) => {
    const { reviews, root } = reviewed(t, prepared)
    const folder = assessmentFolder(root, TARGET, HEAD_SHA)
    const nodes = JSON.parse(readFileSync(join(folder, 'graph.json'), 'utf8')).nodes
    writeFileSync(join(folder, 'graph.json'), JSON.stringify({ nodes, ...graph }))
    return reviews.get(ID).review.nodes.find((node) => node.kind === 'test' && node.subtitle === 'test/cart.test.ts')!
  }
  const asks = (node: ReviewNode, why: string) => {
    assert.equal(node.status, 'not-run')
    assert.ok(node.summary.endsWith(`Not run: ${why}`), node.summary)
    assert.deepEqual([node.attention?.tier, node.attention?.reasons[0]], ['needs-you', `This test of the change did not run: ${why}`])
  }
  // The run is one no definition picked: the graph keeps it beside its nodes.
  const vitest = 'the test command could not start here (Cannot find module vitest).'
  asks(await testOf({ runs: [{ kind: 'baseline', tests: ['test/cart.test.ts'], failed: [], exit_code: 1, not_run: vitest }] }), vitest)
  const notTaken = 'this review runs tests with bin/rails with a test folder, which does not take it.'
  asks(await testOf({ runs: [], not_run: [{ path: 'test/cart.test.ts', why: notTaken }] }), notTaken)
  const ran = await testOf({ runs: [{ kind: 'baseline', tests: ['test/cart.test.ts'], failed: [], exit_code: 0 }] })
  assert.deepEqual([ran.status, ran.attention?.tier], ['passed', 'safe'])
})

test('a review with no AI review ready opens as it did, with no attention and no kind on its nodes, and its stored graph is not drawn again', async (t) => {
  const prepared = await change()
  const { reviews, root } = reviewed(t, prepared)
  rmSync(join(root, 'client', 'reviews', 'change+shop+4c9e21', 'change-review'), { recursive: true, force: true })
  const { review } = reviews.get(ID)
  assert.ok(review.nodes.every((node) => node.attention === undefined && node.bucket === undefined))
  assert.equal(review.nodes.length, prepared.review.nodes.length)
})

test('what a change removes is at least worth a look, and a removal other code still uses needs the reviewer, from the AI review’s own answer', async (t) => {
  const base: Record<string, string> = {
    'src/cart.ts': `${fn('total', 'return 0')}\n${fn('oldTotal', 'return 1')}`,
    'src/unused.ts': fn('unused', 'return 2'),
    'test/fixtures/cart.json': '{ "total": 1 }\n',
  }
  const reader: ChangeReader = {
    changed: async () => [
      { path: 'src/cart.ts', status: 'modified' },
      { path: 'src/unused.ts', status: 'deleted' },
      { path: 'test/fixtures/cart.json', status: 'deleted' },
    ],
    read: async (commit, path) => {
      const text = commit === BASE_SHA ? base[path] : path === 'src/cart.ts' ? fn('total', 'return 0') : undefined
      return text == null ? { kind: 'missing' } : { kind: 'text', text }
    },
  }
  const capture = await captureChange(reader, BASE_SHA, HEAD_SHA)
  const review = await prepareReview({ id: ID, change: { project: 'shop', item: '4c9e21', title: 'Drop the old totals', branch: 'hobkin/4c9e21' }, capture, spec: null, readHead: async () => null })
  const files = capture.files.map(({ id, path, base: before, head: after, binary }) => ({ fileId: id, path, base: before, head: after, binary }))
  const root = temporaryDirectory(t)
  reviewStore(root).write(TARGET, review, files)
  const folder = assessmentFolder(root, TARGET, HEAD_SHA)
  mkdirSync(folder, { recursive: true })
  const write = (name: string, value: unknown) => writeFileSync(join(folder, name), JSON.stringify(value))
  const unit = (id: string, level: string, nodes: string[]) => ({
    id,
    title: id,
    level,
    critical: level === 'high',
    nodes,
    grouping: 'single',
    story_order: 1,
    where: '',
    what: '',
    code: [],
    why_level: [],
    would_change: [],
    watch: 'not assessed',
    questions: [],
    reading_minutes: 1,
  })
  write('summary.json', { level: 'high', critical: true, needsYou: 1, worthALook: 0, safe: 1, storyBy: 'host', at: '2026-11-21T10:00:00.000Z' })
  write('units.json', { schema: 'review-units/1', map: 'node-level', attention: { units: 2, reading_minutes: 2 }, units: [unit('u1', 'high', ['n1']), unit('u2', 'safe', ['n2'])] })
  writeFileSync(join(folder, 'story.md'), '# Drop the old totals\n')
  // As the engine writes them: a removed definition sits on its lines at base. `oldTotal` is still called elsewhere; `unused` is not.
  const removed = {
    kind: 'function',
    change: 'removed',
    questions: [],
    sensitive: [],
    facts: { effect: { value: 'behaviour' }, proof: { value: 'none' }, exposure: { value: 'everyone' }, undo: { value: 'rollback' } },
  }
  const dangling = { rule: 'dangling-reference', text: 'oldTotal is removed while src/report.ts still refers to it.', by: 'search' }
  write('graph.json', {
    nodes: [
      { ...removed, id: 'n1', symbol: 'oldTotal', path: 'src/cart.ts', lines: [5, 7], level: { current: 'high' }, critical: true, findings: [dangling] },
      { ...removed, id: 'n2', symbol: 'unused', path: 'src/unused.ts', lines: [1, 3], level: { current: 'safe' }, critical: false, findings: [] },
    ],
  })
  const assessments = new Assessments({ root, run: async () => Promise.reject(new Error('not run here')), repoOf: () => null })
  const source = { head: async () => HEAD_SHA, read: async () => Promise.reject(new Error('not read here')) }
  const reviews = new Reviews({ store: reviewStore(root), sources: { change: source, pull: source }, work: () => ({ workAction: async () => ({}) }), card: () => null, head: () => HEAD_SHA, assessments })
  t.after(() => reviews.close())

  const { nodes } = reviews.get(ID).review
  const oldTotal = nodes.find((node) => node.subtitle === 'src/cart.ts' && node.change === 'deleted')!
  assert.deepEqual([oldTotal.attention?.tier, oldTotal.attention?.reasons[0], oldTotal.level], ['needs-you', 'Removes something other code still uses.', 'high'])
  const unused = nodes.find((node) => node.subtitle === 'src/unused.ts')!
  assert.deepEqual([unused.attention?.tier, unused.attention?.reasons], ['worth-a-look', ['It only removes code: check nothing still needs it.']])
  const fixture = nodes.find((node) => node.subtitle === 'test/fixtures/cart.json')!
  assert.deepEqual([fixture.kind, fixture.attention?.tier, fixture.attention?.reasons[0]], ['file', 'worth-a-look', 'It removes part of the tests: check that what they covered still is.'])
  assert.deepEqual(assessments.read(TARGET, HEAD_SHA)!.nodes.map((node) => [node.id, node.removed]), [['n1', true], ['n2', true]], 'the removed definitions are carried, marked removed')
})
