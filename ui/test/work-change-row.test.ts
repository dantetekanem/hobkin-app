import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinishedChange, FinishedGroup } from '#shared/protocol/work.ts'
import { actionOf, factsOf, placeBefore, rowKey, sentenceOf } from '../src/features/work/change-row.ts'
import { sampleWork } from '../src/features/work/sample.ts'

const change = (over: Partial<FinishedChange> = {}): FinishedChange =>
  ({ key: 'a:1', project: 'storefront', issue: null, size: null, behind: 0, pr: null, models: undefined, about: 'It did a thing.', reason: 'It has proof.', left: null, choices: [{ value: 'diff', label: 'Show the diff' }], ...over }) as FinishedChange
const named = (name: FinishedGroup['name']) => ({ name })

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

test('the sentence is the run\'s note in Left for you, the reason in Needs you, and what the change did elsewhere', () => {
  const both = change({ left: 'Say if it may.', reason: 'Its run left you a note.' })
  assert.deepEqual(sentenceOf(both, named('left')), { kind: 'note', text: 'Say if it may.' })
  assert.deepEqual(sentenceOf(both, named('needs')), { kind: 'reason', text: 'Its run left you a note.' })
  assert.deepEqual(sentenceOf(both, named('merge')), { kind: 'did', text: 'It did a thing.' })
  assert.deepEqual(sentenceOf(both, named('refresh')), { kind: 'did', text: 'It did a thing.' })
})

test('a change with nothing of its own to say falls back to its reason, and with no reason has no sentence', () => {
  assert.deepEqual(sentenceOf(change({ about: null }), named('merge')), { kind: 'reason', text: 'It has proof.' })
  assert.deepEqual(sentenceOf(change({ left: null }), named('left')), { kind: 'reason', text: 'It has proof.' })
  assert.equal(sentenceOf(change({ about: null, reason: '' }), named('merge')), null)
})

test('the action is Answer in Left for you, the change\'s own yes in its own words where it has one, and Review otherwise', () => {
  const yes = change({ choices: [{ value: 'diff', label: 'Show the diff' }, { value: 'refreshMerge', label: 'Refresh and merge it' }, { value: 'decline', label: 'Cancel it' }] })
  assert.deepEqual(actionOf(yes, named('left')), { kind: 'answer', label: 'Answer' })
  assert.deepEqual(actionOf(yes, named('refresh')), { kind: 'yes', choice: 'refreshMerge', label: 'Refresh and merge it' })
  assert.deepEqual(actionOf(change(), named('needs')), { kind: 'review', label: 'Review' })
})

test('every sample change gets an action and a sentence, and the Left for you group holds enough to see a list', () => {
  const groups = sampleWork().finished
  const left = groups.find(({ name }) => name === 'left')!
  assert.ok(left.changes.length >= 6)
  for (const group of groups) {
    for (const each of group.changes) {
      assert.ok(sentenceOf(each, group), `${each.key} has a sentence`)
      assert.ok(actionOf(each, group).label)
    }
  }
  assert.ok(left.changes.every(({ left: note }) => note && note.length > 100))
  assert.ok(left.changes.some(({ models }) => models?.length))
  assert.ok(left.changes.some(({ proof }) => !proof))
  assert.ok(left.changes.some(({ size }) => !size))
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
