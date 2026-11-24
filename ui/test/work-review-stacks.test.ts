import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinishedChange } from '#shared/protocol/work.ts'
import type { ReviewListItem } from '#shared/review/status.ts'
import { rowsOf, type ReviewRow } from '../src/features/work/ai-reviews.ts'
import { orderRows } from '../src/features/work/review-list.ts'
import { entriesOf, oneRowPerLayer, placeLookup, projectEntries, projectLookup, rowsIn, stackHeading, stackLookupOf } from '../src/features/work/review-stacks.ts'

const at = '2026-11-24T12:00:00Z'
const head = (n: number) => String(n).padStart(40, '0')
const item = (id: string, over: Partial<ReviewListItem>): ReviewListItem => ({ id, kind: 'change', title: id, project: 'rpsleague', head: null, state: 'ready', phase: null, error: null, updatedAt: at, ...over })
const needs = [{ by: 'change-review', head: head(1), rate: 7, scores: { coverage: { score: 7, evidence: 'ok' } } }]

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
