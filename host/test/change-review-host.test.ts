import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { checkArguments } from '#shared/commands/registry.ts'
import type { AssessmentStatus, AssessmentSummary } from '#shared/review/assessment.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { assessmentFolder, Assessments, readyReviewTree, type AssessRequest, type AssessRun } from '../src/review/assessment.ts'
import { Reviews } from '../src/review/reviews.ts'
import { sampleReviewSource } from '../src/review/sample-source.ts'
import { reviewHandlers } from '../src/review/seat.ts'
import { changeSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

/** A project with a main branch and a finished hobkin branch on it. Only this test's folders are touched. */
function project(t: TestContext) {
  const repo = join(temporaryDirectory(t), 'repo')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
  const write = (path: string, text: string) => {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  git('init', '--quiet', '--initial-branch=main')
  // Written for a folder, as most projects write it: a link in its place would not match.
  write('.gitignore', 'node_modules/\n')
  write('src/total.js', 'export const total = (a, b) => a + b\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Start')
  const base = git('rev-parse', 'HEAD')
  git('checkout', '--quiet', '-b', 'hobkin/4c9e21-round-the-total')
  write('src/total.js', 'export const total = (a, b) => Math.round(a + b)\n')
  git('commit', '--quiet', '-am', 'Round the total')
  const head = git('rev-parse', 'HEAD')
  // The user's own folder goes back to main, as hobkin leaves it after a run.
  git('checkout', '--quiet', 'main')
  return { repo, git, write, base, head }
}

const target = { kind: 'change' as const, slug: 'shop', item: '4c9e21' }

/** An engine that writes what the real one would, counts its runs, and says how far along it is. */
function fakeEngine(levels: ('safe' | 'mid' | 'high')[] = ['high', 'mid', 'safe']) {
  const runs: AssessRequest[] = []
  const engine: AssessRun = async (request) => {
    runs.push(request)
    request.onProgress({ percent: 40, now: 'map-proof: running the tests of total', eta_seconds: 30, steps: [{ id: 'triage', status: 'done', done: 1, total: 1, seconds: 2 }, { id: 'map-proof', status: 'running', done: 1, total: 3, seconds: null }] })
    writeFileSync(join(request.out, 'story.md'), '# Round the total\n')
    writeFileSync(join(request.out, 'units.json'), JSON.stringify({ schema: 'review-units/1', map: 'node-level', attention: { units: levels.length, reading_minutes: 3 }, units: [] }))
    return { units: { units: levels.map((level) => ({ level, critical: false })) }, storyBy: 'host' }
  }
  return { engine, runs }
}

function assessmentsFor(t: TestContext, engine: AssessRun) {
  const { repo, git, write, base, head } = project(t)
  const root = temporaryDirectory(t)
  const states: AssessmentStatus['state'][] = []
  const seen: AssessmentStatus[] = []
  const assessments: Assessments = new Assessments({
    root,
    run: engine,
    repoOf: (slug) => (slug === 'shop' ? repo : null),
    onChange: () => {
      const status = assessments.status(target, head)
      states.push(status.state)
      seen.push(status)
    },
  })
  t.after(() => assessments.close())
  const job = { target, head, base, description: { source: 'commits' as const, title: 'Round the total' } }
  return { repo, git, write, base, head, root, assessments, states, seen, job }
}

test('a finished change is reviewed once per commit, in the background', async (t) => {
  const { engine, runs } = fakeEngine()
  const { repo, git, write, head, root, assessments, states, seen, job } = assessmentsFor(t, engine)

  const first = assessments.start(job)
  assert.equal(first.state, 'queued', 'it starts in the background and answers at once')
  assessments.start(job)
  await assessments.settled()
  assessments.start(job)
  await assessments.settled()

  assert.equal(runs.length, 1, 'the same commit is reviewed once')
  assert.deepEqual([...new Set(states)], ['queued', 'running', 'ready'])
  const running = seen.find((status) => status.state === 'running' && status.steps)
  assert.deepEqual(running?.steps?.map((step) => `${step.id}:${step.status}`), ['triage:done', 'map-proof:running'], 'a running review says how each step stands')
  const done = assessments.status(target, head)
  assert.equal(done.state, 'ready')
  assert.deepEqual({ level: done.summary?.level, needsYou: done.summary?.needsYou, worthALook: done.summary?.worthALook, safe: done.summary?.safe }, { level: 'high', needsYou: 1, worthALook: 1, safe: 1 })

  // The review ran in a tree of its own at the change's commit; the user's folder stayed on main, untouched.
  const tree = runs[0]!.cwd
  assert.ok(statSync(join(tree, '.git')).isFile(), 'the review tree is a linked worktree')
  assert.equal(execFileSync('git', ['-C', tree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), head)
  assert.equal(git('branch', '--show-current'), 'main')
  assert.equal(git('status', '--porcelain'), '')
  assert.match(readFileSync(join(repo, 'src/total.js'), 'utf8'), /a \+ b\n$/)

  // A host started later reads the finished review from the home, without running it again.
  const later = new Assessments({ root, run: engine, repoOf: () => repo })
  assert.equal(later.status(target, head).state, 'ready')
  assert.equal(later.start(job).state, 'ready')
  assert.equal(runs.length, 1)
  assert.equal(later.read(target, head)?.story, '# Round the total\n')

  // A new commit on the change is a new review, in the same tree.
  git('checkout', '--quiet', 'hobkin/4c9e21-round-the-total')
  write('src/total.js', 'export const total = (a, b) => Math.round((a + b) * 100) / 100\n')
  git('commit', '--quiet', '-am', 'Round to cents')
  const next = git('rev-parse', 'HEAD')
  git('checkout', '--quiet', 'main')
  assessments.start({ ...job, head: next })
  await assessments.settled()
  assert.equal(runs.length, 2)
  assert.equal(runs[1]!.cwd, tree)
  assert.equal(execFileSync('git', ['-C', tree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), next)
})

test('a run that stops halfway says so, and the next one starts from a clean tree', async (t) => {
  let fail = true
  const runs: string[] = []
  const engine: AssessRun = async (request) => {
    runs.push(request.cwd)
    if (fail) {
      // As if the engine stopped while a definition was changed for a test run.
      writeFileSync(join(request.cwd, 'src/total.js'), 'broken(')
      writeFileSync(join(request.cwd, 'left-behind.txt'), 'scratch')
      throw new Error('the test command was not found')
    }
    assert.equal(execFileSync('git', ['-C', request.cwd, 'status', '--porcelain'], { encoding: 'utf8' }), '', 'the tree is clean again')
    writeFileSync(join(request.out, 'story.md'), '# ok\n')
    return { units: { units: [{ level: 'safe', critical: false }] }, storyBy: 'host' }
  }
  const { assessments, job, head } = assessmentsFor(t, engine)
  assessments.start(job)
  await assessments.settled()
  const failed = assessments.status(target, head)
  assert.equal(failed.state, 'failed')
  assert.match(failed.error ?? '', /test command was not found/)

  fail = false
  assessments.start(job)
  await assessments.settled()
  assert.equal(assessments.status(target, head).state, 'ready')
  assert.equal(runs.length, 2)
  assert.ok(!existsSync(join(runs[1]!, 'left-behind.txt')))
})

test('the review tree links the project’s installed dependencies when git ignores them, and never takes the project’s own folder', async (t) => {
  const { repo, head } = project(t)
  mkdirSync(join(repo, 'node_modules', 'left-pad'), { recursive: true })
  // Caches tools keep in an install. A tool run in the tree makes its own there, never writing into the project's.
  for (const cache of ['.cache', '.vite', '.vitest']) mkdirSync(join(repo, 'node_modules', cache))
  const tree = join(temporaryDirectory(t), 'trees', 'shop')
  const installs = join(tree, 'node_modules')
  await readyReviewTree({ repo, tree, head })
  assert.ok(lstatSync(installs).isDirectory(), 'a real folder, so an ignore rule written for a folder matches it')
  assert.ok(lstatSync(join(installs, 'left-pad')).isSymbolicLink())
  assert.ok(existsSync(join(installs, 'left-pad')))
  assert.deepEqual(readdirSync(installs), ['left-pad'], 'no cache is linked')
  assert.equal(execFileSync('git', ['-C', tree, 'status', '--porcelain'], { encoding: 'utf8' }), '', 'the tree is clean, so proof can run in it')
  // A second review keeps what is linked.
  await readyReviewTree({ repo, tree, head })
  assert.ok(existsSync(join(installs, 'left-pad')))

  // The links follow the project: an install it gained is linked, and one it lost goes. A tool's own cache in the
  // tree stays, and a cache an older tree linked into the project is taken away.
  mkdirSync(join(installs, '.vite'))
  symlinkSync(join(repo, 'node_modules', '.cache'), join(installs, '.cache'))
  rmSync(join(repo, 'node_modules', 'left-pad'), { recursive: true })
  mkdirSync(join(repo, 'node_modules', 'right-pad'))
  await readyReviewTree({ repo, tree, head })
  assert.deepEqual(readdirSync(installs).sort(), ['.vite', 'right-pad'])
  assert.ok(lstatSync(join(installs, 'right-pad')).isSymbolicLink())
  assert.ok(!lstatSync(join(installs, '.vite')).isSymbolicLink(), 'the tree’s own cache')
  assert.equal(execFileSync('git', ['-C', tree, 'status', '--porcelain'], { encoding: 'utf8' }), '')

  await assert.rejects(readyReviewTree({ repo, tree: repo, head }), /never the project’s own folder/)
  const plain = join(temporaryDirectory(t), 'plain')
  mkdirSync(plain)
  await assert.rejects(readyReviewTree({ repo, tree: plain, head }), /not a review worktree/)
})

test('a broken review tree moves aside, whole, for a new one, so it never breaks the reviews after it', async (t) => {
  const { repo, head } = project(t)
  const trees = join(temporaryDirectory(t), 'trees')
  const tree = join(trees, 'shop')
  const aside = () => readdirSync(trees).filter((name) => name.startsWith('shop-broken-'))
  await readyReviewTree({ repo, tree, head })
  writeFileSync(join(tree, 'left-behind.txt'), 'scratch')

  // Its link to the project's repository is broken, as when the repository lost the worktree's entry.
  rmSync(join(repo, '.git', 'worktrees', 'shop'), { recursive: true })
  await readyReviewTree({ repo, tree, head })
  assert.equal(execFileSync('git', ['-C', tree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), head)
  assert.equal(aside().length, 1)
  assert.equal(readFileSync(join(trees, aside()[0]!, 'left-behind.txt'), 'utf8'), 'scratch', 'nothing in it is deleted')

  // A checkout that fails, as with the lock a git that crashed leaves behind, moves it aside the same way.
  writeFileSync(join(repo, '.git', 'worktrees', 'shop', 'index.lock'), '')
  await readyReviewTree({ repo, tree, head })
  assert.equal(execFileSync('git', ['-C', tree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), head)
  assert.equal(aside().length, 2)
})

test('reviewing a commit again takes its old summary away, so a rerun that fails never shows it beside a new story', async (t) => {
  let fail = false
  const engine: AssessRun = async (request) => {
    // As the engine does, the progress first and then the story, before what failed.
    writeFileSync(join(request.out, 'progress.json'), '{}')
    writeFileSync(join(request.out, 'story.md'), fail ? '# Half of a new story\n' : '# Round the total\n')
    if (fail) throw new Error('the test command was not found')
    return { units: { units: [{ level: 'safe', critical: false }] }, storyBy: 'host' }
  }
  const { assessments, job, head, root, repo } = assessmentsFor(t, engine)
  assessments.start(job)
  await assessments.settled()
  assert.equal(assessments.read(target, head)?.story, '# Round the total\n')

  fail = true
  assessments.start(job, { again: true })
  await assessments.settled()
  assert.equal(assessments.status(target, head).state, 'failed')
  assert.equal(assessments.read(target, head), null, 'no old summary beside the new story')
  assert.equal(new Assessments({ root, run: engine, repoOf: () => repo }).status(target, head).state, 'failed', 'nor after a restart')
})

test('a run that close() stops writes no summary, and says it was stopped', async (t) => {
  let started = () => {}
  const running = new Promise<void>((resolve) => (started = resolve))
  let finish = () => {}
  const signals: AbortSignal[] = []
  const engine: AssessRun = async (request) => {
    signals.push(request.signal)
    started()
    // An engine that misses the signal and finishes as if nothing happened.
    await new Promise<void>((resolve) => (finish = resolve))
    writeFileSync(join(request.out, 'story.md'), '# Round the total\n')
    return { units: { units: [{ level: 'safe', critical: false }] }, storyBy: 'host' }
  }
  const { assessments, job, head, root } = assessmentsFor(t, engine)
  assessments.start(job)
  await running
  assessments.close()
  assert.equal(signals[0]!.aborted, true, 'the run is told to stop')
  finish()
  await assessments.settled()
  const stopped = assessments.status(target, head)
  assert.deepEqual([stopped.state, stopped.error], ['failed', 'The review was stopped before it finished.'])
  assert.equal(existsSync(join(assessmentFolder(root, target, head), 'summary.json')), false)
})

test('a finished change’s review starts its change review, and opens with the story and the levels laid over its graph', async (t) => {
  const { repo, head } = project(t)
  const root = temporaryDirectory(t)
  const runs: AssessRequest[] = []
  const engine: AssessRun = async (request) => {
    runs.push(request)
    writeFileSync(join(request.out, 'story.md'), '# Round the total\n\n## Opening\n')
    // In the graph, total is at its floor, safe, while its unit is mid, as curate rates it (an unverified node is
    // high there). The total it replaced was removed: its lines are the base's, which no line at head is.
    const units = [{ id: 'u1', nodes: ['n1'], level: 'mid', critical: false }, { id: 'u2', nodes: ['n2'], level: 'high', critical: false }]
    writeFileSync(join(request.out, 'units.json'), JSON.stringify({ schema: 'review-units/1', map: 'node-level', attention: { units: 2, reading_minutes: 2 }, units }))
    const total = { kind: 'function', path: 'src/total.js', lines: [1, 1], critical: false }
    const nodes = [{ ...total, id: 'n1', symbol: 'total', change: 'modified', level: { current: 'safe' } }, { ...total, id: 'n2', symbol: 'oldTotal', change: 'removed', level: { current: 'high' } }]
    writeFileSync(join(request.out, 'graph.json'), JSON.stringify({ nodes }))
    return { units: { units: [{ level: 'mid', critical: false }, { level: 'high', critical: false }] }, storyBy: 'model' }
  }
  const reviewsAt = (assessments: Assessments) =>
    new Reviews({
      store: reviewStore(root),
      sources: {
        change: changeSource({ find: () => ({ project: 'shop', title: 'Round the total', branch: 'hobkin/4c9e21-round-the-total', head }), repoOf: () => repo, baseOf: async () => 'main' }),
        pull: { head: async () => null, read: async () => Promise.reject(new Error('no pull requests here')) },
      },
      agent: async () => null,
      work: () => ({ workAction: async () => ({}) }),
      card: () => null,
      // As the live host knows it, from the change's card on the Work screen.
      head: () => head,
      assessments,
    })
  const id = 'change:shop:4c9e21'
  const assessments = new Assessments({ root, run: engine, repoOf: () => repo })
  const reviews = reviewsAt(assessments)
  t.after(() => reviews.close())

  reviews.prepare(id)
  await reviews.settled(id)
  await assessments.settled()
  assert.equal(runs.length, 1, 'the change review started once the graph was ready')
  assert.equal(runs[0]!.head, head)
  assert.equal(reviews.status(id).assessment?.state, 'ready')
  assert.equal(reviews.status(id).assessment?.summary?.level, 'high')

  const opened = reviews.get(id)
  assert.match(opened.assessment?.story ?? '', /^# Round the total/)
  assert.deepEqual(opened.assessment?.nodes.map((node) => [node.id, node.level, node.unit]), [['n1', 'mid', 'u1']], 'each rated node at its unit’s level, and none removed')
  const total = opened.review.nodes.find((node) => node.kind === 'code' && node.subtitle === 'src/total.js')
  assert.equal(total?.level, 'mid', 'the level shows on the graph node whose lines it rated')
  assert.equal(total?.unit, 'u1', 'and the node knows the unit of the story that tells it')
  assert.ok(opened.review.story.some((step) => step.level === 'mid'), 'and on the step that shows it')

  // Asked for again (the card's Review again), the same commit is reviewed once more.
  reviews.prepare(id, { refresh: true })
  await reviews.settled(id)
  await assessments.settled()
  assert.equal(runs.length, 2)

  // A graph prepared before change reviews existed gets one the first time the background looks at it, and only once.
  rmSync(join(root, 'client', 'reviews', 'change+shop+4c9e21', 'change-review'), { recursive: true, force: true })
  const later = new Assessments({ root, run: engine, repoOf: () => repo })
  const again = reviewsAt(later)
  t.after(() => again.close())
  again.watch([{ id, head }])
  again.watch([{ id, head }])
  await later.settled()
  assert.equal(runs.length, 3)
  assert.equal(again.status(id).assessment?.state, 'ready')
})

const SAMPLE = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const SAMPLE_FILES = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]

test('review.list has every review the host knows, newest first, with when each started and how it stands', async (t) => {
  const { repo, head } = project(t)
  const root = temporaryDirectory(t)
  let clock = Date.parse('2026-11-12T15:00:00Z')
  const now = () => clock
  // A pull request an earlier host reviewed: only its files in the home say so.
  const pull = { kind: 'pull' as const, owner: 'acme', repo: 'web', number: 12 }
  reviewStore(root).write(pull, { ...SAMPLE, change: { ...SAMPLE.change, project: 'acme/web', title: 'Tighten the login form' } }, SAMPLE_FILES, { preparedAt: '2026-11-12T09:00:00.000Z', storyBy: 'agent' })
  const then = new Date('2026-11-12T09:00:00Z')
  utimesSync(join(root, 'client', 'reviews', 'pr+acme+web+12', `review-${SAMPLE.change.head.slice(0, 12)}.json`), then, then)

  // A change review that runs until it is let go, so the list is read while it runs.
  let started = () => {}
  const running = new Promise<void>((resolve) => (started = resolve))
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  const engine: AssessRun = async (request) => {
    clock += 5_000
    request.onProgress({ percent: 40, now: 'map-proof: running the tests of total', eta_seconds: 30, steps: [{ id: 'triage', status: 'done', done: 1, total: 1, seconds: 2 }] })
    started()
    await held
    writeFileSync(join(request.out, 'story.md'), '# Round the total\n')
    return { units: { units: [{ level: 'mid', critical: false }] }, storyBy: 'host' }
  }
  const assessments = new Assessments({ root, run: engine, repoOf: () => repo, now })
  const reviews = new Reviews({
    store: reviewStore(root),
    sources: {
      change: changeSource({ find: () => ({ project: 'shop', title: 'Round the total', branch: 'hobkin/4c9e21-round-the-total', head }), repoOf: () => repo, baseOf: async () => 'main' }),
      pull: { head: async () => null, read: async () => Promise.reject(new Error('no pull requests here')) },
    },
    agent: async () => null,
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    head: (target) => (target.kind === 'change' ? head : null),
    describe: (target) => (target.kind === 'change' ? { title: 'Round the total', project: 'shop' } : null),
    assessments,
    now,
  })
  t.after(() => {
    release()
    reviews.close()
  })
  const id = 'change:shop:4c9e21'

  // Asked for, the change is being prepared, and says since when, there and in its status.
  reviews.prepare(id)
  const preparing = reviews.list().reviews
  assert.deepEqual(
    preparing.map(({ id: name, kind, title, project: where, state, startedAt, updatedAt }) => [name, kind, title, where, state, startedAt, updatedAt]),
    [
      [id, 'change', 'Round the total', 'shop', 'preparing', '2026-11-12T15:00:00.000Z', '2026-11-12T15:00:00.000Z'],
      ['pr:acme/web/12', 'pull', 'Tighten the login form', 'acme/web', 'ready', undefined, '2026-11-12T09:00:00.000Z'],
    ],
  )
  assert.equal(preparing[1]!.assessment, undefined, 'a pull request has no change review')
  assert.equal(reviews.status(id).startedAt, '2026-11-12T15:00:00.000Z')

  // Its graph is ready, so its preparation says no start; its change review runs, and keeps the time it started.
  await running
  const [change] = reviews.list().reviews
  assert.deepEqual([change!.id, change!.state, change!.phase, change!.startedAt, change!.head], [id, 'ready', null, undefined, head])
  assert.deepEqual(change!.assessment, { state: 'running', head, percent: 40, now: 'map-proof: running the tests of total', eta: 30, startedAt: '2026-11-12T15:00:00.000Z' }, 'the list leaves the steps out')
  assert.equal(reviews.status(id).assessment?.startedAt, '2026-11-12T15:00:00.000Z', 'the status keeps it across every update')
  assert.equal(reviews.status(id).assessment?.steps?.length, 1)

  release()
  await assessments.settled()
  const [done] = reviews.list().reviews
  assert.deepEqual([done!.assessment?.state, done!.assessment?.summary?.level, done!.assessment?.startedAt], ['ready', 'mid', undefined])
  assert.equal(done!.updatedAt, '2026-11-12T15:00:05.000Z')

  // The window and hobkin ask for it by name.
  assert.deepEqual(checkArguments('review.list', {}), { ok: true })
  assert.deepEqual(await reviewHandlers(reviews)['review.list']!({}), reviews.list())
})

test('hobkin is told when a change review is ready, once a run, and when a pull request review the user asked for is', async (t) => {
  const told: { head: string; summary: AssessmentSummary }[] = []
  let fail = false
  const engine: AssessRun = async (request) => {
    if (fail) throw new Error('the test command was not found')
    writeFileSync(join(request.out, 'story.md'), '# Round the total\n')
    return { units: { units: [{ level: 'high', critical: true }] }, storyBy: 'model' }
  }
  const { repo, head, root, job } = assessmentsFor(t, engine)
  const assessments = new Assessments({ root, run: engine, repoOf: () => repo, onReady: ({ head: at, summary }) => told.push({ head: at, summary }) })
  t.after(() => assessments.close())
  assessments.start(job)
  await assessments.settled()
  assessments.start(job)
  await assessments.settled()
  assert.deepEqual(told.map(({ head: at, summary }) => [at, summary.level, summary.critical, summary.needsYou]), [[head, 'high', true, 1]])
  fail = true
  assessments.start(job, { again: true })
  await assessments.settled()
  assert.equal(told.length, 1, 'a run that fails tells nothing')

  // A pull request's review is told when the user asked for it, and not when the background prepared it.
  const ready: string[] = []
  const reviews = new Reviews({
    store: reviewStore(temporaryDirectory(t)),
    sources: { change: { head: async () => null, read: async () => Promise.reject(new Error('no changes here')) }, pull: sampleReviewSource() },
    agent: async () => null,
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    skill: () => 'You arrange a change review.',
    onReady: ({ target, review, at }) => ready.push(`${target.kind}:${review.change.title}:${typeof at}`),
  })
  t.after(() => reviews.close())
  reviews.prepare('pr:acme/web/12', { asked: true })
  reviews.watch([{ id: 'pr:acme/web/13', updatedAt: '2026-11-12T10:00:00Z' }])
  await reviews.settled()
  assert.equal(reviews.status('pr:acme/web/13').state, 'ready')
  assert.deepEqual(ready, [`pull:${SAMPLE.change.title}:string`])
})
