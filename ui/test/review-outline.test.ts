import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { filterOutline, outlineItems, outlineOf } from '../src/features/review/outline/outline.ts'
import { largeReview } from '../src/features/review/sample/large.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const large = largeReview().review
const open = (review: Review) => createSession(review, createReviewMemory())
const isPart = (node: Review['nodes'][number]) => node.kind !== 'criterion' && !(node.kind === 'context' && node.change === 'unchanged')
const rowsOf = (sections: ReturnType<typeof outlineOf>) => sections.flatMap((section) => [...section.rows, ...section.groups.flatMap((group) => group.rows)])

test('the outline lists every unit and file of the review once, under Needs you, Worth a look and Safe, each in rank order', () => {
  const session = open(large)
  const sections = outlineOf(large, session.getState().view)
  assert.deepEqual(sections.map((section) => section.title), ['Needs you', 'Worth a look', 'Safe'])
  const rows = rowsOf(sections)
  assert.deepEqual(rows.map((row) => row.id).sort(), large.nodes.filter(isPart).map((node) => node.id).sort())
  const rankOf = new Map(large.nodes.map((node) => [node.id, node.attention?.rank ?? Infinity]))
  const tierOf = new Map(large.nodes.map((node) => [node.id, node.attention?.tier]))
  const [needsYou, worth, safe] = sections
  assert.equal(needsYou!.rows.length, 7)
  for (const row of needsYou!.rows) assert.equal(tierOf.get(row.id), 'needs-you')
  for (const row of worth!.rows) assert.equal(tierOf.get(row.id), 'worth-a-look')
  for (const list of [needsYou!.rows, worth!.rows, ...safe!.groups.map((group) => group.rows)]) {
    const ranks = list.map((row) => rankOf.get(row.id)!)
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b))
  }
  // Each row says its lines.
  const charge = needsYou!.rows[0]!
  const node = large.nodes.find((entry) => entry.id === charge.id)!
  assert.deepEqual([charge.additions, charge.deletions], [node.stats!.additions, node.stats!.deletions])
})

test('Safe lists its groups, as the graph folds them, each opening to its members', () => {
  const session = open(large)
  const view = session.getState().view
  const [, , safe] = outlineOf(large, view)
  const generated = safe!.groups.find((group) => group.label === 'Generated files')!
  assert.equal(generated.id, view.plan.order.find((id) => view.plan.groups[id]!.label === 'Generated files'))
  assert.equal(generated.rows.length, 50)

  const closed = outlineItems(outlineOf(large, view), new Set())
  assert.equal(closed.some((item) => item.kind === 'row' && generated.rows.some((row) => row.id === item.row.id)), false, 'closed, a group shows only its own row')
  const opened = outlineItems(outlineOf(large, view), new Set([generated.id]))
  assert.equal(opened.filter((item) => item.kind === 'row' && item.group === generated.id).length, 50)
})

test('typing filters the outline by name and path, and a group with a match shows it', () => {
  const sections = outlineOf(large, open(large).getState().view)
  const found = filterOutline(sections, 'type_0')
  const rows = rowsOf(found)
  assert.ok(rows.length > 0)
  for (const row of rows) assert.match(`${row.title} ${row.path}`, /type_0/)
  // While filtering, every group with a match is open.
  const items = outlineItems(found, new Set(), true)
  assert.equal(items.filter((item) => item.kind === 'row').length, rows.length)
  assert.deepEqual(rowsOf(filterOutline(sections, 'charge proration')).map((row) => row.id), [], 'every word must match')
  assert.equal(rowsOf(filterOutline(sections, '  ')).length, rowsOf(sections).length)
})

test('a review that says nothing of attention lists every unit and file under one heading, in its own order', () => {
  const sections = outlineOf(sample, open(sample).getState().view)
  assert.deepEqual(sections.map((section) => section.title), ['In this change'])
  assert.deepEqual(sections[0]!.rows.map((row) => row.id), sample.nodes.filter(isPart).map((node) => node.id))
})

test('L opens the outline and closes it; a review in Focus opens with it open', () => {
  const keys = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, proofKey: () => {} }
  const small = open(sample)
  assert.equal(small.getState().outline, false, 'a small review opens as it did')
  assert.equal(pressKey(small.getState(), { key: 'l', shift: false, alt: false }, keys), true)
  assert.equal(small.getState().outline, true)
  pressKey(small.getState(), { key: 'l', shift: false, alt: false }, keys)
  assert.equal(small.getState().outline, false)
  assert.equal(open(large).getState().outline, true)
})
