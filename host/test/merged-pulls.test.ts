import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { chooseProject, fileItem, readItems, updateItem } from 'hobkin/src/cli/work/store.mjs'
import { githubRepoOf, MergedPulls, pullOf, type ReviewedPull } from '../src/merged-pulls.ts'
import type { GhCall } from '../src/review/gh.ts'
import { temporaryDirectory } from './support.ts'

// A pull request that merged on GitHub itself leaves the finished changes and the reviews within a read, by hobkin's own
// close. The home is the test's own, in a temporary folder, with hobkin's real store; gh is a fake that never reaches GitHub.

type Pull = { number: number; url: string; state: 'OPEN' | 'MERGED' | 'CLOSED'; headRefName: string; mergedAt?: string | null; mergeCommit?: { oid: string } | null }

const pull = (number: number, state: Pull['state'], headRefName: string, repo = 'acme/web'): Pull => ({
  number,
  url: `https://github.com/${repo}/pull/${number}`,
  state,
  headRefName,
  mergedAt: state === 'MERGED' ? '2026-11-24T10:00:00Z' : null,
  mergeCommit: state === 'MERGED' ? { oid: 'a'.repeat(40) } : null,
})

/** A home with one project in a folder whose origin is acme/web, and finished items on it. */
function world(t: TestContext) {
  const base = temporaryDirectory(t)
  const root = join(base, 'home')
  const folder = join(base, 'web')
  mkdirSync(folder, { recursive: true })
  execFileSync('git', ['init', '-q', folder])
  execFileSync('git', ['-C', folder, 'remote', 'add', 'origin', 'git@github.com:acme/web.git'])
  const { slug } = chooseProject(root, folder, 'important')
  const finish = (key: string, change: Record<string, unknown>) => {
    const { id } = fileItem(root, slug, { key, kind: 'fix', title: key, brief: 'Brief.' })
    updateItem(root, slug, id, change)
    return id
  }
  const state = (id: string) => (readItems(root, slug) as { id: string; state: string; [key: string]: unknown }[]).find((item) => item.id === id)!
  return { root, slug, finish, state }
}

/** gh as the test plays it: what GitHub lists for the repository, and every call written down. */
function fakeGh(pulls: () => Pull[]) {
  const asked: (readonly string[])[] = []
  const gh: GhCall = async (args) => {
    asked.push(args)
    return { kind: 'done', stdout: JSON.stringify(pulls()) }
  }
  return { gh, asked }
}

function seat(t: TestContext, home: ReturnType<typeof world>, pulls: () => Pull[], extra: { reviewed?: ReviewedPull[]; now?: () => number } = {}) {
  const { gh, asked } = fakeGh(pulls)
  const said = { retired: [] as ReviewedPull[], closed: [] as string[], changed: 0, log: [] as string[] }
  const merged = new MergedPulls({
    data: () => home.root,
    gh,
    reviewed: () => extra.reviewed ?? [],
    retire: (target) => said.retired.push(target),
    closed: ({ url }) => said.closed.push(url),
    changed: () => {
      said.changed += 1
    },
    ...(extra.now ? { now: extra.now } : {}),
    log: (line) => said.log.push(line),
  })
  t.after(() => merged.close())
  return { merged, asked, said }
}

test('a finished change whose pull request GitHub says merged is closed as merged on the next read, by hobkin', async (t) => {
  const home = world(t)
  const id = home.finish('named', { state: 'pr', branch: 'hobkin/aaa-named', pr: 'https://github.com/acme/web/pull/7' })
  const { merged, said } = seat(t, home, () => [pull(7, 'MERGED', 'hobkin/aaa-named')])

  await merged.read()

  const item = home.state(id)
  assert.equal(item.state, 'merged')
  assert.equal(item.afterMerge, 'due', 'the pass after a merge finds it, as for a merge from a card')
  assert.equal((item.landed as { sha?: string }).sha, 'a'.repeat(40))
  assert.deepEqual(said.closed, ['https://github.com/acme/web/pull/7'], 'the GitHub page drops it at once')
  assert.equal(said.changed, 1, 'the window is told once')
})

test('a finished branch whose pull request was opened elsewhere is closed when that pull request merged, found by its head branch', async (t) => {
  const home = world(t)
  const id = home.finish('layer', { state: 'branch', branch: 'stack/rpg/2-menu' })
  const { merged, said } = seat(t, home, () => [pull(9, 'MERGED', 'stack/rpg/2-menu'), pull(10, 'OPEN', 'stack/rpg/3-other')])

  await merged.read()

  assert.equal(home.state(id).state, 'merged')
  assert.deepEqual(said.closed, ['https://github.com/acme/web/pull/9'])
})

test('a pull request still open leaves its change as it is, and nothing is told', async (t) => {
  const home = world(t)
  const id = home.finish('open', { state: 'pr', branch: 'hobkin/bbb-open', pr: 'https://github.com/acme/web/pull/3' })
  const { merged, said } = seat(t, home, () => [pull(3, 'OPEN', 'hobkin/bbb-open')])

  await merged.read()

  assert.equal(home.state(id).state, 'pr')
  assert.deepEqual({ closed: said.closed, changed: said.changed }, { closed: [], changed: 0 })
})

test('a pull request closed without merging is not settled as merged: its change goes back to its branch, as the survey does', async (t) => {
  const home = world(t)
  const id = home.finish('closed', { state: 'pr', branch: 'hobkin/ccc-closed', pr: 'https://github.com/acme/web/pull/4' })
  const { merged } = seat(t, home, () => [pull(4, 'CLOSED', 'hobkin/ccc-closed')])

  await merged.read()

  const item = home.state(id)
  assert.equal(item.state, 'branch')
  assert.equal(item.pr, null)
  assert.equal(item.closedPr, 'https://github.com/acme/web/pull/4')
  assert.equal(item.branch, 'hobkin/ccc-closed')
  assert.equal(item.mergedAt, undefined)
})

test('a branch with a closed pull request and no open or merged one stays a branch, untouched', async (t) => {
  const home = world(t)
  const id = home.finish('plain', { state: 'branch', branch: 'hobkin/ddd-plain' })
  const { merged, said } = seat(t, home, () => [pull(5, 'CLOSED', 'hobkin/ddd-plain')])

  await merged.read()

  assert.equal(home.state(id).state, 'branch')
  assert.equal(said.changed, 0)
})

test('a newer open pull request on the same branch keeps the change open, as the survey reads it', () => {
  const found = pullOf({ id: 'x', state: 'branch', branch: 'b' }, [pull(1, 'MERGED', 'b'), pull(2, 'OPEN', 'b')])
  assert.equal(found?.number, 2)
})

test('GitHub is asked once for each repository and no more than once a minute, however many changes and reviews wait on it', async (t) => {
  const home = world(t)
  home.finish('a', { state: 'pr', branch: 'b-a', pr: 'https://github.com/acme/web/pull/1' })
  home.finish('b', { state: 'branch', branch: 'b-b' })
  home.finish('c', { state: 'pr', branch: 'b-c', pr: 'https://github.com/acme/web/pull/3' })
  let at = 1_000_000
  const reviewed = [1, 2, 3].map((number) => ({ owner: 'acme', repo: 'web', number }))
  const { merged, asked } = seat(t, home, () => [pull(1, 'OPEN', 'b-a'), pull(3, 'OPEN', 'b-c')], { reviewed, now: () => at })

  await merged.read()
  assert.equal(asked.length, 1)
  assert.deepEqual(asked[0]!.slice(0, 5), ['pr', 'list', '--repo', 'acme/web', '--state'])

  at += 30_000
  await merged.read()
  assert.equal(asked.length, 1, 'half a minute later it waits')

  at += 31_000
  await merged.read()
  assert.equal(asked.length, 2, 'a minute later it asks again, still once')
})

test('a reviewed pull request that GitHub says merged or closed is retired, and an open one is not', async (t) => {
  const home = world(t)
  const reviewed = [1, 2, 3].map((number) => ({ owner: 'acme', repo: 'web', number }))
  const { merged, said } = seat(t, home, () => [pull(1, 'MERGED', 'x'), pull(2, 'CLOSED', 'y'), pull(3, 'OPEN', 'z')], { reviewed })

  await merged.read()

  assert.deepEqual(said.retired.map((target) => target.number), [1, 2])
  assert.equal(said.changed, 0, 'no item changed, so hobkin is not read again for it')
})

test('a pull request on another code host is never asked of GitHub', async (t) => {
  const home = world(t)
  const { merged, asked } = seat(t, home, () => [], { reviewed: [{ owner: 'a', repo: 'b', number: 1, host: 'gitlab' }] })

  await merged.read()

  assert.equal(asked.length, 0)
})

test('a read that fails is logged and leaves everything as it was, and the next read tries again', async (t) => {
  const home = world(t)
  const id = home.finish('named', { state: 'pr', branch: 'hobkin/aaa-named', pr: 'https://github.com/acme/web/pull/7' })
  let fail = true
  let at = 1_000_000
  const gh: GhCall = async () => (fail ? { kind: 'failed', code: 1, stdout: '', stderr: 'boom' } : { kind: 'done', stdout: JSON.stringify([pull(7, 'MERGED', 'hobkin/aaa-named')]) })
  const log: string[] = []
  const merged = new MergedPulls({ data: () => home.root, gh, reviewed: () => [], retire: () => {}, closed: () => {}, changed: () => {}, now: () => at, log: (line) => log.push(line) })
  t.after(() => merged.close())

  await merged.read()
  assert.equal(home.state(id).state, 'pr')
  assert.match(log.join('\n'), /boom/)

  fail = false
  at += 61_000
  await merged.read()
  assert.equal(home.state(id).state, 'merged')
})

test('remote addresses in any shape name their repository', () => {
  for (const remote of ['git@github.com:Acme/web.git', 'https://github.com/acme/web', 'https://github.com/acme/web.git\n', 'ssh://git@github.com/acme/web.git']) assert.equal(githubRepoOf(remote), 'acme/web')
  assert.equal(githubRepoOf('git@gitlab.com:acme/web.git'), null)
})
