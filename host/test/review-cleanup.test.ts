import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { cleanUp, READ_KEPT_MS } from '../src/review/cleanup.ts'
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
    // Built in that order: its summary says when it finished.
    write(join(reviews, 'change-review', head(index), 'summary.json'), JSON.stringify({ at: new Date(NOW - old * DAY).toISOString() }), old)
    for (const name of ['progress.json', 'graph.json', 'units.json', 'story.md', 'risk-events.jsonl', 'usage.json']) write(join(reviews, 'change-review', head(index), name), '{}', old)
  }
  for (const name of ['notes.json', 'landed.json', 'risk-fix.json', 'merge-asked.json']) write(join(reviews, name))
  return { root, reviews }
}

test('older heads keep their summary, their progress and their usage, and lose the rest', (t) => {
  const { root, reviews } = home(t, 4)

  const removed = cleanUp({ root, now: NOW, closed: () => false })

  for (const index of [3, 4]) {
    assert.ok(existsSync(join(reviews, `review-${head(index)}.json`)), `head ${index} is kept whole`)
    assert.ok(existsSync(join(reviews, 'change-review', head(index), 'graph.json')))
  }
  for (const index of [1, 2]) {
    assert.ok(!existsSync(join(reviews, `review-${head(index)}.json`)) && !existsSync(join(reviews, `files-${head(index)}.json`)), `head ${index} loses its review`)
    assert.ok(!existsSync(join(reviews, 'change-review', head(index), 'graph.json')))
    for (const name of ['summary.json', 'progress.json', 'usage.json']) assert.ok(existsSync(join(reviews, 'change-review', head(index), name)), `head ${index} keeps ${name}`)
  }
  assert.ok(existsSync(join(reviews, 'notes.json')))
  assert.equal(removed.length, 2 * (3 + 4))
  assert.deepEqual(cleanUp({ root, now: NOW, closed: () => false }), [], 'a second run removes nothing more')
})

test('a look names what cleaning up would remove and removes nothing', (t) => {
  const { root, reviews } = home(t, 4)

  const named = cleanUp({ root, now: NOW, closed: () => false, look: true })

  assert.equal(named.length, 2 * (3 + 4), 'the same files a real run removes')
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

test('cleaning never follows a link, never leaves the home, and leaves what it does not know', (t) => {
  const { root, reviews } = home(t, 3)
  const outside = temporaryDirectory(t)
  writeFileSync(join(outside, 'review-111111111111.json'), 'precious')
  writeFileSync(join(outside, 'graph.json'), 'precious')
  // A target folder that is a link, and a link inside a change review, both to a folder outside the home.
  symlinkSync(outside, join(root, 'client', 'reviews', 'change+shop+a7'))
  rmSync(join(reviews, 'change-review', head(1), 'graph.json'))
  symlinkSync(join(outside, 'graph.json'), join(reviews, 'change-review', head(1), 'graph.json'))
  writeFileSync(join(reviews, 'change-review', head(1), 'notes-of-mine.txt'), 'kept')

  cleanUp({ root, now: NOW, closed: () => false })

  assert.deepEqual([readFileSync(join(outside, 'review-111111111111.json'), 'utf8'), readFileSync(join(outside, 'graph.json'), 'utf8')], ['precious', 'precious'])
  assert.ok(lstatSync(join(reviews, 'change-review', head(1), 'graph.json')).isSymbolicLink(), 'the link itself is left too')
  assert.ok(existsSync(join(reviews, 'change-review', head(1), 'notes-of-mine.txt')))
})

test('a broken tree is only one the host renamed, and one git still has goes through git', (t) => {
  const root = temporaryDirectory(t)
  const trees = join(root, 'client', 'review-trees')
  mkdirSync(trees, { recursive: true })
  const repo = join(temporaryDirectory(t), 'repo')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
  git('init', '--quiet', '--initial-branch=main')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Start')
  const broken = join(trees, 'shop-broken-2026-11-10T10-00-00-000Z')
  git('worktree', 'add', '--quiet', '--detach', broken, 'HEAD')
  // Live trees whose names only hold the words, and a broken one of no git.
  for (const name of ['fix-broken-links', 'pr+acme+my-broken-app']) git('worktree', 'add', '--quiet', '--detach', join(trees, name), 'HEAD')
  mkdirSync(join(trees, 'blog-broken-2026-11-01T10-00-00-000Z'))

  const removed = cleanUp({ root, now: NOW, closed: () => false })

  assert.deepEqual(removed.sort(), [join(trees, 'blog-broken-2026-11-01T10-00-00-000Z'), broken].sort())
  const listed = git('worktree', 'list', '--porcelain')
  assert.ok(!listed.includes('shop-broken-'), 'git no longer has it')
  for (const name of ['fix-broken-links', 'pr+acme+my-broken-app']) assert.ok(existsSync(join(trees, name)) && listed.includes(name), name)
})

test("the review at the change's commit is kept whole whatever the times, then the newest built; one being built or read in the last day is left", (t) => {
  const { root, reviews } = home(t, 4)
  // Head 1, the oldest built, is where the change is now; head 2 is under way, with progress and no summary yet.
  rmSync(join(reviews, 'change-review', head(2), 'summary.json'))
  // An older folder holds a newer file: times on disk say nothing of when each was built.
  utimesSync(join(reviews, 'change-review', head(1), 'units.json'), NOW / 1000, NOW / 1000)

  cleanUp({ root, now: NOW, closed: () => false, headOf: () => `${head(1)}${'0'.repeat(28)}` })

  assert.ok(existsSync(join(reviews, `review-${head(1)}.json`)), 'at the change\'s commit')
  assert.ok(existsSync(join(reviews, `review-${head(2)}.json`)), 'being built')
  assert.ok(existsSync(join(reviews, `review-${head(4)}.json`)), 'the newest built')
  assert.ok(!existsSync(join(reviews, `review-${head(3)}.json`)))

  const read = home(t, 4)
  assert.deepEqual(cleanUp({ root: read.root, now: NOW, closed: () => false, readRecently: () => true }), [], 'read in the last day: left whole')
})

test('git removes a broken tree only when it would lose nothing: one with changes, or locked, is left and the log says why', (t) => {
  const root = temporaryDirectory(t)
  const trees = join(root, 'client', 'review-trees')
  mkdirSync(trees, { recursive: true })
  const repo = join(temporaryDirectory(t), 'repo')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
  git('init', '--quiet', '--initial-branch=main')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Start')
  const tree = (name: string) => {
    const path = join(trees, `${name}-broken-2026-11-10T10-00-00-000Z`)
    git('worktree', 'add', '--quiet', '--detach', path, 'HEAD')
    return path
  }
  const [clean, dirty, untracked, locked] = [tree('clean'), tree('dirty'), tree('untracked'), tree('locked')]
  writeFileSync(join(dirty, 'a.txt'), 'changed\n')
  writeFileSync(join(untracked, 'notes-left.txt'), 'mine\n')
  git('worktree', 'lock', locked)
  const said: string[] = []

  const looked = cleanUp({ root, now: NOW, closed: () => false, look: true, say: (line) => said.push(line) })
  assert.deepEqual(looked, [clean], 'a look says what git would refuse, too')
  assert.equal(said.length, 3)
  said.length = 0

  const removed = cleanUp({ root, now: NOW, closed: () => false, say: (line) => said.push(line) })

  assert.deepEqual(removed, [clean])
  assert.equal(readFileSync(join(dirty, 'a.txt'), 'utf8'), 'changed\n')
  assert.equal(readFileSync(join(untracked, 'notes-left.txt'), 'utf8'), 'mine\n')
  assert.ok(existsSync(locked))
  assert.equal(said.length, 3)
  for (const path of [dirty, untracked, locked]) {
    const said_ = said.find((line) => line.startsWith(`Reviews: cleaning up left ${path}: git would not remove it: `))
    assert.ok(said_ && said_.length > `Reviews: cleaning up left ${path}: git would not remove it: `.length, `${path} is named with git's reason`)
  }
})

test('what was read in the last day outlives a restart, and a merged change whose review was cleaned up says so when opened', (t) => {
  const { root, reviews: folder } = home(t, 1)
  const make = (finished = false) => {
    const reviews = new Reviews({
      store: reviewStore(root),
      sources: { change: { head: async () => null, read: async () => Promise.reject(new Error('no')) }, pull: { head: async () => null, read: async () => Promise.reject(new Error('no')) } },
      work: () => ({ workAction: async () => ({}) }),
      card: () => null,
      now: () => NOW,
    })
    t.after(() => reviews.close())
    if (finished) reviews.watch([{ id: 'change:shop:a1', head: `${head(1)}${'0'.repeat(28)}` }], 0)
    return reviews
  }
  const target = { kind: 'change' as const, slug: 'shop', item: 'a1' }
  const before = make()
  assert.throws(() => before.get('change:shop:a1'))

  // The host starts again: what was read before is still in use.
  const after = make()
  assert.equal(after.inUse(target, READ_KEPT_MS), true)
  assert.deepEqual(cleanUp({ root, now: NOW, closed: () => true, readRecently: (kept) => after.inUse(kept, READ_KEPT_MS) }), [])

  // Merged long ago and cleaned up: only the summary stays, and opening it says so.
  cleanUp({ root, now: NOW + 40 * DAY, closed: () => true })
  assert.ok(existsSync(join(folder, 'change-review', head(1), 'summary.json')))
  assert.throws(() => make().get('change:shop:a1'), { message: 'Its review was cleaned up after the change was merged or closed; its summary is kept.' })
  assert.throws(() => make(true).get('change:shop:a1'), { message: 'Its review was cleaned up after the change was merged or closed; its summary is kept. Rebuild it to see it again.' })
})
