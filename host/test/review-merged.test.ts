import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { reviewIdOf, type ReviewTarget } from '#shared/review/ids.ts'
import type { ReviewLanding } from '#shared/review/status.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { Assessments, type AssessRequest, type AssessRun } from '../src/review/assessment.ts'
import { GRAPH_RULES, Reviews } from '../src/review/reviews.ts'
import { changeSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

/** A project with main and a finished hobkin branch on it. Only this test's folders are touched. */
function project(t: TestContext) {
  const repo = join(temporaryDirectory(t), 'repo')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
  const write = (path: string, text: string) => {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  git('init', '--quiet', '--initial-branch=main')
  write('src/total.js', 'export const total = (a, b) => a + b\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Start')
  git('checkout', '--quiet', '-b', 'hobkin/4c9e21-round-the-total')
  write('src/total.js', 'export const total = (a, b) => Math.round(a + b)\n')
  git('commit', '--quiet', '-am', 'Round the total')
  const head = git('rev-parse', 'HEAD')
  git('checkout', '--quiet', 'main')
  return { repo, head }
}

/** An engine that runs until it is stopped, as a long change review does, and writes down each run. */
function endlessEngine() {
  const runs: AssessRequest[] = []
  const engine: AssessRun = (request) => {
    runs.push(request)
    return new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('stopped'))))
  }
  return { engine, runs }
}

const merged: ReviewLanding = { state: 'merged', sha: 'f'.repeat(40), into: 'main', message: 'Merged into main.' }

test('a finished change that merges gets no more AI review: the one under way stops, a waiting map leaves the queue, nothing queues it again, and it leaves the list', async (t) => {
  const { repo, head } = project(t)
  const root = temporaryDirectory(t)
  const { engine, runs } = endlessEngine()
  const assessments = new Assessments({ root, run: engine, repoOf: () => repo })
  const landed = new Set<string>()
  const reviews = new Reviews({
    store: reviewStore(root),
    sources: {
      change: changeSource({ find: () => ({ project: 'shop', title: 'Round the total', branch: 'hobkin/4c9e21-round-the-total', head }), repoOf: () => repo, baseOf: async () => 'main' }),
      pull: { head: async () => null, read: async () => Promise.reject(new Error('no pull requests here')) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    head: () => head,
    // hobkin's own records: a change it merged, whether on the review's yes or from its card on the Work screen.
    landing: (target) => (landed.has(reviewIdOf(target)) ? merged : null),
    assessments,
  })
  t.after(() => reviews.close())
  const [first, second] = ['change:shop:4c9e21', 'change:shop:9a8b7c']

  reviews.prepare(first)
  await reviews.settled(first)
  while (runs.length === 0) await new Promise((resolve) => setImmediate(resolve))
  assert.equal(reviews.status(first).assessment?.state, 'running')
  // Another finished change waits behind it for its map.
  reviews.prepare(second)
  reviews.prepare(first, { refresh: true })

  // Both merge. The host publishes its state, and the background looks again: they are no longer finished changes.
  landed.add(first)
  landed.add(second)
  reviews.watch([])
  await assessments.settled()
  await reviews.settled()

  assert.equal(runs[0]!.signal.aborted, true, 'the change review under way is stopped where it is')
  assert.equal(runs.length, 1, 'no other change review starts')
  assert.match(reviews.status(first).assessment?.error ?? '', /merged, so its review is not needed/)
  assert.ok(!reviews.list().reviews.some((item) => item.id === first || item.id === second), 'neither is listed')
  assert.ok(reviewStore(root).has({ kind: 'change', slug: 'shop', item: '4c9e21' }, head), 'what the review wrote is kept')

  // Asked for again, by the window or by the background, nothing is queued.
  reviews.prepare(first, { refresh: true, asked: true })
  reviews.watch([{ id: first, head }, { id: second, head }])
  await reviews.settled()
  await assessments.settled()
  assert.equal(runs.length, 1)
  assert.equal(reviews.status(second).phase, null, 'the one that waited never started')
})

const SAMPLE = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const SAMPLE_FILES = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]

test('a pull request closed or merged on its host gets no more AI review: the sweep stops the one under way, and neither the window nor the background queues another', async (t) => {
  const root = temporaryDirectory(t)
  const pull: ReviewTarget = { kind: 'pull', owner: 'acme', repo: 'web', number: 12 }
  const id = reviewIdOf(pull)
  const head = SAMPLE.change.head
  const store = reviewStore(root)
  // Its graph is drawn already, so preparing it goes straight to its change review.
  store.write(pull, SAMPLE, SAMPLE_FILES, { preparedAt: '2026-11-20T09:00:00.000Z', storyBy: 'host', graph: GRAPH_RULES })
  let open = true
  const calls: string[] = []
  const under = new Map<string, ReviewTarget>()
  const assessments = {
    start: (job: { target: ReviewTarget; head: string }) => {
      calls.push(`start ${reviewIdOf(job.target)}`)
      under.set(reviewIdOf(job.target), job.target)
      return { state: 'queued', head: job.head }
    },
    stop: (target: ReviewTarget, why?: string) => {
      calls.push(`stop ${reviewIdOf(target)}: ${why}`)
      return under.delete(reviewIdOf(target))
    },
    pending: () => [...under.values()],
    status: () => ({ state: 'idle', head: null }),
    present: () => null,
    read: () => null,
    busy: () => false,
    forget: () => {},
    close: () => {},
  }
  const reviews = new Reviews({
    store,
    sources: {
      change: { head: async () => null, read: async () => Promise.reject(new Error('no changes here')) },
      pull: { head: async () => (open ? head : null), read: async () => Promise.reject(new Error('drawn already')) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    assessments: assessments as never,
  })
  t.after(() => reviews.close())

  reviews.prepare(id, { asked: true })
  await reviews.settled(id)
  assert.deepEqual(calls, [`start ${id}`])

  // Merged on GitHub by someone else: the sweep finds it is no longer open.
  open = false
  await reviews.sweepPulls({ force: true })
  assert.deepEqual(calls, [`start ${id}`, `stop ${id}: Its pull request is closed, so its review is not needed.`])
  assert.ok(!reviews.list().reviews.some((item) => item.id === id), 'it leaves the list')

  reviews.prepare(id, { refresh: true, asked: true })
  reviews.watch([{ id, head }])
  await reviews.settled()
  assert.equal(calls.length, 2, 'nothing queues it again')
  assert.ok(store.landedAt(pull), 'the home keeps it, marked closed')
})
