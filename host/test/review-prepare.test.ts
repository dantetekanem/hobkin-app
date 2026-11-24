import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { reviewStore } from '../src/review/store.ts'
import { changeSource, pullSource } from '../src/review/sources.ts'
import { Reviews } from '../src/review/reviews.ts'
import { temporaryDirectory } from './support.ts'

/** A repository with a main branch and a finished hobkin branch on top of it. Only this test's folder is touched. */
function repository(t: TestContext) {
  const repo = join(temporaryDirectory(t), 'repo')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
  const write = (path: string, text: string) => {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  git('init', '--quiet', '--initial-branch=main')
  write('src/doing.ts', 'export function doingAfter(previous: string) {\n  return previous\n}\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Start')
  git('checkout', '--quiet', '-b', 'hobkin/7d02c9-say-what-hobkin-is-doing')
  write('src/doing.ts', "export function doingAfter(previous: string, event: { type: string }) {\n  if (event.type === 'tool') return 'working'\n  return previous\n}\n")
  write('test/doing.test.ts', "import { doingAfter } from '../src/doing.ts'\n\ntest('a tool says it is working', () => {\n  assert.equal(doingAfter('', { type: 'tool' }), 'working')\n})\n")
  write(
    '_specs/7d02c9-say-what-hobkin-is-doing/spec.md',
    '---\n{ "id": "7d02c9-say-what-hobkin-is-doing", "title": "Say what hobkin is doing", "kind": "work", "status": "done", "depends": [], "updated": "2026-11-10" }\n---\n# Say what hobkin is doing\n\n## Outcome\nA tool says hobkin is working.\n\n## Acceptance\n- A1. A tool says working.\n\n## Proof\n- A1. `test/doing.test.ts` › "a tool says it is working"\n',
  )
  git('add', '.')
  git('commit', '--quiet', '-m', 'Say what hobkin is doing')
  return { repo, git, write, head: () => git('rev-parse', 'HEAD') }
}

function reviewsFor(t: TestContext, more: Partial<ConstructorParameters<typeof Reviews>[0]> = {}) {
  const { repo, git, write, head } = repository(t)
  const home = temporaryDirectory(t)
  const store = reviewStore(home)
  let current = head()
  // gh is not here, so every pull request fails to read. Each try is written down.
  const pullTries: string[][] = []
  // Every preparation reads the change once, so the reads say how many were made.
  const reads: string[] = []
  const source = changeSource({
    find: () => ({ project: 'hobkin', title: 'Say what hobkin is doing', branch: 'hobkin/7d02c9-say-what-hobkin-is-doing', head: current }),
    repoOf: () => repo,
    baseOf: async () => 'main',
  })
  const reviews = new Reviews({
    store,
    sources: {
      change: {
        head: (target) => source.head(target),
        read: (target, at) => {
          reads.push(at)
          return source.read(target, at)
        },
      },
      pull: pullSource({
        gh: async (args) => {
          pullTries.push([...args])
          return { kind: 'missing' }
        },
      }),
    },
    work: () => ({ workAction: async () => ({ message: 'unused' }) }),
    card: () => null,
    ...more,
  })
  return { reviews, store, home, git, write, pullTries, reads, move: () => (current = head()) }
}

const ID = 'change:hobkin:7d02c9'

test('prepares one head once', async (t) => {
  const { reviews, home, git, write, move, reads } = reviewsFor(t)

  assert.equal(reviews.prepare(ID).state, 'preparing', 'it answers at once, while the work goes on in the background')
  // Asked again while it is under way, it joins the same preparation.
  reviews.prepare(ID)
  await reviews.settled(ID)
  assert.equal(reviews.status(ID).state, 'ready')
  assert.equal(reads.length, 1)

  const opened = reviews.get(ID)
  assert.equal(opened.review.change.title, 'Say what hobkin is doing')
  assert.ok(opened.review.nodes.some((node) => node.kind === 'criterion' && node.id === 'A1' && node.status === 'proven'))
  assert.ok(reviews.file(ID, 'src/doing.ts').head?.includes("'working'"))

  // Prepared again for the same commit: the file in the home is used, and the change is not read again.
  reviews.prepare(ID)
  await reviews.settled(ID)
  assert.equal(reads.length, 1)

  // A new commit makes a new review, and the old file stays in place.
  const first = opened.review.change.head
  write('src/doing.ts', "export function doingAfter(previous: string, event: { type: string }) {\n  if (event.type === 'tool') return 'working'\n  if (event.type === 'retry') return 'retrying'\n  return previous\n}\n")
  git('commit', '--quiet', '-am', 'Say retrying')
  move()
  assert.equal(reviews.prepare(ID).state, 'ready', 'the review of the older commit opens while the newer one is prepared')
  assert.equal(reviews.get(ID).review.change.head, first)
  await reviews.settled(ID)
  assert.equal(reads.length, 2)
  assert.notEqual(reviews.get(ID).review.change.head, first)
  const folder = join(home, 'client', 'reviews', 'change+hobkin+7d02c9')
  assert.deepEqual(readdirSync(folder).filter((name) => name.startsWith('review-')).length, 2)
  assert.ok(existsSync(join(folder, `review-${first.slice(0, 12)}.json`)))
})

test('a review’s graph is the host’s own: no model narrates it', async (t) => {
  const { reviews } = reviewsFor(t)
  reviews.prepare(ID)
  await reviews.settled(ID)

  const { review, status } = reviews.get(ID)
  assert.equal(status.storyBy, 'host')
  assert.equal(review.story[0]!.kind, 'outcome')
  assert.ok(review.edges.every((edge) => edge.certainty === 'host'))
})

test('a failed preparation says why, and a review is opened only once it is ready', async (t) => {
  const unreadable = { head: async () => 'a'.repeat(40), read: async () => Promise.reject(new Error('The repository cannot be read.')) }
  const { reviews } = reviewsFor(t, { sources: { change: unreadable, pull: unreadable } })
  assert.throws(() => reviews.get(ID), /still being prepared/)
  reviews.prepare(ID)
  await reviews.settled(ID)
  assert.deepEqual([reviews.status(ID).state, reviews.status(ID).error], ['failed', 'The repository cannot be read.'])
  assert.throws(() => reviews.get(ID), /could not be prepared: The repository cannot be read/)
})

test('the background prepares what has no review yet, a few at a time, and again when the commit moves', async (t) => {
  const clock = { now: Date.parse('2026-11-10T10:00:00Z') }
  const { reviews, git, write, move, pullTries, reads } = reviewsFor(t, { now: () => clock.now })
  reviews.watch([{ id: ID }, { id: 'pr:acme/shop/1' }, { id: 'pr:acme/shop/2' }], 1)
  await reviews.settled()
  assert.equal(reads.length, 1, 'only one, the limit, was queued')
  assert.equal(reviews.status('pr:acme/shop/1').state, 'idle')
  // Looked at already, so watching again queues nothing.
  reviews.watch([{ id: ID }], 5)
  await reviews.settled()
  assert.equal(reads.length, 1)

  // The change moved to a new commit, so it is prepared again.
  write('src/doing.ts', "export function doingAfter(previous: string, event: { type: string }) {\n  if (event.type === 'tool') return 'working'\n  if (event.type === 'retry') return 'retrying'\n  return previous\n}\n")
  git('commit', '--quiet', '-am', 'Say retrying')
  const head = move()
  reviews.watch([{ id: ID, head }], 5)
  await reviews.settled()
  assert.equal(reads.length, 2)
  assert.equal(reviews.get(ID).review.change.head, head)

  // A pull request that could not be read is tried again a day later, in its turn: not on each look, and not each time
  // GitHub says it changed.
  const pull = { id: 'pr:acme/shop/1', updatedAt: '2026-11-10T09:00:00Z' }
  reviews.watch([pull], 5)
  await reviews.settled()
  assert.equal(reviews.status(pull.id).state, 'failed')
  const tries = pullTries.length
  reviews.watch([pull], 5)
  await reviews.settled()
  assert.equal(pullTries.length, tries)
  reviews.watch([{ ...pull, updatedAt: '2026-11-10T09:30:00Z' }], 5)
  await reviews.settled()
  assert.equal(pullTries.length, tries)
  clock.now += 24 * 60 * 60 * 1000
  reviews.watch([{ ...pull, updatedAt: '2026-11-10T09:30:00Z' }], 5)
  await reviews.settled()
  assert.ok(pullTries.length > tries)
})

test('a review asked for whose graph older rules drew is drawn again; one drawn by these rules is used as it is', async (t) => {
  const { reviews, store, reads } = reviewsFor(t)
  reviews.prepare(ID)
  await reviews.settled(ID)
  assert.equal(reads.length, 1)
  const { review, files } = store.latest({ kind: 'change', slug: 'hobkin', item: '7d02c9' })!
  // As a host before these rules left it: no word of how its graph was drawn.
  store.write({ kind: 'change', slug: 'hobkin', item: '7d02c9' }, review, files, { preparedAt: '2026-11-12T09:00:00.000Z', storyBy: 'agent' })

  const later = reviewsFor(t)
  later.store.write({ kind: 'change', slug: 'hobkin', item: '7d02c9' }, review, files, { preparedAt: '2026-11-12T09:00:00.000Z', storyBy: 'agent' })
  later.reviews.prepare(ID, { asked: true })
  await later.reviews.settled(ID)
  assert.equal(later.reads.length, 1, 'drawn again')
  later.reviews.prepare(ID, { asked: true })
  await later.reviews.settled(ID)
  assert.equal(later.reads.length, 1, 'and then used as it is')
})
