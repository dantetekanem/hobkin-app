import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { AssessmentSummary } from '#shared/review/assessment.ts'
import type { Review } from '#shared/review/types.ts'
import type { Vicinity } from '#shared/review/vicinity.ts'
import { assessmentFolder } from '../src/review/assessment.ts'
import { carryReview, type TestRun } from '../src/review/carry.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const TARGET = { kind: 'change' as const, slug: 'shop', item: '4c9e21' }
const BRANCH = 'hobkin/4c9e21-round-the-total'

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
  write('src/total.js', 'export const total = (a, b) => a + b\n')
  write('src/other.js', 'export const other = 1\n')
  write('test/total.test.js', "test('total', () => {})\n")
  git('add', '.')
  git('commit', '--quiet', '-m', 'Start')
  const start = git('rev-parse', 'HEAD')
  git('checkout', '--quiet', '-b', BRANCH)
  write('src/total.js', 'export const total = (a, b) => Math.round(a + b)\n')
  git('commit', '--quiet', '-am', 'Round the total')
  const built = git('rev-parse', 'HEAD')
  git('checkout', '--quiet', 'main')

  const review = {
    change: { project: 'shop', item: TARGET.item, title: 'Round the total', branch: BRANCH, base: start, head: built },
    nodes: callers.map(({ path, title }, index) => ({ id: `v${index + 1}`, kind: 'context', title, subtitle: path, change: 'unchanged', summary: '', lifecycle: { role: 'caller', hops: 1 }, anchors: [], position: { x: 0, y: 0 } })),
  } as unknown as Review
  const files = [{ fileId: 'src/total.js', path: 'src/total.js', base: 'export const total = (a, b) => a + b\n', head: 'export const total = (a, b) => Math.round(a + b)\n', binary: false }]
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
  assert.deepEqual(carried, { carried: true, from: project.built, why: `Only its start moved: the same commits on ${start.slice(0, 7)}, and nothing it read changed.` })
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

  assert.deepEqual(carried, { carried: true, from: project.built, why: 'Only specs or Markdown changed since the commit it was built for, so the code it read is the same.' })
  // Code on top is no carry.
  const coded = project.commitOnBranch({ 'src/other.js': 'export const other = 3\n' })
  assert.deepEqual(await carrier(project).carry(coded), { carried: false, why: 'Its code changed since the commit it was built for.' })
})

function readHeadOf(repo: string, ref: string): string {
  return execFileSync('git', ['-C', repo, 'rev-parse', ref], { encoding: 'utf8' }).trim()
}
