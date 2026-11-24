import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PlanEntry } from 'hobkin/src/cli/work/plan.mjs'
import type { WholeQueue } from '#shared/protocol/work.ts'
import { runCommand } from '../src/commands.ts'
import { wholeQueue, workQueueHandlers } from '../src/work-queue.ts'

const entry = (key: string, more: Partial<PlanEntry> = {}): PlanEntry => ({
  key,
  kind: 'item',
  slug: 'storefront',
  project: 'Storefront',
  item: { id: key.split(':')[2] ?? 'x' },
  title: `Title of ${key}`,
  grade: 'P2',
  why: 'ranked by its grade',
  skipped: false,
  picked: false,
  estimate: { fresh: 120_000 },
  ...more,
})

const manyEntries = () => [
  ...Array.from({ length: 64 }, (_, at) => entry(`item:storefront:${String(at).padStart(6, '0')}`)),
  entry('item:storefront:skipped', { skipped: true }),
]

test('every queued row comes back in the plan order, with the skipped rows last, where the status keeps only its first fifty', () => {
  const entries = [entry('item:storefront:a'), entry('item:storefront:b', { skipped: true }), entry('item:storefront:c')]
  const whole = wholeQueue({ entries, free: 1 }, () => undefined)
  assert.deepEqual(whole.rows.map(({ key }) => key), ['item:storefront:a', 'item:storefront:c', 'item:storefront:b'])
  assert.equal(whole.queued, 2)

  const long = wholeQueue({ entries: manyEntries(), free: 1 }, () => undefined)
  assert.equal(long.rows.length, 65)
  assert.equal(long.queued, 64)
})

test('a row says what the inline row says: project, title, grade, why, wait, token estimate and picked', () => {
  const [row] = wholeQueue({ entries: [entry('item:storefront:a', { picked: true, waiting: 'over today\'s budget' })], free: 1 }, () => undefined).rows
  assert.deepEqual(row, {
    key: 'item:storefront:a',
    kind: 'item',
    slug: 'storefront',
    project: 'Storefront',
    item: 'a',
    title: 'Title of item:storefront:a',
    grade: 'P2',
    why: 'ranked by its grade',
    waiting: "over today's budget",
    skipped: false,
    picked: true,
    tokens: 120_000,
    issue: null,
    pr: null,
  })
})

test('with no worker free a row waits for one, as in the status, unless the user put it first to start now', () => {
  const rows = wholeQueue({ entries: [entry('item:storefront:a'), entry('item:storefront:b', { pickedNow: true, picked: true })], free: 0 }, () => undefined).rows
  assert.equal(rows[0]?.waiting, 'a free worker')
  assert.equal(rows[1]?.waiting, null)
})

test('an item row carries its issue and pull request from hobkin items', () => {
  const itemOf = (slug: string, id: string) => (slug === 'storefront' && id === 'a' ? { id, pr: 'https://github.com/o/r/pull/9', issue: { repo: 'o/r', number: 4 } } : undefined)
  const [row] = wholeQueue({ entries: [entry('item:storefront:a')], free: 1 }, itemOf as never).rows
  assert.equal(row?.pr, 'https://github.com/o/r/pull/9')
  assert.deepEqual(row?.issue, { repo: 'o/r', number: 4, url: 'https://github.com/o/r/issues/4' })
})

test('work.queue.all plans with the owner outlook, reads only, and answers with the whole queue', async () => {
  const planned: unknown[][] = []
  const actions: unknown[][] = []
  const handlers = workQueueHandlers({
    app: () => ({ director: { outlook: () => ({ running: [], checks: 0, lastStartAt: null }) } }),
    root: () => '/nowhere',
    plan: (...args) => {
      planned.push(args)
      return { entries: manyEntries(), free: 1 }
    },
    itemOf: () => undefined,
  })
  const answer = await runCommand(handlers, 'work.queue.all', {})
  assert.equal(answer.ok, true)
  const whole = (answer.ok ? answer.value : null) as WholeQueue
  assert.equal(whole.rows.length, 65)
  assert.equal(whole.queued, 64)
  assert.deepEqual(planned, [['/nowhere', { running: [], checks: 0, lastStartAt: null }]])
  assert.deepEqual(actions, [])
})
