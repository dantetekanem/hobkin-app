import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ReviewListItem } from '#shared/review/status.ts'
import { CONFIRM_MS } from '../src/features/review/verdict.ts'
import { rowsOf } from '../src/features/work/ai-reviews.ts'
import { createRowActions, rowActions, type RowCommands } from '../src/features/work/review-row-actions.ts'

const HEAD = '7d02c99f8c61be4291e0c2046d29787cbc1c010a'
const item = (id: string, over: Partial<ReviewListItem> = {}): ReviewListItem => ({ id, kind: 'change', title: id, project: 'hobkin', head: HEAD, state: 'ready', phase: null, error: null, updatedAt: '2026-11-13T10:00:00Z', ...over })

/** A row's actions over a fake host, with every call it made and each time the list was read again. */
function row(id: string, { head = HEAD as string | null, refuse = null as string | null } = {}) {
  const calls: [string, unknown][] = []
  let changed = 0
  const command = (async (name: string, args: { verdict?: string }) => {
    calls.push([name, args])
    if (refuse) throw new Error(refuse)
    if (name === 'review.preview') return { verdict: args.verdict, lines: [`What ${args.verdict} does.`], confirm: `token-${args.verdict}` }
    if (name === 'review.verdict') return { message: `Done: ${args.verdict}` }
    return { id, removed: true }
  }) as RowCommands
  const actions = createRowActions({ id, head, command, changed: () => void (changed += 1) })
  actions.connect()
  return { actions, calls, changed: () => changed }
}

test('a row offers Remove, Discard and Discard and delete branch, and no Remove while its review runs', () => {
  const [running, ready, failed] = rowsOf({
    reviews: [
      item('change:hobkin:a1', { assessment: { state: 'running', head: HEAD, percent: 10, startedAt: '2026-11-13T10:00:00Z' } }),
      item('change:hobkin:b1', { updatedAt: '2026-11-13T09:00:00Z' }),
      item('pr:acme/shop/482', { kind: 'pull', state: 'failed', error: 'gh is not signed in', updatedAt: '2026-11-13T08:00:00Z' }),
    ],
  })
  assert.deepEqual(rowActions(running!), ['discard', 'discard-branch'])
  assert.deepEqual(rowActions(ready!), ['remove', 'discard', 'discard-branch'])
  assert.deepEqual(rowActions(failed!), ['remove', 'discard', 'discard-branch'])
})

test('Remove asks in place: the first click only asks, a second takes the review out of the list alone, and after ten seconds it goes back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { actions, calls, changed } = row('change:hobkin:b1')

  await actions.press('remove')
  assert.equal(actions.armed(), 'remove')
  assert.deepEqual(calls, [], 'the first click asks the user, not the host')
  t.mock.timers.tick(CONFIRM_MS)
  assert.equal(actions.armed(), null, 'ten seconds without the second click, and it goes back')

  await actions.press('remove')
  t.mock.timers.tick(CONFIRM_MS - 1)
  await actions.press('remove')
  assert.deepEqual(calls, [['review.remove', { id: 'change:hobkin:b1' }]], 'only the review is removed: no verdict, so the change, its branch and its pull request stay')
  assert.deepEqual([actions.armed(), changed()], [null, 1])
})

test("a removal the host refuses shows its reason in the row, and the list is not read again", async () => {
  const { actions, changed } = row('change:hobkin:b1', { refuse: 'This review is being prepared. Wait for it to finish, then remove it.' })
  await actions.press('remove')
  await actions.press('remove')
  assert.equal(actions.removal.getState().error, 'This review is being prepared. Wait for it to finish, then remove it.')
  assert.equal(changed(), 0)
})

test('Discard and Discard and delete branch from a row are the review’s own verdicts: shown by the host first, done with its token on the second click', async () => {
  for (const verdict of ['discard', 'discard-branch'] as const) {
    const { actions, calls, changed } = row('pr:acme/shop/482')
    await actions.press(verdict)
    assert.deepEqual(calls, [['review.preview', { id: 'pr:acme/shop/482', verdict, summary: '', head: HEAD }]])
    assert.deepEqual([actions.armed(), actions.verdicts.getState().preview?.lines], [verdict, [`What ${verdict} does.`]])
    await actions.press(verdict)
    assert.deepEqual(calls.at(-1), ['review.verdict', { id: 'pr:acme/shop/482', verdict, summary: '', confirm: `token-${verdict}`, head: HEAD }])
    assert.deepEqual([actions.verdicts.getState().message, changed()], [`Done: ${verdict}`, 1])
  }
  // A row that knows no commit names none.
  const unknown = row('change:hobkin:b1', { head: null })
  await unknown.actions.press('discard')
  assert.deepEqual(unknown.calls, [['review.preview', { id: 'change:hobkin:b1', verdict: 'discard', summary: '' }]])
})

test('only one action waits for its second click at a time, and Escape takes it back', async () => {
  const { actions, calls } = row('change:hobkin:b1')
  await actions.press('remove')
  await actions.press('discard')
  assert.equal(actions.armed(), 'discard', 'asking for another takes the first back')
  await actions.press('remove')
  assert.equal(actions.armed(), 'remove')
  assert.equal(actions.verdicts.getState().preview, null)
  actions.cancel()
  assert.equal(actions.armed(), null)
  assert.deepEqual(calls.map(([name]) => name), ['review.preview'], 'nothing was removed or discarded')
})
