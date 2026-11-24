import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { addIssue } from 'hobkin/src/cli/work/issues.mjs'
import { chooseProject, updateItem, writeOwnerView } from 'hobkin/src/cli/work/store.mjs'
import type { GhCall, GhOutcome } from '#host/review/gh.ts'
import type { WorkApp } from '#host/work.ts'
import { temporaryDirectory } from '../../../host/test/support.ts'
import type { GitHubSource } from '../host/github.ts'
import { partFor, run, takes } from './host-support.ts'

// Close issue on the GitHub page, through the GitHub part with a fake context: gh closes it as the user, and hobkin declines its item when that work is not finished.
// gh is always the test's and never reaches GitHub, and hobkin's application is a stand-in that writes down what it was asked.

/** A home of the test's with one project taken, in a folder whose origin is acme/web on GitHub. Nothing ever fetches it. */
function homeWithProject(t: TestContext) {
  const base = temporaryDirectory(t)
  const root = join(base, 'home')
  const folder = join(base, 'web')
  mkdirSync(folder, { recursive: true })
  execFileSync('git', ['init', '-q', folder])
  execFileSync('git', ['-C', folder, 'remote', 'add', 'origin', 'git@github.com:acme/web.git'])
  const { slug } = chooseProject(root, folder, 'important')
  return { root, slug }
}

/** gh as the test plays it: it writes down what it was asked and answers as told. */
function fakeGh(outcome: GhOutcome = { kind: 'done', stdout: '' }) {
  const asked: (readonly string[])[] = []
  const gh: GhCall = async (args) => {
    asked.push(args)
    return outcome
  }
  return { gh, asked }
}

/** hobkin's application as the test plays it: every work action it is asked for, answered in hobkin's words or as told. */
function fakeHobkin(answers: Record<string, () => unknown> = {}) {
  const calls: unknown[][] = []
  const app: WorkApp = {
    workAction: async (...args: unknown[]) => {
      calls.push(args)
      const answer = answers[String(args[0])]
      return answer ? answer() : { ok: true, message: `hobkin did ${String(args[0])}.` }
    },
    refresh: async () => {},
  }
  return { app, calls }
}

interface Seat {
  app: WorkApp
  gh?: GhCall
  /** Each time GitHub is read again, written down. */
  refreshes?: string[]
}

/** Close issue as the host runs it, on a seat of the test's. Each read of GitHub is written down. */
async function closeIssueOn(root: string, { app, gh, refreshes = [] }: Seat, args: { repo: string; number: number; reason: 'completed' | 'not-planned' }) {
  const source: GitHubSource = {
    sample: false,
    read: async () => {
      refreshes.push('github')
      return { found: 'missing' }
    },
  }
  return run(await partFor({ app, root, gh, source }), 'github.issue.close', args)
}

const filed = (root: string, slug: string, number: number) => addIssue(root, slug, { repo: 'acme/web', number, title: `Issue ${number}` }).id

test('Close issue closes it through gh with the reason the user chose, then reads GitHub again, and asks hobkin nothing for an issue it has no work for', async (t) => {
  const { root } = homeWithProject(t)
  const { app, calls } = fakeHobkin()
  const { gh, asked } = fakeGh()
  const seat: Seat = { app, gh, refreshes: [] }

  const completed = await closeIssueOn(root, seat, { repo: 'acme/web', number: 12, reason: 'completed' })
  const notPlanned = await closeIssueOn(root, seat, { repo: 'acme/web', number: 13, reason: 'not-planned' })

  assert.deepEqual(asked, [
    ['issue', 'close', '12', '--repo', 'acme/web', '--reason', 'completed'],
    ['issue', 'close', '13', '--repo', 'acme/web', '--reason', 'not planned'],
  ])
  assert.deepEqual([completed, notPlanned], [
    { ok: true, value: { message: 'Closed acme/web#12 on GitHub as completed.' } },
    { ok: true, value: { message: 'Closed acme/web#13 on GitHub as not planned.' } },
  ])
  assert.deepEqual(seat.refreshes, ['github', 'github'])
  assert.deepEqual(calls, [])
})

test("an issue whose hobkin item is not finished closes, and hobkin declines the item with its own work action, in hobkin's words", async (t) => {
  const { root, slug } = homeWithProject(t)
  const id = filed(root, slug, 12)
  const { app, calls } = fakeHobkin({ decline: () => ({ ok: true, message: 'Said no to "Issue 12" on web. Its branch stays, and hobkin learns from this.' }) })

  const result = await closeIssueOn(root, { app, gh: fakeGh().gh }, { repo: 'Acme/Web', number: 12, reason: 'not-planned' })

  assert.deepEqual(calls, [['decline', slug, id]])
  assert.deepEqual(result, { ok: true, value: { message: 'Closed Acme/Web#12 on GitHub as not planned. Said no to "Issue 12" on web. Its branch stays, and hobkin learns from this.' } })
})

test('an item running for the issue stops as not approved, and finished work is left as it is', async (t) => {
  const { root, slug } = homeWithProject(t)
  const running = filed(root, slug, 12)
  const merged = filed(root, slug, 13)
  updateItem(root, slug, running, { state: 'doing' })
  updateItem(root, slug, merged, { state: 'merged' })
  writeOwnerView(root, { running: [{ id: 'work:web:do:1', slug, item: running, lane: 'do', title: 'web: Issue 12' }] })
  writeFileSync(join(root, 'runtime.lock'), '')
  const { app, calls } = fakeHobkin()
  const seat = { app, gh: fakeGh().gh }

  await closeIssueOn(root, seat, { repo: 'acme/web', number: 12, reason: 'completed' })
  await closeIssueOn(root, seat, { repo: 'acme/web', number: 13, reason: 'completed' })

  assert.deepEqual(calls, [['stop', 'work:web:do:1', 'decline']])
})

test('a gh that cannot close the issue says why, and hobkin is asked nothing', async (t) => {
  const { root, slug } = homeWithProject(t)
  filed(root, slug, 12)
  const { app, calls } = fakeHobkin()
  const refused = fakeGh({ kind: 'failed', code: 1, stdout: '', stderr: 'GraphQL: Resource not accessible by integration (closeIssue)' })

  const result = await closeIssueOn(root, { app, gh: refused.gh }, { repo: 'acme/web', number: 12, reason: 'completed' })

  assert.deepEqual(result, { ok: false, error: { code: 'failed', message: 'gh said: GraphQL: Resource not accessible by integration (closeIssue)' } })
  assert.deepEqual(calls, [])
})

test('an item hobkin cannot decline leaves the issue closed, and says why', async (t) => {
  const { root, slug } = homeWithProject(t)
  filed(root, slug, 12)
  const { app } = fakeHobkin({
    decline: () => {
      throw new Error('"Issue 12" is already running. hobkin work cancel 3fa9c1 stops it.')
    },
  })

  const result = await closeIssueOn(root, { app, gh: fakeGh().gh }, { repo: 'acme/web', number: 12, reason: 'completed' })

  assert.deepEqual(result, {
    ok: true,
    value: { message: 'Closed acme/web#12 on GitHub as completed, and hobkin could not decline its item: "Issue 12" is already running. hobkin work cancel 3fa9c1 stops it.' },
  })
})

test('a host that never runs gh refuses and closes nothing, and the command takes a repository, a number and one of two reasons', async (t) => {
  const { root } = homeWithProject(t)
  const { app, calls } = fakeHobkin()

  const result = await closeIssueOn(root, { app }, { repo: 'acme/web', number: 12, reason: 'completed' })

  assert.deepEqual(result, {
    ok: false,
    error: { code: 'unavailable', message: 'This host does not run gh, so nothing was closed. Start the host with --github to close issues.' },
  })
  assert.deepEqual(calls, [])
  assert.equal(takes('github.issue.close', { repo: 'acme/web', number: 1, reason: 'not-planned' }), true)
  const wrong = [{ repo: 'acme/web', number: 1 }, { repo: 'acme/web', number: 1, reason: 'duplicate' }, { repo: 'acme', number: 1, reason: 'completed' }, { repo: 'acme/web', number: 0, reason: 'completed' }]
  for (const args of wrong) assert.equal(takes('github.issue.close', args), false, JSON.stringify(args))
})
