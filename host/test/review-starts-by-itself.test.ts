import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { NO_GITHUB_LISTS, type GitHubPull, type GitHubState } from '#shared/protocol/github.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import type { AssessJob } from '../src/review/assessment.ts'
import { assessmentFolder, Assessments, type AssessRequest, type AssessRun } from '../src/review/assessment.ts'
import { Reviews } from '../src/review/reviews.ts'
import { sampleReviewSource } from '../src/review/sample-source.ts'
import { toPrepare } from '../src/review/seat.ts'
import { changeSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const ID = 'change:shop:4c9e21'
const TARGET = { kind: 'change' as const, slug: 'shop', item: '4c9e21' }
const BRANCH = 'hobkin/4c9e21-round-the-total'

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
  git('checkout', '--quiet', '-b', BRANCH)
  write('src/total.js', 'export const total = (a, b) => Math.round(a + b)\n')
  git('commit', '--quiet', '-am', 'Round the total')
  const head = git('rev-parse', 'HEAD')
  git('checkout', '--quiet', 'main')
  /** An agent reworks the change on its branch: a new commit there, which the card does not know yet. */
  const rework = (text: string) => {
    git('checkout', '--quiet', BRANCH)
    write('src/total.js', text)
    git('commit', '--quiet', '-am', 'Rework the total')
    git('checkout', '--quiet', 'main')
    return git('rev-parse', BRANCH)
  }
  return { repo, head, rework }
}

/** An engine that writes its progress as the real one does, then finishes, fails, or runs until it is stopped. */
function engineThat(does: 'finishes' | 'fails' | 'runs') {
  const runs: AssessRequest[] = []
  const engine: AssessRun = (request) => {
    runs.push(request)
    writeFileSync(join(request.out, 'progress.json'), '{}')
    if (does === 'fails') return Promise.reject(new Error('the test command was not found'))
    if (does === 'runs') return new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('stopped'))))
    writeFileSync(join(request.out, 'story.md'), '# Round the total\n')
    return Promise.resolve({ units: { units: [{ level: 'safe', critical: false }] }, storyBy: 'host' })
  }
  return { engine, runs }
}

/** A host on `root`: its reviews of the shop's finished change, with the card naming `card` and the engine given. */
function hostOn(t: TestContext, { root, repo, card, engine, now }: { root: string; repo: string; card: () => string; engine: AssessRun; now?: () => number }) {
  const assessments = new Assessments({ root, run: engine, repoOf: () => repo })
  const reads: string[] = []
  const source = changeSource({ find: () => ({ project: 'shop', title: 'Round the total', branch: BRANCH, head: card() }), repoOf: () => repo, baseOf: async () => 'main' })
  const reviews = new Reviews({
    store: reviewStore(root),
    sources: {
      change: {
        head: (target) => source.head(target),
        read: (target, at) => {
          reads.push(at)
          return source.read(target, at)
        },
      },
      pull: { head: async () => null, read: async () => Promise.reject(new Error('no pull requests here')) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    head: () => card(),
    assessments,
    ...(now ? { now } : {}),
  })
  t.after(() => reviews.close())
  return { reviews, assessments, reads }
}

async function until(ready: () => boolean) {
  for (let turn = 0; turn < 400 && !ready(); turn += 1) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.ok(ready(), 'it came to pass in time')
}

test("a finished change's review that was cut short starts again by itself, once for its commit", async (t) => {
  const { repo, head } = project(t)
  const root = temporaryDirectory(t)

  // The host quits while the change's AI review is under way.
  const quitting = engineThat('runs')
  const first = hostOn(t, { root, repo, card: () => head, engine: quitting.engine })
  first.reviews.prepare(ID)
  await until(() => quitting.runs.length === 1)
  first.reviews.close()
  await first.assessments.settled()

  // The next host's background starts it again, with no click.
  const finishing = engineThat('finishes')
  const second = hostOn(t, { root, repo, card: () => head, engine: finishing.engine })
  assert.equal(second.reviews.status(ID).assessment?.state, 'failed', 'until then it reads as stopped before it finished')
  second.reviews.watch([{ id: ID, head }])
  await second.assessments.settled()
  assert.equal(finishing.runs.length, 1)
  assert.equal(second.reviews.status(ID).assessment?.state, 'ready')

  // Cut short again after it was started again: the next host leaves it, so a review that keeps dying costs one more run.
  rmSummary(root, head)
  const third = hostOn(t, { root, repo, card: () => head, engine: finishing.engine })
  third.reviews.watch([{ id: ID, head }])
  await third.assessments.settled()
  assert.equal(finishing.runs.length, 1, 'not started a second time for the same commit')
  assert.match(third.reviews.status(ID).assessment?.error ?? '', /stopped before it finished twice/)
})

/** As a run that was cut short after it took the place of a finished one: its progress stays, and no answer. */
function rmSummary(root: string, head: string) {
  rmSync(join(assessmentFolder(root, TARGET, head), 'summary.json'), { force: true })
}

test('a review that failed with a reason of its own is not started again by itself, after a restart either', async (t) => {
  const { repo, head } = project(t)
  const root = temporaryDirectory(t)
  const failing = engineThat('fails')
  const first = hostOn(t, { root, repo, card: () => head, engine: failing.engine })
  first.reviews.prepare(ID)
  await first.reviews.settled(ID)
  await first.assessments.settled()
  assert.equal(failing.runs.length, 1)
  first.reviews.close()

  const later = engineThat('finishes')
  const second = hostOn(t, { root, repo, card: () => head, engine: later.engine })
  second.reviews.watch([{ id: ID, head }])
  await second.assessments.settled()
  assert.equal(later.runs.length, 0)
  assert.deepEqual([second.reviews.status(ID).assessment?.state, second.reviews.status(ID).assessment?.error], ['failed', 'the test command was not found'], 'it says its own reason')
})

test('a review the user stopped is not started again by itself after a restart', async (t) => {
  const { repo, head } = project(t)
  const root = temporaryDirectory(t)
  const running = engineThat('runs')
  const first = hostOn(t, { root, repo, card: () => head, engine: running.engine })
  first.reviews.prepare(ID)
  await until(() => running.runs.length === 1)
  first.reviews.stop(ID)
  await first.assessments.settled()
  first.reviews.close()

  const later = engineThat('finishes')
  const second = hostOn(t, { root, repo, card: () => head, engine: later.engine })
  second.reviews.watch([{ id: ID, head }])
  await second.assessments.settled()
  assert.equal(later.runs.length, 0)
  assert.equal(second.reviews.status(ID).assessment?.error, 'Stopped before it finished, as you asked.')
})

test('a finished change whose branch moved is reviewed at the new commit by itself within a minute, while its card still names the older one', async (t) => {
  const { repo, head, rework } = project(t)
  const root = temporaryDirectory(t)
  let now = 1_000_000
  const finishing = engineThat('finishes')
  const { reviews, assessments, reads } = hostOn(t, { root, repo, card: () => head, engine: finishing.engine, now: () => now })
  reviews.prepare(ID)
  await reviews.settled(ID)
  await assessments.settled()
  assert.deepEqual(reads, [head])

  // An agent reworks the change. hobkin's card still names the commit it last published.
  const moved = rework('export const total = (a, b) => Math.round((a + b) * 100) / 100\n')
  reviews.watch([{ id: ID, head }])
  await until(() => reads.length === 2)
  await reviews.settled()
  await assessments.settled()
  assert.equal(reads[1], moved, 'the graph is drawn at the commit the branch is at')
  assert.equal(finishing.runs.at(-1)?.head, moved, 'and the AI review runs there')
  assert.equal(reviews.status(ID).head, moved)
  assert.equal(reviews.get(ID).review.change.head, moved)

  // The branch moves again within the minute: the background does not ask git again until the minute is up.
  const again = rework('export const total = (a, b) => Math.round(a + b + 0)\n')
  now += 30_000
  reviews.watch([{ id: ID, head }])
  await new Promise((resolve) => setTimeout(resolve, 50))
  await reviews.settled()
  assert.equal(reads.length, 2)
  now += 31_000
  reviews.watch([{ id: ID, head }])
  await until(() => reads.length === 3)
  await reviews.settled()
  await assessments.settled()
  assert.equal(reads[2], again)
  assert.equal(existsSync(join(assessmentFolder(root, TARGET, again), 'summary.json')), true)
})

test('a finished change whose review has not started is listed as waiting its turn, and one the user removed is not', async (t) => {
  const root = temporaryDirectory(t)
  const sample = sampleReviewSource()
  const head = await sample.head(TARGET)
  const reviews = new Reviews({ store: reviewStore(root), sources: { change: sample, pull: sample }, work: () => ({ workAction: async () => ({}) }), card: () => null, head: () => head })
  t.after(() => reviews.close())
  const [first, second] = ['change:shop:a1', 'change:shop:b2']

  // The background takes one at a time here: the second waits for a later publish, and nothing of it has started.
  reviews.watch([{ id: first, head }, { id: second, head }], 1)
  const waiting = reviews.list().reviews.find((item) => item.id === second)
  assert.deepEqual([waiting?.state, waiting?.waiting], ['idle', true])
  assert.equal(reviews.list().reviews.find((item) => item.id === first)?.waiting, undefined, 'the first is under way')

  await reviews.settled()
  reviews.watch([{ id: first, head }, { id: second, head }], 1)
  assert.equal(reviews.list().reviews.find((item) => item.id === second)?.waiting, undefined, 'its turn came')
  await reviews.settled()

  // Removed by the user: the background does not build it again at the same commit, so it does not wait for anything.
  reviews.remove(second)
  reviews.watch([{ id: first, head }, { id: second, head }], 1)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok(!reviews.list().reviews.some((item) => item.id === second && item.waiting))
})

const pull = (number: number, over: Partial<GitHubPull> = {}): GitHubPull => ({
  repo: 'acme/shop',
  number,
  title: `Pull ${number}`,
  labels: [],
  updatedAt: '2026-11-20T10:00:00Z',
  url: `https://github.com/acme/shop/pull/${number}`,
  draft: false,
  author: 'someone',
  review: 'none',
  checks: 'passing',
  ...over,
})

function githubWith(lists: Partial<Pick<GitHubState, 'pulls' | 'reviews'>>, sample = false): GitHubState {
  return { ...NO_GITHUB_LISTS, connection: 'connected', login: 'the-user', refreshedAt: null, refreshing: false, error: null, sample, ...lists }
}

const workWith = (pr: string | null = null) => ({ finished: [{ changes: [{ slug: 'shop', item: '4c9e21', head: 'a'.repeat(40), pr }] }] }) as unknown as WorkState

test('pull requests are prepared by themselves only as the setting names them: the user’s own, those waiting for their review, both, or none', () => {
  const github = githubWith({ pulls: [pull(1), pull(2, { draft: true }), pull(3)], reviews: [pull(7), pull(1)] })
  const ids = (watched: { id: string }[]) => watched.map(({ id }) => id)

  assert.deepEqual(ids(toPrepare(workWith(), github)), [ID], 'none, unless the setting says so')
  assert.deepEqual(ids(toPrepare(workWith(), github, { pulls: 'none' })), [ID])
  assert.deepEqual(ids(toPrepare(workWith(), github, { pulls: 'mine' })), [ID, 'pr:acme/shop/1', 'pr:acme/shop/3'], 'a draft is not ready for a review')
  assert.deepEqual(ids(toPrepare(workWith(), github, { pulls: 'waiting' })), [ID, 'pr:acme/shop/7', 'pr:acme/shop/1'])
  assert.deepEqual(ids(toPrepare(workWith(), github, { pulls: 'both' })), [ID, 'pr:acme/shop/1', 'pr:acme/shop/3', 'pr:acme/shop/7'], 'each once')
  assert.deepEqual(toPrepare(workWith(), github, { pulls: 'mine' })[1], { id: 'pr:acme/shop/1', updatedAt: '2026-11-20T10:00:00Z' }, 'watched again when it changes on GitHub')

  // A finished change's own pull request is that change's review, and made-up data is never reviewed.
  assert.deepEqual(ids(toPrepare(workWith('https://github.com/acme/shop/pull/3'), github, { pulls: 'mine' })), [ID, 'pr:acme/shop/1'])
  assert.deepEqual(ids(toPrepare(workWith(), githubWith({ pulls: [pull(1)] }, true), { pulls: 'both' })), [ID])
})

test('with "my pull requests" on, a pull request of the user’s gets an AI review with no click; with it off, none starts', async (t) => {
  const started: AssessJob[] = []
  const assessments = {
    status: () => ({ state: 'idle', head: null }),
    cutShort: () => false,
    start: (job: AssessJob) => {
      started.push(job)
      return { state: 'queued', head: job.head }
    },
    stop: () => false,
    pending: () => [],
    present: () => null,
    read: () => null,
    busy: () => false,
    forget: () => {},
    close: () => {},
  } as unknown as Assessments
  const sample = sampleReviewSource()
  const reviews = new Reviews({ store: reviewStore(temporaryDirectory(t)), sources: { change: sample, pull: sample }, work: () => ({ workAction: async () => ({}) }), card: () => null, assessments })
  t.after(() => reviews.close())
  const github = githubWith({ pulls: [pull(12)] })
  const empty = { finished: [] } as unknown as WorkState

  reviews.watch(toPrepare(empty, github))
  await reviews.settled()
  assert.equal(started.length, 0, 'off: nothing starts')

  reviews.watch(toPrepare(empty, github, { pulls: 'mine' }))
  await reviews.settled()
  assert.deepEqual(started.map((job) => [job.target, job.head]), [[{ kind: 'pull', owner: 'acme', repo: 'shop', number: 12 }, await sample.head(TARGET)]])
})
