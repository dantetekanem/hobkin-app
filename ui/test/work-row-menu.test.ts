import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinishedChange } from '#shared/protocol/work.ts'
import { menuItemsOf } from '../src/features/work/row-menu.ts'

const change = (over: Partial<FinishedChange> = {}): FinishedChange =>
  ({
    key: 'p:1',
    pr: null,
    left: null,
    choices: [
      { value: 'merge', label: 'Merge it' },
      { value: 'diff', label: 'Show the diff' },
      { value: 'open', label: 'Open the PR in the browser' },
      { value: 'review', label: 'Review it again' },
      { value: 'decline', label: 'Cancel it' },
      { value: 'done', label: 'Close without merging' },
    ],
    ...over,
  }) as FinishedChange
const on = { canReview: true, reviewing: false, canReply: true }
const summary = (items: ReturnType<typeof menuItemsOf>) => items.map(({ kind, label }) => `${kind}:${label}`)

test('the menu lists every choice in hobkin\'s words and order, then a way to reply', () => {
  assert.deepEqual(summary(menuItemsOf(change({ pr: 'https://x.invalid/pull/1' }), on)), [
    'choice:Merge it',
    'review:Show the diff',
    'open:Open the PR in the browser',
    'again:Review it again',
    'choice:Cancel it',
    'confirm:Close without merging',
    'reply:Ask for changes',
  ])
})

test('a change with a note offers a reply to it, and one with no diff choice still offers Review first', () => {
  const items = menuItemsOf(change({ left: 'A note.', choices: [{ value: 'rebase', label: 'Have an agent rebase it' }] }), on)
  assert.deepEqual(summary(items), ['review:Review', 'choice:Have an agent rebase it', 'reply:Reply to its note'])
})

test('Open the PR needs a pull request, a review that is under way cannot be asked again, and what cannot be undone is marked', () => {
  const items = menuItemsOf(change(), { ...on, reviewing: true })
  assert.ok(!items.some(({ kind }) => kind === 'open'))
  assert.equal(items.find(({ kind }) => kind === 'again')?.disabled, true)
  assert.deepEqual(items.filter(({ destructive }) => destructive).map(({ label }) => label), ['Cancel it', 'Close without merging'])
})

test('without a review to open or a reply box, those items are left out', () => {
  const items = menuItemsOf(change(), { canReview: false, reviewing: false, canReply: false })
  assert.deepEqual(summary(items), ['choice:Merge it', 'again:Review it again', 'choice:Cancel it', 'confirm:Close without merging'])
})
