import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canDismiss, dismissIdOf, dismissesKey } from '../src/features/actions/dismiss.ts'
import { hostRows } from '../src/features/actions/host.ts'
import { waiting } from '../src/features/actions/items.ts'
import { sampleItems } from '../src/features/actions/sample.ts'
import { emptyQueue } from '../src/features/questions/queue.ts'

const choices = [
  { value: 'yes', label: 'Unsubscribe' },
  { value: 'no', label: 'Keep it' },
]
const decision = { id: 'd1', key: null, from: 'Routine inbox-sweep', question: 'Unsubscribe?', tldr: 'Unsubscribe?', choices, answerTo: null, recommended: null, why: null, changed: null, at: '2026-11-09T08:00:00.000Z' }

test("each card hobkin lists is dismissed by hobkin's own id for it, as its hobkin_action_items tool names it", () => {
  const snapshot = {
    decisions: [decision],
    waiting: {
      proposals: [{ id: 'a1b2c3', title: 'Keep reports short', question: 'Keep reports short?', scope: 'morning-recap', at: '2026-11-09T09:00:00.000Z' }],
      asks: [{ kind: 'proposal', slug: 'storefront', title: 'Storefront', offeredAt: '2026-11-09T10:00:00.000Z' }],
    },
  }

  const ids = hostRows(snapshot).map((row) => dismissIdOf(row, snapshot))

  // hobkin's ids (`listActionItems`): a decision by its own id, a learning offer and a project offer by what was offered when.
  assert.deepEqual(ids, ['d1', 'learning:a1b2c3:2026-11-09T09:00:00.000Z', 'project:storefront:2026-11-09T10:00:00.000Z'])
})

test('a sample, which never reached hobkin, cannot be dismissed there', () => {
  const [sample] = waiting(sampleItems, emptyQueue)
  assert.equal(dismissIdOf(sample!, {}), null)
  assert.equal(canDismiss(sample!), false)
})

test('only what hobkin lists offers Dismiss: its decisions and its learning and project offers, not a step cleared in Work', () => {
  const rows = hostRows({
    decisions: [decision],
    waiting: {
      proposals: [{ id: 'a1b2c3', title: 'Keep reports short', question: 'Keep reports short?', scope: 'morning-recap', at: '2026-11-09T09:00:00.000Z' }],
      asks: [{ kind: 'proposal', slug: 'storefront', title: 'Storefront', offeredAt: '2026-11-09T10:00:00.000Z' }],
      yours: [{ slug: 'storefront', item: 'i1', title: 'Rotate the key', attentionKind: 'personal' }],
    },
  })

  const offered = rows.map((row) => [row.answers?.by, canDismiss(row)])

  assert.deepEqual(offered, [
    ['decision', true],
    ['learning', true],
    ['proposal', true],
    ['work', false],
  ])
})

test('Backspace or Delete dismisses the item with the keyboard; typed in a field, it is text', () => {
  assert.equal(dismissesKey('Backspace', false), true)
  assert.equal(dismissesKey('Delete', false), true)
  assert.equal(dismissesKey('Backspace', true), false)
  assert.equal(dismissesKey('d', false), false)
})
