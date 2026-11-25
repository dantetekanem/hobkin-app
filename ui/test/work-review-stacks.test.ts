import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PullRequest } from '#shared/protocol/pulls.ts'
import type { FinishedChange, MergingRow } from '#shared/protocol/work.ts'
import { learnCodeHosts } from '#shared/review/ids.ts'
import type { ReviewListItem } from '#shared/review/status.ts'
import { rowsOf, type ReviewRow } from '../src/features/work/ai-reviews.ts'
import { orderRows } from '../src/features/work/review-list.ts'
import { entriesOf, oneRowPerLayer, placeLookup, projectEntries, projectLookup, rowsIn, stackHeading, stackLookupOf } from '../src/features/work/review-stacks.ts'

const at = '2026-11-24T12:00:00Z'
const head = (n: number) => String(n).padStart(40, '0')
const item = (id: string, over: Partial<ReviewListItem>): ReviewListItem => ({ id, kind: 'change', title: id, project: 'rpsleague', head: null, state: 'ready', phase: null, error: null, updatedAt: at, ...over })
const needs: ReviewListItem['needs'] = [{ by: 'change-review', head: head(1), rate: 7, scores: { coverage: { score: 7, evidence: 'ok' } } }]

/** A change that is layer `layer` of a stack of four, which opened pull request `pr`. */
const change = (layer: number, over: Partial<FinishedChange> = {}): FinishedChange =>
  ({ key: `rpsleague:i${layer}`, slug: 'rpsleague', item: `i${layer}`, title: `Layer ${layer}`, head: head(layer), pr: `https://github.com/DanteTekanem/rpsleague/pull/${195 + layer}`, stack: { id: 'i1', layer, of: 4, name: 'the menu' }, ...over }) as FinishedChange

const changes = [1, 2, 3, 4].map((layer) => change(layer))
const changeReview = (layer: number, over: Partial<ReviewListItem> = {}) => item(`change:rpsleague:i${layer}`, { head: head(layer), ...over })
const pullReview = (layer: number, over: Partial<ReviewListItem> = {}) => item(`pr:dantetekanem/rpsleague/${195 + layer}`, { kind: 'pull', project: 'dantetekanem/rpsleague', head: head(layer), ...over })
const rows = (reviews: ReviewListItem[]): ReviewRow[] => rowsOf({ reviews })
const placeOf = placeLookup(changes)

test('a change review and its pull request review are one row, the pull request, with the change review grades when it has none', () => {
  const list = rows([changeReview(2, { needs }), pullReview(2), changeReview(3)])
  const one = oneRowPerLayer(list, placeOf)
  assert.deepEqual(one.map((row) => row.item.id), ['pr:dantetekanem/rpsleague/197', 'change:rpsleague:i3'])
  assert.equal(one[0]!.needs?.rate, '7')
})

test("a layer's one row says reviewing while either of its reviews is built again, with that run's line and start", () => {
  const again = changeReview(2, { needs, phase: 'reading', startedAt: at, assessment: { state: 'queued', head: head(2) } })
  const [row] = oneRowPerLayer(rows([again, pullReview(2)]), placeOf)
  assert.deepEqual([row!.item.kind, row!.state, row!.line, row!.startedAt, row!.needs?.rate], ['pull', { kind: 'reviewing', percent: null }, 'Reading the change', Date.parse(at), '7'])
})

test('the pull request of a layer is found by the change that opened it or by its commit', () => {
  const byPull = pullReview(2, { head: null })
  const byHead = pullReview(3, { id: 'pr:dantetekanem/rpsleague/999' })
  assert.deepEqual(rows([byPull, byHead]).map((row) => placeOf(row)?.layer), [2, 3])
})

test('outside a stack, a change review and a pull request review at one commit are one row, and different commits stay two', () => {
  const none = placeLookup([])
  const same = rows([changeReview(1, { head: head(9) }), pullReview(1, { head: head(9) }), pullReview(2, { head: head(8) })])
  assert.deepEqual(oneRowPerLayer(same, none).map((row) => row.item.id).toSorted(), ['pr:dantetekanem/rpsleague/196', 'pr:dantetekanem/rpsleague/197'])
  assert.equal(oneRowPerLayer(rows([changeReview(1, { head: null }), changeReview(2, { head: null })]), none).length, 2)
})

test('a merge that did not land stays on the row that is shown', () => {
  const asked = changeReview(2, { mergeAsked: { why: 'conflict', at, state: 'failed' } })
  const [row] = oneRowPerLayer(rows([asked, pullReview(2)]), placeOf)
  assert.equal(row!.item.kind, 'pull')
  assert.equal(row!.merge?.why, 'conflict')
})

test('a pull request is listed under the project whose repository it is in, whatever the case', () => {
  const projectOf = projectLookup([{ slug: 'rpsleague', repo: 'DanteTekanem/RpsLeague' }, { slug: 'other', repo: null }])
  const [change2, pull2, stranger] = rows([changeReview(2), pullReview(2), item('pr:someone/else/1', { kind: 'pull', project: 'someone/else' })])
  assert.deepEqual([change2, pull2, stranger].map((row) => projectOf(row!)), ['rpsleague', 'rpsleague', 'someone/else'])
})

test('a stack is one entry at the place of its best layer, bottom first, in every order; a row alone in its stack is a row', () => {
  const list = oneRowPerLayer(rows([pullReview(4), pullReview(3), pullReview(2), changeReview(1), item('change:rpsleague:solo', { head: head(7) })]), placeOf)
  for (const order of ['easiest', 'priority', 'newest', 'oldest', 'smallest'] as const) {
    const entries = entriesOf(orderRows(list, order, stackLookupOf(placeOf)), placeOf)
    assert.equal(entries.length, 2, order)
    const stack = entries.find((entry) => entry.kind === 'stack')!
    assert.deepEqual(stack.kind === 'stack' && stack.layers.map(({ place }) => place.layer), [1, 2, 3, 4], order)
  }
  const [only] = entriesOf(rows([pullReview(2)]), placeOf)
  assert.equal(only!.kind, 'row')
})

test('the counts follow the rows shown, a stack counting each of its layers, and the heading says Work\'s words', () => {
  const list = oneRowPerLayer(rows([changeReview(1), changeReview(2), pullReview(1), pullReview(2), pullReview(3)]), placeOf)
  const entries = entriesOf(list, placeOf)
  const [project] = projectEntries(entries, projectLookup([{ slug: 'rpsleague', repo: 'dantetekanem/rpsleague' }]))
  assert.equal(list.length, 3)
  assert.equal(project!.count, 3)
  assert.equal(entries.reduce((sum, entry) => sum + rowsIn(entry), 0), 3)
  const stack = entries[0]!
  assert.equal(stack.kind === 'stack' && stackHeading(stack), 'Stack of 4 · the menu')
})

/** An open pull request of the repository: its number, its own branch and the branch it is on. */
const open = (number: number, headBranch: string, baseBranch: string, over: Partial<PullRequest> = {}): PullRequest =>
  ({ repo: 'DanteTekanem/rpsleague', number, title: `Pull ${number}`, labels: [], updatedAt: at, url: `https://github.com/DanteTekanem/rpsleague/pull/${number}`, draft: false, author: 'dante', review: 'none', checks: 'none', head: head(number), headBranch, baseBranch, ...over }) as PullRequest
const chain = [open(195, 'menu-1', 'main'), open(196, 'menu-2', 'menu-1'), open(197, 'menu-3', 'menu-2')]
const reviewOf = (number: number, over: Partial<ReviewListItem> = {}) => item(`pr:dantetekanem/rpsleague/${number}`, { kind: 'pull', project: 'dantetekanem/rpsleague', head: head(number), ...over })
const stacksOf = (list: ReviewRow[], placeOf: ReturnType<typeof placeLookup>) => entriesOf(oneRowPerLayer(list, placeOf), placeOf).filter((entry) => entry.kind === 'stack')

test('a stack of pull requests with no change of hobkin is one frame, its layers bottom first, and a pull request on no stack is a row', () => {
  const place = placeLookup([], [...chain, open(300, 'lone', 'main')])
  const entries = entriesOf(oneRowPerLayer(rows([reviewOf(197), reviewOf(300), reviewOf(195), reviewOf(196)]), place), place)
  assert.equal(entries.length, 2)
  const stack = entries.find((entry) => entry.kind === 'stack')!
  assert.deepEqual(stack.kind === 'stack' && stack.layers.map(({ row, place: at }) => [row.item.id, at.layer, at.of]), [
    ['pr:dantetekanem/rpsleague/195', 1, 3],
    ['pr:dantetekanem/rpsleague/196', 2, 3],
    ['pr:dantetekanem/rpsleague/197', 3, 3],
  ])
})

test('changes and pull requests that a branch joins are one frame, numbered by the pull requests, and a change under them is the layer below', () => {
  // hobkin's two changes are on menu-1 and menu-2, with no pull request address and other commits; a third change sits on the base of #195.
  const below = change(1, { key: 'rpsleague:base', item: 'base', branch: 'menu-0', head: head(50), pr: null, stack: { id: 'base', layer: 1, of: 2, name: 'the menu', below: null, base: null } })
  const one = change(1, { branch: 'menu-1', head: head(61), pr: null, stack: { id: 'base', layer: 2, of: 2, name: 'the menu', below: 'base', base: null } })
  const two = change(2, { branch: 'menu-2', head: head(62), pr: null, stack: { id: 'base', layer: 3, of: 3, name: 'the menu', below: 'i1', base: null } })
  const place = placeLookup([below, one, two], [open(195, 'menu-1', 'menu-0'), open(196, 'menu-2', 'menu-1'), open(197, 'menu-3', 'menu-2')])
  const list = rows([item('change:rpsleague:base', { head: head(50) }), changeReview(1, { head: head(61) }), changeReview(2, { head: head(62) }), reviewOf(195), reviewOf(196), reviewOf(197)])
  const stacks = stacksOf(list, place)
  assert.equal(stacks.length, 1)
  const [stack] = stacks
  assert.deepEqual(stack!.kind === 'stack' && stack!.layers.map(({ row, place: at }) => [row.item.id, at.layer, at.of]), [
    ['change:rpsleague:base', 1, 4],
    ['pr:dantetekanem/rpsleague/195', 2, 4],
    ['pr:dantetekanem/rpsleague/196', 3, 4],
    ['pr:dantetekanem/rpsleague/197', 4, 4],
  ])
  assert.equal(oneRowPerLayer(list, place).length, 4)
})

test('a layer the user said merge to is a quiet line in its place, and no row stands for it twice', () => {
  const saying: MergingRow = { key: 'rpsleague:i0', slug: 'rpsleague', project: 'rpsleague', item: 'i0', title: 'Layer 0', branch: 'menu-0', issue: null, pr: 'https://github.com/DanteTekanem/rpsleague/pull/194', since: at, handedOff: false }
  const place = placeLookup([], [open(194, 'menu-0', 'main'), open(195, 'menu-1', 'menu-0'), open(196, 'menu-2', 'menu-1')], [saying])
  const [stack] = stacksOf(rows([reviewOf(195), reviewOf(196)]), place)
  assert.ok(stack && stack.kind === 'stack')
  assert.deepEqual(stack.layers.map(({ place: at }) => at.layer), [2, 3])
  assert.deepEqual(stack.merging.map((one) => [one.title, one.place.layer, one.place.of]), [['Layer 0', 1, 3]])
  assert.equal(stack.size, 3)
  // The merge failed: its own row is shown, so the line is not drawn beside it.
  const [failed] = stacksOf(rows([reviewOf(194, { mergeAsked: { why: 'conflict', at, state: 'failed' } }), reviewOf(195)]), place)
  assert.ok(failed && failed.kind === 'stack')
  assert.deepEqual([failed.layers.length, failed.merging.length], [2, 0])
})

test('a stack that hobkin and the pull requests both know is never two frames, and a layer is never listed twice', () => {
  const place = placeLookup(changes, [open(196, 'x', 'main', { head: head(1) }), open(197, 'y', 'x', { head: head(2) })])
  const stacks = stacksOf(rows([changeReview(1), changeReview(2), changeReview(3), changeReview(4), pullReview(1), pullReview(2)]), place)
  assert.equal(stacks.length, 1)
  assert.equal(oneRowPerLayer(rows([changeReview(1), pullReview(1), changeReview(2), pullReview(2)]), place).length, 2)
})

test('a pull request on a named code host and one on GitHub with the same repository and number are two layers, never one', () => {
  learnCodeHosts([{ name: 'forge', web: 'https://code.example.invalid' }])
  try {
    const onHost = open(196, 'other', 'main', { url: 'https://code.example.invalid/DanteTekanem/rpsleague/pull/196', head: head(1196) })
    // GitHub's #196 sits on #195. The code host's #196 is in no stack.
    const place = placeLookup([], [open(195, 'menu-1', 'main'), open(196, 'menu-2', 'menu-1'), onHost])
    const onGitHub = reviewOf(196, { head: null })
    const hostReview = item('pr:forge:dantetekanem/rpsleague/196', { kind: 'pull', project: 'dantetekanem/rpsleague', head: null })
    assert.deepEqual(rows([onGitHub, hostReview]).map((row) => place(row)?.layer ?? null), [2, null])
  } finally {
    learnCodeHosts([])
  }
})
