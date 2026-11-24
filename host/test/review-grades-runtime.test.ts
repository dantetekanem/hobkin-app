import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import * as hobkinControls from 'hobkin/src/cli/work/controls.mjs'
import * as hobkinStore from 'hobkin/src/cli/work/store.mjs'
import type { ReviewNeeds } from '#shared/review/needs.ts'
import { GradesBridge, gradesOf } from '../src/review/grades.ts'
import { temporaryDirectory } from './support.ts'

/**
 * The grades' door against hobkin's own `recordGrades`, in a home of the test's own (063-yolo-settings-and-grades):
 * the seam the fakes in `review-grades-bridge.test.ts` stand in for. No review is built and no model is called: the
 * ratings are handed in as a finished review holds them.
 */

type Item = { id: string; review?: { by?: string; kind?: string; head?: string; scores?: Record<string, { score: number; evidence: string }> } }
interface Store {
  fileItem: (root: string, slug: string, item: Record<string, unknown>) => { id: string }
  updateItem: (root: string, slug: string, id: string, change: Record<string, unknown>) => unknown
  readItems: (root: string, slug: string) => Item[]
}
interface Controls {
  newProject: (root: string, request: { path: string; kind: 'code' }) => Promise<{ slug: string }>
}
const store = hobkinStore as unknown as Store
const controls = hobkinControls as unknown as Controls

const git = (folder: string, ...args: string[]) => execFileSync('git', ['-C', folder, ...args], { encoding: 'utf8' }).trim()

/** A temporary hobkin home with one code project and one finished change on a branch of its own. */
async function world(t: Parameters<typeof temporaryDirectory>[0]) {
  const base = temporaryDirectory(t)
  const root = join(base, 'hobkin-home')
  const repository = join(base, 'shop')
  mkdirSync(root, { recursive: true })
  mkdirSync(repository, { recursive: true })
  git(repository, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(repository, 'readme.md'), '# shop\n')
  git(repository, 'add', '--all')
  git(repository, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'Start')
  git(repository, 'switch', '--quiet', '-c', 'hobkin/fix-cart')
  writeFileSync(join(repository, 'cart.txt'), 'fixed\n')
  git(repository, 'add', '--all')
  git(repository, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'Fix the cart')
  const head = git(repository, 'rev-parse', 'HEAD')
  git(repository, 'switch', '--quiet', 'main')

  const { slug } = await controls.newProject(root, { path: repository, kind: 'code' })
  const { id } = store.fileItem(root, slug, { key: 'fix:cart', kind: 'fix', title: 'Fix the cart', brief: 'Evidence and the first change.' })
  store.updateItem(root, slug, id, { state: 'branch', branch: 'hobkin/fix-cart', proof: 'It passes.' })

  const itemNow = () => store.readItems(root, slug).find((item) => item.id === id)
  return { root, slug, id, head, itemNow }
}

/** A finished review's ratings as the host holds them: the change review's own, complete, made at `head`. */
function ratingsAt(head: string, evidence = 'The cart spec fails without the change and passes with it.'): ReviewNeeds {
  const score = (value: number) => ({ score: value, evidence })
  const scores = { coverage: score(9), proof: score(8), safety: score(9), visibility: score(7), rollback: score(9) }
  return { by: 'change-review', kind: 'bug-fix', head, scores } as ReviewNeeds
}

test('a finished review’s five ratings are kept by hobkin as the change’s review, marked as Change Review’s', async (t) => {
  const { root, slug, id, head, itemNow } = await world(t)
  const bridge = new GradesBridge({ root: () => root })

  const outcome = await bridge.send({ kind: 'change', slug, item: id }, ratingsAt(head), head)

  assert.deepEqual(outcome, { state: 'recorded' })
  const kept = itemNow()?.review
  assert.deepEqual({ by: kept?.by, kind: kept?.kind, head: kept?.head }, { by: 'change-review', kind: 'bug-fix', head })
  assert.deepEqual(Object.fromEntries(Object.entries(kept?.scores ?? {}).map(([name, { score }]) => [name, score])), { coverage: 9, proof: 8, safety: 9, visibility: 7, rollback: 9 })
})

test('ratings with a score that has no line of evidence are not sent, since hobkin would refuse them', async (t) => {
  const { root, slug, id, head, itemNow } = await world(t)
  const bridge = new GradesBridge({ root: () => root })

  assert.equal(gradesOf(ratingsAt(head, ''), head), null)
  const outcome = await bridge.send({ kind: 'change', slug, item: id }, ratingsAt(head, '  '), head)

  assert.equal(outcome.state, 'skipped')
  assert.equal(itemNow()?.review, undefined, 'nothing was written, and the same review can be sent once it is whole')
})
