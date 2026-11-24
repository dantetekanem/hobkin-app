import assert from 'node:assert/strict'
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { cleanUp } from '../src/review/cleanup.ts'
import { Reviews } from '../src/review/reviews.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const NOW = Date.parse('2026-11-23T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const head = (index: number) => `${index}`.repeat(12)

/** A review folder as the host keeps one: a review of each head, each with its change review, and the files of the change itself. */
function home(t: TestContext, heads: number, { ageDays = 0, folder = 'change+shop+a1' }: { ageDays?: number; folder?: string } = {}) {
  const root = temporaryDirectory(t)
  const reviews = join(root, 'client', 'reviews', folder)
  mkdirSync(reviews, { recursive: true })
  const write = (path: string, text = '{}', daysOld = ageDays) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
    const at = (NOW - daysOld * DAY) / 1000
    utimesSync(path, at, at)
  }
  for (let index = 1; index <= heads; index += 1) {
    // Older heads are older files: head 1 the oldest.
    const old = ageDays + (heads - index)
    for (const kind of ['review', 'files', 'meta']) write(join(reviews, `${kind}-${head(index)}.json`), '{}', old)
    for (const name of ['summary.json', 'progress.json', 'graph.json', 'units.json', 'story.md', 'risk-events.jsonl', 'usage.json']) write(join(reviews, 'change-review', head(index), name), '{}', old)
  }
  for (const name of ['notes.json', 'landed.json', 'risk-fix.json', 'merge-asked.json']) write(join(reviews, name))
  return { root, reviews }
}

test('older heads keep their summary and progress and lose the rest', (t) => {
  const { root, reviews } = home(t, 4)

  const removed = cleanUp({ root, now: NOW, closed: () => false })

  for (const index of [3, 4]) {
    assert.ok(existsSync(join(reviews, `review-${head(index)}.json`)), `head ${index} is kept whole`)
    assert.ok(existsSync(join(reviews, 'change-review', head(index), 'graph.json')))
  }
  for (const index of [1, 2]) {
    assert.ok(!existsSync(join(reviews, `review-${head(index)}.json`)) && !existsSync(join(reviews, `files-${head(index)}.json`)), `head ${index} loses its review`)
    assert.ok(!existsSync(join(reviews, 'change-review', head(index), 'graph.json')))
    assert.ok(existsSync(join(reviews, 'change-review', head(index), 'summary.json')) && existsSync(join(reviews, 'change-review', head(index), 'progress.json')))
  }
  assert.ok(existsSync(join(reviews, 'notes.json')))
  assert.equal(removed.length, 2 * (3 + 5))
  assert.deepEqual(cleanUp({ root, now: NOW, closed: () => false }), [], 'a second run removes nothing more')
})

test('a look names what cleaning up would remove and removes nothing', (t) => {
  const { root, reviews } = home(t, 4)

  const named = cleanUp({ root, now: NOW, closed: () => false, look: true })

  assert.equal(named.length, 2 * (3 + 5), 'the same files a real run removes')
  for (const index of [1, 2, 3, 4]) {
    assert.ok(existsSync(join(reviews, `review-${head(index)}.json`)), `head ${index} is still whole`)
    assert.ok(existsSync(join(reviews, 'change-review', head(index), 'graph.json')))
  }
  assert.equal(cleanUp({ root, now: NOW, closed: () => false }).length, named.length, 'a real run after it removes them')
})

test('a change hobkin closed leaves the list and its heavy files go after thirty days, its notes kept', (t) => {
  const recent = home(t, 1, { ageDays: 10 })
  assert.deepEqual(cleanUp({ root: recent.root, now: NOW, closed: () => true }), [], 'closed ten days ago: nothing goes yet')

  const { root, reviews } = home(t, 2, { ageDays: 31 })
  cleanUp({ root, now: NOW, closed: (target) => target.kind === 'change' && target.item === 'a1' })

  for (const index of [1, 2]) {
    assert.ok(!existsSync(join(reviews, `review-${head(index)}.json`)))
    assert.ok(existsSync(join(reviews, 'change-review', head(index), 'summary.json')))
  }
  for (const name of ['notes.json', 'landed.json', 'risk-fix.json']) assert.ok(existsSync(join(reviews, name)), name)
  // Its summaries still count in the numbers: the store still knows the change.
  assert.deepEqual(reviewStore(root).targets(), [{ kind: 'change', slug: 'shop', item: 'a1' }])
})

test('a broken review tree goes after seven days', (t) => {
  const root = temporaryDirectory(t)
  const trees = join(root, 'client', 'review-trees')
  const tree = (name: string, daysOld: number) => {
    mkdirSync(join(trees, name), { recursive: true })
    writeFileSync(join(trees, name, 'file'), 'x')
    const at = (NOW - daysOld * DAY) / 1000
    utimesSync(join(trees, name), at, at)
  }
  tree('shop-broken-2026-11-10T10-00-00-000Z', 13)
  tree('shop-broken-2026-11-20T10-00-00-000Z', 3)
  tree('shop', 40)

  const removed = cleanUp({ root, now: NOW, closed: () => false })

  assert.deepEqual(removed, [join(trees, 'shop-broken-2026-11-10T10-00-00-000Z')])
  assert.ok(existsSync(join(trees, 'shop')) && existsSync(join(trees, 'shop-broken-2026-11-20T10-00-00-000Z')))
})

test('a change hobkin closed without a merge is no row of the list', (t) => {
  const { root } = home(t, 1)
  const reviews = new Reviews({
    store: reviewStore(root),
    sources: { change: { head: async () => null, read: async () => Promise.reject(new Error('no')) }, pull: { head: async () => null, read: async () => Promise.reject(new Error('no')) } },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    closed: (target) => target.item === 'a1',
  })
  t.after(() => reviews.close())

  assert.deepEqual(reviews.list().reviews, [])
})
