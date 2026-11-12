import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { ReviewLanding } from '#shared/review/status.ts'
import { mergePlan } from '../src/review/landing.ts'
import { Reviews, type ChangeCard } from '../src/review/reviews.ts'
import { changeSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const ID = 'change:shop:f07742'
const BRANCH = 'hobkin/f07742-round-the-total'

/** A project with main and a finished hobkin branch, which main can move past, as it does while a change waits for its yes. */
function project(t: TestContext) {
  const repo = join(temporaryDirectory(t), 'shop')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
  const commit = (path: string, text: string, message: string) => {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), text)
    git('add', '.')
    git('commit', '--quiet', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '--quiet', '--initial-branch=main')
  commit('src/total.js', 'export const total = (a, b) => a + b\n', 'Start')
  git('checkout', '--quiet', '-b', BRANCH)
  const reviewed = commit('src/total.js', 'export const total = (a, b) => Math.round(a + b)\n', 'Round the total')
  git('checkout', '--quiet', 'main')
  /** main gains a commit: in another file, or on the line the change touched. */
  const moveMain = (conflicting = false) => {
    git('checkout', '--quiet', 'main')
    const sha = conflicting ? commit('src/total.js', 'export const total = (a, b) => Math.floor(a + b)\n', 'Floor the total') : commit('README.md', 'Shop\n', 'Readme')
    return sha
  }
  /** The branch rebased onto main, as hobkin's refresh does: the same change on a newer base. */
  const rebase = () => {
    git('checkout', '--quiet', BRANCH)
    git('rebase', '--quiet', 'main')
    const sha = git('rev-parse', 'HEAD')
    git('checkout', '--quiet', 'main')
    return sha
  }
  const addToBranch = (message: string) => {
    git('checkout', '--quiet', BRANCH)
    const sha = commit('src/total.js', 'export const total = (a, b) => Math.round(a + b) // to cents next\n', message)
    git('checkout', '--quiet', 'main')
    return sha
  }
  return { repo, git, reviewed, moveMain, rebase, addToBranch }
}

/** Reviews over that project, with hobkin's card and records faked: what its work actions were asked is written down. */
async function seat(t: TestContext, { landing = 'refreshMerge' as ChangeCard['landing'], pr = null as string | null } = {}) {
  const fixture = project(t)
  let current = fixture.reviewed
  let landed: ReviewLanding | null = null
  // A merged change leaves the Work screen's finished list: hobkin has no card for it any more.
  const listed = () => landed?.state !== 'merged'
  const actions: unknown[][] = []
  const reviews = new Reviews({
    store: reviewStore(temporaryDirectory(t)),
    sources: {
      change: changeSource({ find: () => ({ project: 'shop', title: 'Round the total', branch: BRANCH, head: current }), repoOf: () => fixture.repo, baseOf: async () => 'main' }),
      pull: { head: async () => null, read: async () => Promise.reject(new Error('unused')) },
    },
    work: () => ({
      workAction: async (...args: unknown[]) => {
        actions.push(args)
        return { message: `hobkin did ${String(args[0])}.` }
      },
    }),
    // The card says what hobkin last weighed: refresh and merge for a branch behind main, as it did in the loop.
    card: () => (listed() ? { landing, yes: landing === 'refreshMerge' ? 'Refresh and merge it' : 'Merge it', branch: BRANCH, pr } : null),
    head: () => (listed() ? current : null),
    landing: () => landed,
    merging: (_target, change) => mergePlan({ repo: fixture.repo, into: 'main', ...change }),
  })
  t.after(() => reviews.close())
  reviews.prepare(ID)
  await reviews.settled(ID)
  assert.equal(reviews.status(ID).state, 'ready', reviews.status(ID).error ?? '')
  return { ...fixture, reviews, actions, moveTo: (sha: string) => (current = sha), land: (state: ReviewLanding | null) => (landed = state) }
}

test('approve and merge merges a branch that merges cleanly straight away, whatever its card says, and refreshes only a real conflict', async (t) => {
  // Behind main, with no conflict: hobkin's card would refresh it first. The yes merges it.
  const behind = await seat(t)
  behind.moveMain()
  const short = behind.reviewed.slice(0, 7)
  const preview = await behind.reviews.preview(ID, 'approve-merge', '', behind.reviewed)
  assert.deepEqual(preview.lines, ['Merge it into main on this machine, with a merge commit. Nothing is pushed.', `At commit ${short}, the one this review was built from.`])
  assert.deepEqual(behind.actions, [], 'a preview asks hobkin nothing')
  assert.deepEqual(await behind.reviews.verdict(ID, 'approve-merge', '', preview.confirm, behind.reviewed), { message: 'hobkin did merge.' })
  assert.deepEqual(behind.actions, [['merge', 'shop', 'f07742', { head: behind.reviewed }]])

  // Main has not moved: it fast-forwards.
  const ahead = await seat(t, { landing: 'merge' })
  assert.equal((await ahead.reviews.preview(ID, 'approve-merge', '')).lines[0], `Merge it into main on this machine: main moves up to ${ahead.reviewed.slice(0, 7)}. Nothing is pushed.`)

  // A real conflict is what a refresh is for, and the preview says so as the thing being confirmed.
  const conflict = await seat(t, { landing: 'merge' })
  conflict.moveMain(true)
  const asked = await conflict.reviews.preview(ID, 'approve-merge', '')
  assert.equal(asked.lines[0], 'It conflicts with main: an agent brings it up to date, then hobkin merges it.')
  await conflict.reviews.verdict(ID, 'approve-merge', '', asked.confirm)
  assert.deepEqual(conflict.actions, [['refreshMerge', 'shop', 'f07742', { head: conflict.reviewed }]])

  // A change with its pull request open merges as that pull request.
  const pull = await seat(t, { landing: 'refreshMerge', pr: 'https://github.com/acme/shop/pull/9' })
  pull.moveMain()
  const merged = await pull.reviews.preview(ID, 'approve-merge', '')
  assert.equal(merged.lines[0], `Merge its pull request on GitHub, https://github.com/acme/shop/pull/9, at ${pull.reviewed.slice(0, 7)}.`)
  await pull.reviews.verdict(ID, 'approve-merge', '', merged.confirm)
  assert.deepEqual(pull.actions, [['mergePr', 'shop', 'f07742', { head: pull.reviewed }]])
})

test('a branch that moved since its review is merged where it is now, and the preview says what moved instead of refusing', async (t) => {
  // Rebased onto main: the same change.
  const rebased = await seat(t)
  rebased.moveMain()
  const after = rebased.moveTo(rebased.rebase())
  const preview = await rebased.reviews.preview(ID, 'approve-merge', '', rebased.reviewed)
  assert.deepEqual(preview.lines, [
    `Merge it into main on this machine: main moves up to ${after.slice(0, 7)}. Nothing is pushed.`,
    `Since this review it was rebased onto main: the same change, now at ${after.slice(0, 7)}.`,
    `This merges ${after.slice(0, 7)}, the commit shown here.`,
  ])
  await rebased.reviews.verdict(ID, 'approve-merge', '', preview.confirm, rebased.reviewed)
  assert.deepEqual(rebased.actions, [['merge', 'shop', 'f07742', { head: after }]], 'pinned to the commit the preview showed')
  assert.equal(rebased.reviews.status(ID).stale, true, 'the review itself is still of the older commit')

  // Given a commit more: its subject is said.
  const grown = await seat(t)
  grown.moveTo(grown.addToBranch('Say cents are next'))
  assert.equal((await grown.reviews.preview(ID, 'approve-merge', '')).lines[1], 'Since this review it gained 1 commit: "Say cents are next".')

  // Moved again between the preview and the yes: what the yes would do changed, so it is shown again first.
  const twice = await seat(t)
  const shown = await twice.reviews.preview(ID, 'approve-merge', '')
  twice.moveTo(twice.addToBranch('One more'))
  await assert.rejects(twice.reviews.verdict(ID, 'approve-merge', '', shown.confirm), /has changed since it was shown/)
  assert.deepEqual(twice.actions, [])
})

test('a merged change is a state: its status says where it landed, and any verdict on it answers so, with nothing done', async (t) => {
  const { reviews, actions, land } = await seat(t)
  land({ state: 'merged', sha: 'a1b2c3d4e5f6a7b8c9d0', at: '2026-11-12T21:13:00.000Z', into: 'main', message: 'Merged into main at a1b2c3d.' })
  assert.deepEqual(reviews.status(ID).landing, { state: 'merged', sha: 'a1b2c3d4e5f6a7b8c9d0', at: '2026-11-12T21:13:00.000Z', into: 'main', message: 'Merged into main at a1b2c3d.' })
  assert.equal(reviews.get(ID).status.landing?.state, 'merged')
  for (const verdict of ['approve-merge', 'approve', 'request-changes'] as const) {
    const preview = await reviews.preview(ID, verdict, 'Fix it.')
    assert.deepEqual(preview.lines, ['Already merged into main at a1b2c3d.'])
    assert.deepEqual(await reviews.verdict(ID, verdict, 'Fix it.', preview.confirm), { message: 'Already merged into main at a1b2c3d.' })
  }
  assert.deepEqual(actions, [], 'nothing is asked of hobkin')
  // Nothing is left to prepare.
  assert.equal(reviews.prepare(ID, { asked: true }).phase, null)
})

test('while hobkin brings a change up to date to merge it, its moving head is neither outdated nor reviewed again, and a yes is not asked twice', async (t) => {
  const { reviews, actions, land, moveTo, rebase, moveMain } = await seat(t)
  land({ state: 'refreshing', at: '2026-11-12T20:51:00.000Z', into: 'main', message: 'An agent is bringing it up to date with main, and hobkin merges it once that run ends well.' })
  moveMain()
  const head = moveTo(rebase())
  assert.equal(reviews.status(ID).stale, false)
  assert.equal(reviews.get(ID).status.stale, false)
  reviews.watch([{ id: ID, head }])
  assert.equal(reviews.status(ID).phase, null, 'the background prepares no new review for it')

  const preview = await reviews.preview(ID, 'approve-merge', '')
  assert.deepEqual(preview.lines, ['An agent is bringing it up to date with main, and hobkin merges it once that run ends well.'])
  assert.deepEqual(await reviews.verdict(ID, 'approve-merge', '', preview.confirm), { message: 'An agent is bringing it up to date with main, and hobkin merges it once that run ends well.' })
  assert.deepEqual(actions, [], 'the word it already has covers it')
})

test('the host reads where a change landed from hobkin’s own records: merged with its commit and branch, or being refreshed to merge', async (t) => {
  const { repo, reviewed } = project(t)
  const data = temporaryDirectory(t)
  const records = (slug: string, items: object[]) => {
    mkdirSync(join(data, 'work', slug), { recursive: true })
    writeFileSync(join(data, 'work', 'projects.jsonl'), `${JSON.stringify({ slug, path: repo })}\n`)
    writeFileSync(join(data, 'work', slug, 'items.jsonl'), items.map((item) => `${JSON.stringify(item)}\n`).join(''))
  }
  // As hobkin writes them: events folded by id, the last word winning.
  records('shop', [
    { id: 'f07742', title: 'Round the total', state: 'branch', branch: BRANCH },
    { id: 'f07742', state: 'merged', mergedAt: '2026-11-12T21:13:00.000Z', landed: { sha: reviewed, at: '2026-11-12T21:13:00.000Z' } },
    { id: 'a11111', title: 'Floor the total', state: 'branch', branch: 'hobkin/a11111-floor', mergeWhenFresh: { at: '2026-11-12T20:51:00.000Z' } },
    { id: 'b22222', title: 'Waits', state: 'branch', branch: 'hobkin/b22222-waits' },
  ])
  const { hostReviews } = await import('../src/review/seat.ts')
  const reviews = hostReviews({ root: temporaryDirectory(t), live: false, data: () => data, work: () => null, app: () => ({ workAction: async () => ({}) }), runtime: async () => undefined })
  t.after(() => reviews.close())

  const merged = reviews.status(ID).landing
  assert.deepEqual([merged?.state, merged?.sha, merged?.at], ['merged', reviewed, '2026-11-12T21:13:00.000Z'])
  // The branch it went into is found with git once, and named from then on.
  for (let tries = 0; !reviews.status(ID).landing?.into && tries < 100; tries += 1) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual([reviews.status(ID).landing?.into, reviews.status(ID).landing?.message], ['main', `Merged into main at ${reviewed.slice(0, 7)}.`])
  assert.deepEqual([reviews.status('change:shop:a11111').landing?.state, reviews.status('change:shop:a11111').landing?.at], ['refreshing', '2026-11-12T20:51:00.000Z'])
  assert.equal(reviews.status('change:shop:b22222').landing, undefined, 'a change still waiting for its yes has none')
})

test('a change its default branch already holds is reviewed over its own commits, never as an empty change', async (t) => {
  const read = async (repo: string, head: string, recorded: string | null = null) => {
    const source = changeSource({ find: () => ({ project: 'shop', title: 'Round the total', branch: BRANCH, head }), repoOf: () => repo, baseOf: async () => 'main', recorded: () => recorded })
    return (await source.read({ kind: 'change', slug: 'shop', item: 'f07742' }, head)).capture
  }
  const start = (git: (...args: string[]) => string) => git('rev-list', '--max-parents=0', 'main')

  // Merged with a merge commit after main moved on: the change starts where main stood before that merge.
  const merged = project(t)
  merged.moveMain()
  merged.git('merge', '--quiet', '--no-ff', '-m', 'Merge: Round the total', BRANCH)
  const byMerge = await read(merged.repo, merged.reviewed)
  assert.deepEqual([byMerge.base, byMerge.files.map((file) => file.path)], [start(merged.git), ['src/total.js']])

  // Fast-forwarded: where its last review said it started, when that is behind it.
  const forwarded = project(t)
  const forkedAt = start(forwarded.git)
  forwarded.git('merge', '--quiet', '--ff-only', BRANCH)
  assert.deepEqual((await read(forwarded.repo, forwarded.reviewed, forkedAt)).files.map((file) => file.path), ['src/total.js'])
  // With no review to say so, its own last commit.
  const alone = await read(forwarded.repo, forwarded.reviewed)
  assert.deepEqual([alone.base, alone.files.length], [forkedAt, 1])
})
