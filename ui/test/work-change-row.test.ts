import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinishedChange } from '#shared/protocol/work.ts'
import { factsOf, placeBefore, rowKey, whenWords } from '../src/features/work/change-row.ts'

const change = (over: Partial<FinishedChange> = {}): FinishedChange =>
  ({ key: 'a:1', project: 'storefront', issue: null, size: null, behind: 0, pr: null, models: undefined, ...over }) as FinishedChange

test('the facts come in order: project, issue, size, behind, the pull request, its checks, then the model checks as one count', () => {
  const full = change({
    issue: { repo: 'x/y', number: 4, url: 'https://x.invalid/4' },
    size: { lines: 48, files: 1 },
    behind: 3,
    pr: 'https://x.invalid/pull/9',
    models: [{ spec: 'a.tla', state: 'holds' }, { spec: 'b.tla', state: 'broken' }],
  })
  const facts = factsOf(full, { review: 'approved', checks: 'failing', draft: false })
  assert.deepEqual(
    facts.map((fact) => ('text' in fact ? `${fact.kind}:${fact.text}` : fact.kind)),
    ['project:storefront', 'issue', 'size:48 lines · 1 file', 'behind:3 behind', 'pull-state:Approved', 'pull-state:Checks fail', 'pull', 'models:2 model checks'],
  )
})

test('a part a change does not have leaves the others in place', () => {
  assert.deepEqual(factsOf(change()).map(({ kind }) => kind), ['project'])
  assert.deepEqual(factsOf(change({ size: { lines: 1, files: 2 }, models: [{ spec: 'a.tla', state: 'holds' }] })).map((fact) => ('text' in fact ? fact.text : fact.kind)), ['storefront', '1 line · 2 files', '1 model check'])
  assert.deepEqual(factsOf(change({ behind: 2 }), { review: 'none', checks: 'none', draft: true }).map((fact) => ('text' in fact ? fact.text : fact.kind)), ['storefront', '2 behind', 'Draft'])
})

test('a layer\'s place goes before its title, and a change in no stack has none', () => {
  assert.equal(placeBefore({ id: 'a', layer: 1, of: 5, name: null, below: null, base: null }), '1 of 5')
  assert.equal(placeBefore(undefined), null)
})

test('Space opens and closes the row, Enter opens it in Review, and a key meant for a control inside it, such as the reply box, is not the row\'s', () => {
  assert.equal(rowKey({ key: ' ', onRow: true }), 'toggle')
  assert.equal(rowKey({ key: 'Enter', onRow: true }), 'review')
  assert.equal(rowKey({ key: ' ', onRow: false }), null)
  assert.equal(rowKey({ key: 'Enter', onRow: false }), null)
  assert.equal(rowKey({ key: 'a', onRow: true }), null)
})

test('a row says how long ago its change was written, in the largest whole unit, and nothing when it has no readable time', () => {
  const now = Date.parse('2026-11-24T20:00:00.000Z')
  const ago = (ms: number) => whenWords(new Date(now - ms).toISOString(), now)

  assert.equal(ago(20_000), 'a moment ago')
  assert.equal(ago(-5_000), 'a moment ago', 'a time a little ahead of this Mac\'s clock')
  assert.equal(ago(61_000), '1 minute ago')
  assert.equal(ago(59 * 60_000), '59 minutes ago')
  assert.equal(ago(3 * 3_600_000 + 59 * 60_000), '3 hours ago')
  assert.equal(ago(24 * 3_600_000), '1 day ago')
  assert.equal(ago(10 * 24 * 3_600_000), '10 days ago')
  assert.equal(whenWords(undefined, now), null)
  assert.equal(whenWords('not a time', now), null)
})
