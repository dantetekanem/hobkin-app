import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { AssessmentSummary } from '#shared/review/assessment.ts'
import type { Review } from '#shared/review/types.ts'
import type { Vicinity } from '#shared/review/vicinity.ts'
import { assessmentFolder, Assessments } from '../src/review/assessment.ts'
import { carryReview, runTests, type TestRun } from '../src/review/carry.ts'
import { Reviews } from '../src/review/reviews.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const TARGET = { kind: 'change' as const, slug: 'shop', item: '4c9e21' }
const BRANCH = 'hobkin/4c9e21-round-the-total'

/** The changed file: it imports the rate, and names the receipt's words it reads. */
const TOTAL_AT_BASE = "import { rate } from './rate.js'\nexport const receipt = 'prompts/receipt.md'\nexport const total = (a, b) => (a + b) * rate\n"
const TOTAL_AT_HEAD = "import { rate } from './rate.js'\nexport const receipt = 'prompts/receipt.md'\nexport const total = (a, b) => Math.round((a + b) * rate)\n"

/** A project with main and a finished branch on it, and the change's review and change review built at the branch's commit. */
function reviewed(t: TestContext, { callers = [] }: { callers?: { path: string; title: string }[] } = {}) {
  const repo = join(temporaryDirectory(t), 'repo')
  const root = temporaryDirectory(t)
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
  const write = (path: string, text: string) => {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  git('init', '--quiet', '--initial-branch=main')
  write('src/total.js', TOTAL_AT_BASE)
  write('src/rate.js', 'export const rate = 1\n')
  write('src/other.js', 'export const other = 1\n')
  write('prompts/receipt.md', 'Total\n')
  write('test/support/items.js', 'export const items = []\n')
  write('test/total.test.js', "import { items } from './support/items.js'\nimport { total } from '../src/total.js'\ntest('total', () => {})\n")
  git('add', '.')
  git('commit', '--quiet', '-m', 'Start')
  const start = git('rev-parse', 'HEAD')
  git('checkout', '--quiet', '-b', BRANCH)
  write('src/total.js', TOTAL_AT_HEAD)
  git('commit', '--quiet', '-am', 'Round the total')
  const built = git('rev-parse', 'HEAD')
  git('checkout', '--quiet', 'main')

  const review = {
    change: { project: 'shop', item: TARGET.item, title: 'Round the total', branch: BRANCH, base: start, head: built },
    nodes: callers.map(({ path, title }, index) => ({ id: `v${index + 1}`, kind: 'context', title, subtitle: path, change: 'unchanged', summary: '', lifecycle: { role: 'caller', hops: 1 }, anchors: [], position: { x: 0, y: 0 } })),
  } as unknown as Review
  const files = [{ fileId: 'src/total.js', path: 'src/total.js', base: TOTAL_AT_BASE, head: TOTAL_AT_HEAD, binary: false }]
  const store = reviewStore(root)
  store.write(TARGET, review, files, { preparedAt: '2026-11-22T10:00:00.000Z', storyBy: 'host' })
  const folder = assessmentFolder(root, TARGET, built)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'graph.json'), JSON.stringify({ nodes: [], runs: [{ kind: 'baseline', tests: ['test/total.test.js'], failed: [] }] }))
  writeFileSync(join(folder, 'units.json'), JSON.stringify({ units: [] }))
  writeFileSync(join(folder, 'summary.json'), JSON.stringify({ level: 'safe', critical: false, needsYou: 0, worthALook: 0, safe: 1, storyBy: 'model', at: '2026-11-22T10:00:00.000Z' } satisfies AssessmentSummary))

  /** main moves on with `files`, and the branch is rebased onto it: its commits are the same ones on a newer start. */
  const rebaseOnto = (files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files)) write(path, text)
    git('add', '.')
    git('commit', '--quiet', '-m', 'Main moves on')
    git('checkout', '--quiet', BRANCH)
    git('rebase', '--quiet', 'main')
    const head = git('rev-parse', 'HEAD')
    git('checkout', '--quiet', 'main')
    return head
  }
  /** The branch gets one commit of `files` on top. */
  const commitOnBranch = (files: Record<string, string>) => {
    git('checkout', '--quiet', BRANCH)
    for (const [path, text] of Object.entries(files)) write(path, text)
    git('add', '.')
    git('commit', '--quiet', '-m', 'More')
    const head = git('rev-parse', 'HEAD')
    git('checkout', '--quiet', 'main')
    return head
  }
  return { repo, root, store, built, rebaseOnto, commitOnBranch }
}

/** The carry, with a stand-in scan and test run that count what they are asked, and the repository as its checkout. */
function carrier({ repo, root, store }: ReturnType<typeof reviewed>, { scan = { links: [] }, passes = true }: { scan?: Vicinity; passes?: boolean } = {}) {
  const ran: string[][] = []
  const tests: TestRun = async (_tree, files) => {
    ran.push([...files])
    return passes ? { passed: true } : { passed: false, why: 'test/total.test.js failed.' }
  }
  const carry = (head: string) => carryReview({ root, store, inTree: (_target, _repo, _head, use) => use(repo), target: TARGET, repo, into: 'main', head, scan: async () => scan, tests })
  return { carry, ran }
}

test('a change rebased with the same commits onto a main that changed nothing it read is carried: no model call, one test run at the new commit', async (t) => {
  const project = reviewed(t)
  const head = project.rebaseOnto({ 'src/other.js': 'export const other = 2\n' })
  const { carry, ran } = carrier(project)

  const carried = await carry(head)

  const start = readHeadOf(project.repo, 'main')
  assert.deepEqual(carried, { carried: true, from: project.built, why: `Only its start moved: the same commits on ${start.slice(0, 7)}, and nothing it depends on changed.` })
  assert.deepEqual(ran, [['test/total.test.js']])
  assert.ok(project.store.has(TARGET, head))
  const summary = JSON.parse(readFileSync(join(assessmentFolder(project.root, TARGET, head), 'summary.json'), 'utf8')) as AssessmentSummary
  assert.deepEqual(summary.carried, { from: project.built, why: carried.why, tests: 1 })
  assert.deepEqual(JSON.parse(readFileSync(join(assessmentFolder(project.root, TARGET, head), 'units.json'), 'utf8')), { units: [] }, 'its units come along')
})

test('main changed a file the review read, or a caller of a changed definition: it is built again', async (t) => {
  const changedTest = reviewed(t)
  const head = changedTest.rebaseOnto({ 'test/total.test.js': "test('total', () => { expect(1).toBe(1) })\n" })
  assert.deepEqual(await carrier(changedTest).carry(head), { carried: false, why: 'The test test/total.test.js changed since.' })

  const newCaller = reviewed(t)
  const moved = newCaller.rebaseOnto({ 'src/other.js': 'export const other = 2\n' })
  const caller: Vicinity = { links: [{ near: { changed: { path: 'src/total.js', line: 1 } }, other: { path: 'src/other.js', symbol: 'other', startLine: 1, endLine: 1 }, direction: 'caller', hops: 1, call: { line: 1, name: 'total' }, proven: true }] }
  const { carry, ran } = carrier(newCaller, { scan: caller })
  assert.deepEqual(await carry(moved), { carried: false, why: 'The scan finds other callers of the changed code now.' })
  assert.deepEqual(ran, [], 'nothing runs once it does not hold')
})

test('a carried review whose tests fail at the new commit is built again in its turn', async (t) => {
  const project = reviewed(t)
  const head = project.rebaseOnto({ 'src/other.js': 'export const other = 2\n' })

  const carried = await carrier(project, { passes: false }).carry(head)

  assert.deepEqual(carried, { carried: false, why: `Its tests did not pass at ${head.slice(0, 7)}: test/total.test.js failed.` })
  assert.equal(project.store.has(TARGET, head), false)
})

test('commits of specs or docs alone carry the review and say so', async (t) => {
  const project = reviewed(t)
  const head = project.commitOnBranch({ '_specs/058/spec.md': '# The line\n', 'docs/notes.md': 'Notes.\n' })

  const carried = await carrier(project).carry(head)

  assert.deepEqual(carried, { carried: true, from: project.built, why: 'Only specs or docs nothing reads changed since the commit it was built for, so the code it read is the same.' })
  // Code on top is no carry.
  const coded = project.commitOnBranch({ 'src/other.js': 'export const other = 3\n' })
  assert.deepEqual(await carrier(project).carry(coded), { carried: false, why: 'Its code changed since the commit it was built for: src/other.js is no spec or document nothing reads.' })
})

test('the background carries a change that moved in the line instead of building it again, and the review says it was carried and from where', async (t) => {
  const project = reviewed(t)
  const head = project.rebaseOnto({ 'src/other.js': 'export const other = 2\n' })
  const { carry } = carrier(project)
  const reads: string[] = []
  const assessments = new Assessments({ root: project.root, run: async () => Promise.reject(new Error('no model is asked')), repoOf: () => project.repo })
  const reviews = new Reviews({
    store: project.store,
    sources: {
      change: { head: async () => head, read: async (_target, at) => (reads.push(at), Promise.reject(new Error('not built here'))) },
      pull: { head: async () => null, read: async () => Promise.reject(new Error('no')) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    head: () => head,
    assessments,
    carry: (_target, at) => carry(at),
  })
  t.after(() => reviews.close())

  reviews.watch([{ id: 'change:shop:4c9e21', head, project: 'Shop' }])
  for (let turn = 0; turn < 100 && !project.store.has(TARGET, head); turn += 1) await new Promise((resolve) => setTimeout(resolve, 20))

  assert.deepEqual(reads, [], 'nothing was built again')
  const status = reviews.status('change:shop:4c9e21')
  assert.deepEqual([status.state, status.stale, status.carried?.from], ['ready', false, project.built])
  assert.equal(reviews.list().reviews.find((row) => row.id === 'change:shop:4c9e21')?.carried?.from, project.built)
})

test('Review again with nothing changed says so, and that it costs a whole review, and builds only on a second press', async (t) => {
  const project = reviewed(t)
  const reads: string[] = []
  const reviews = new Reviews({
    store: project.store,
    sources: {
      change: { head: async () => project.built, read: async (_target, at) => (reads.push(at), Promise.reject(new Error('not built here'))) },
      pull: { head: async () => null, read: async () => Promise.reject(new Error('no')) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    head: () => project.built,
    assessments: new Assessments({ root: project.root, run: async () => Promise.reject(new Error('no model is asked')), repoOf: () => project.repo }),
  })
  t.after(() => reviews.close())
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

  const first = reviews.prepare('change:shop:4c9e21', { refresh: true, asked: true })
  await settle()

  assert.equal(first.again?.why, 'Nothing changed since this review: building it again costs a whole review, with its tests and its model calls. Ask again to build it.')
  assert.deepEqual(reads, [])

  reviews.prepare('change:shop:4c9e21', { refresh: true, asked: true })
  await settle()
  assert.deepEqual(reads, [project.built], 'the second press builds it')
})

test('main changed something the change imports, calls or names, or that its tests import: it is built again', async (t) => {
  const refusals: [Record<string, string>, Vicinity | undefined, RegExp][] = [
    [{ 'src/rate.js': 'export const rate = 2\n' }, undefined, /src\/rate\.js, which the change or its tests use, changed/],
    [{ 'src/tax.js': 'export const tax = 2\n' }, { links: [{ near: { changed: { path: 'src/total.js', line: 3 } }, other: { path: 'src/tax.js', symbol: 'tax', startLine: 1, endLine: 1 }, direction: 'callee', hops: 1, call: { line: 3, name: 'tax' }, proven: true }] }, /src\/tax\.js, which the change or its tests use, changed/],
    [{ 'test/support/items.js': 'export const items = [1]\n' }, undefined, /the test test\/support\/items\.js changed/],
    [{ 'prompts/receipt.md': 'Total due\n' }, undefined, /prompts\/receipt\.md, which the change or its tests name, changed/],
  ]
  for (const [files, scan, why] of refusals) {
    const project = reviewed(t)
    const head = project.rebaseOnto(files)
    const { carry, ran } = carrier(project, scan ? { scan } : {})
    const carried = await carry(head)
    assert.equal(carried.carried, false, Object.keys(files)[0])
    assert.match(carried.why, why)
    assert.deepEqual(ran, [], 'nothing runs once it does not hold')
  }
})

test('main changed a manifest, a lockfile, a config, a migration, a schema or added a test: it is built again', async (t) => {
  for (const path of ['package.json', 'pnpm-lock.yaml', 'config/limits.json', 'db/migrate/20261123_add_cents.rb', 'db/schema.rb', 'test/rounding.test.js']) {
    const project = reviewed(t)
    const head = project.rebaseOnto({ [path]: '{}\n' })
    const carried = await carrier(project).carry(head)
    assert.equal(carried.carried, false, path)
    assert.match(carried.why, new RegExp(path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')), path)
  }
})

test('a Markdown file the code reads is code, so a branch commit of it alone builds the review again', async (t) => {
  const project = reviewed(t)
  const head = project.commitOnBranch({ 'prompts/receipt.md': 'Total due\n' })

  const carried = await carrier(project).carry(head)

  assert.deepEqual(carried, { carried: false, why: 'Its code changed since the commit it was built for: prompts/receipt.md is no spec or document nothing reads.' })
})

test("the change's tests carry it only when the runner counts every one passed: none skipped, and at least one", async (t) => {
  const tree = temporaryDirectory(t)
  writeFileSync(join(tree, 'package.json'), JSON.stringify({ name: 'shop', type: 'module', scripts: { test: 'node --test' } }))
  mkdirSync(join(tree, 'test'))
  writeFileSync(join(tree, 'test', 'passes.test.js'), "import { test } from 'node:test'\ntest('adds', () => {})\n")
  writeFileSync(join(tree, 'test', 'skips.test.js'), "import { test } from 'node:test'\ntest('adds', { skip: true }, () => {})\n")
  writeFileSync(join(tree, 'test', 'empty.test.js'), "// No test here.\n")

  assert.deepEqual(await runTests(tree, ['test/passes.test.js']), { passed: true })
  const skipped = await runTests(tree, ['test/skips.test.js'])
  assert.deepEqual([skipped.passed, skipped.why], [false, 'test/skips.test.js: 1 test skipped, so the change\'s tests did not all run.'])
  const none = await runTests(tree, ['test/empty.test.js'])
  assert.deepEqual([none.passed, none.why], [false, 'test/empty.test.js: no test ran.'])
})

function readHeadOf(repo: string, ref: string): string {
  return execFileSync('git', ['-C', repo, 'rev-parse', ref], { encoding: 'utf8' }).trim()
}
