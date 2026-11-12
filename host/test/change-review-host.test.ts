import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { AssessmentStatus } from '#shared/review/assessment.ts'
import { Assessments, readyReviewTree, type AssessRequest, type AssessRun } from '../src/review/assessment.ts'
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
  write('.gitignore', 'node_modules\n')
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
    request.onProgress({ percent: 40, now: 'map-proof: running the tests of total', eta_seconds: 30, steps: [] })
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
  const assessments: Assessments = new Assessments({
    root,
    run: engine,
    repoOf: (slug) => (slug === 'shop' ? repo : null),
    onChange: () => states.push(assessments.status(target, head).state),
  })
  t.after(() => assessments.close())
  const job = { target, head, base, description: { source: 'commits' as const, title: 'Round the total' } }
  return { repo, git, write, base, head, root, assessments, states, job }
}

test('a finished change is reviewed once per commit, in the background', async (t) => {
  const { engine, runs } = fakeEngine()
  const { repo, git, write, head, root, assessments, states, job } = assessmentsFor(t, engine)

  const first = assessments.start(job)
  assert.equal(first.state, 'queued', 'it starts in the background and answers at once')
  assessments.start(job)
  await assessments.settled()
  assessments.start(job)
  await assessments.settled()

  assert.equal(runs.length, 1, 'the same commit is reviewed once')
  assert.deepEqual([...new Set(states)], ['queued', 'running', 'ready'])
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
  const tree = join(temporaryDirectory(t), 'trees', 'shop')
  await readyReviewTree({ repo, tree, head })
  assert.ok(lstatSync(join(tree, 'node_modules')).isSymbolicLink())
  assert.ok(existsSync(join(tree, 'node_modules', 'left-pad')))
  assert.equal(execFileSync('git', ['-C', tree, 'status', '--porcelain'], { encoding: 'utf8' }), '')

  await assert.rejects(readyReviewTree({ repo, tree: repo, head }), /never the project’s own folder/)
  const plain = join(temporaryDirectory(t), 'plain')
  mkdirSync(plain)
  await assert.rejects(readyReviewTree({ repo, tree: plain, head }), /not a review worktree/)
})
