import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Merged } from '#host/integration-contract.ts'
import type { GhCall, GhOutcome } from '#host/review/gh.ts'
import { GITHUB_UNKNOWN, type GitHubIssue } from '../protocol.ts'
import manifest from '../integration.ts'
import type { GitHubRead, GitHubSource } from '../host/github.ts'
import { GH_ARGS } from '../host/gh.ts'
import { partFor, run } from './host-support.ts'

// The GitHub part, built with a fake context. No gh ever runs and no browser opens.

const pull = (number: number) => ({
  repo: 'octo/app', number, title: `Pull ${number}`, labels: [], updatedAt: '2026-11-09T10:00:00Z', url: `https://github.com/octo/app/pull/${number}`, draft: false, author: 'octocat', review: 'none' as const, checks: 'none' as const,
})
const issue = (number: number): GitHubIssue => ({ ...pull(number), url: `https://github.com/octo/app/issues/${number}`, assigned: true, authored: false })

/** A source that counts its reads and answers with these lists. */
function counting(lists: { reviews?: number[]; pulls?: number[]; issues?: number[] } = {}) {
  const source: GitHubSource & { reads: number } = {
    sample: false,
    reads: 0,
    read: async (): Promise<GitHubRead> => {
      source.reads += 1
      return {
        found: 'connected',
        login: 'octocat',
        lists: {
          reviews: (lists.reviews ?? []).map(pull),
          pulls: (lists.pulls ?? []).map(pull),
          issues: (lists.issues ?? []).map(issue),
          more: { reviews: false, pulls: false, issues: false },
        },
        note: null,
      }
    },
  }
  return source
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('the part reads from the source a test hands it, else from gh when the host has gh, else made-up data', async () => {
  const given = counting({ pulls: [3] })
  const handed = await partFor({ source: given, gh: async () => assert.fail('gh must not run when a source is handed') })
  const refreshed = (await run(handed, 'github.refresh', {})) as { ok: true; value: { login: string; sample: boolean } }
  assert.equal(refreshed.value.login, 'octocat')
  assert.equal(given.reads, 1)

  const asked: (readonly string[])[] = []
  const gh: GhCall = async (args, _input, options): Promise<GhOutcome> => {
    asked.push(args)
    assert.equal(options?.timeoutMs, 20_000, 'the read keeps its 20 seconds')
    const empty = { issueCount: 0, nodes: [] }
    return { kind: 'done', stdout: JSON.stringify({ data: { viewer: { login: 'real-user' }, reviews: empty, pulls: empty, assigned: empty, authored: empty } }) }
  }
  const real = await partFor({ gh })
  const read = (await run(real, 'github.refresh', {})) as { ok: true; value: { login: string; sample: boolean } }
  assert.deepEqual(asked, [GH_ARGS])
  assert.deepEqual([read.value.login, read.value.sample], ['real-user', false])

  const sample = await partFor()
  const made = (await run(sample, 'github.refresh', {})) as { ok: true; value: { login: string; sample: boolean } }
  assert.deepEqual([made.value.login, made.value.sample], ['sample-user', true])
})

test('a refresh answers with the slice, and there is no github.open: links open through system.open', async () => {
  const part = await partFor({ source: counting({ reviews: [1], pulls: [2] }) })
  const done = await run(part, 'github.refresh', {})
  assert.equal(done.ok && (done.value as { reviews: unknown[] }).reviews.length, 1)
  assert.deepEqual(Object.keys(part.handlers ?? {}).sort(), ['github.issue.add', 'github.issue.close', 'github.refresh'])
  assert.deepEqual(Object.keys(manifest.commands).sort(), Object.keys(part.handlers ?? {}).sort(), 'every command of the manifest has its handler')
  assert.ok(part.heard.changed > 0, 'each change is told to the host')
})

test('the state is GitHub with each issue carrying its hobkin work, and unknown before the first read', async () => {
  const part = await partFor({ source: counting({ issues: [12] }), work: { from: 'a snapshot' } })
  assert.deepEqual(part.state?.(), { ...GITHUB_UNKNOWN, sample: false })
  await run(part, 'github.refresh', {})
  const state = part.state?.() as { issues: GitHubIssue[]; connection: string }
  assert.equal(state.connection, 'connected')
  assert.equal(state.issues.length, 1)
})

test('it reads when started, and again every minute only while a window is connected, and not after close', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const source = counting()
  let looking = true
  const part = await partFor({ source, connected: () => looking })
  part.start?.()
  await settle()
  assert.equal(source.reads, 1, 'it reads once when the host is serving')
  t.mock.timers.tick(60_000)
  await settle()
  assert.equal(source.reads, 2)
  looking = false
  t.mock.timers.tick(60_000)
  await settle()
  assert.equal(source.reads, 2, 'with no window, GitHub is left alone')
  part.close?.()
  looking = true
  t.mock.timers.tick(180_000)
  await settle()
  assert.equal(source.reads, 2)
})

test('GitHub is read again after work.change and work.group end ok, and after nothing else', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const source = counting()
  const part = await partFor({ source })
  const ended = (name: string, ok: boolean) =>
    part.afterCommand?.({ name, args: {}, from: 'window', outcome: ok ? { ok: true, value: null } : { ok: false, error: { code: 'failed', message: 'no' } } })

  ended('work.change', false)
  ended('work.project', true)
  await settle()
  assert.equal(source.reads, 0, 'a failed change and other commands read nothing')

  ended('work.change', true)
  await settle()
  assert.equal(source.reads, 1, 'it reads at once')
  t.mock.timers.tick(10_000)
  await settle()
  assert.equal(source.reads, 2, 'and once more a little later')
  ended('work.group', true)
  await settle()
  assert.equal(source.reads, 3)
  part.close?.()
})

test('a merge takes the pull request out of the lists at once when it is named, and reads again when it is not', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const source = counting({ pulls: [3, 4] })
  const part = await partFor({ source })
  await run(part, 'github.refresh', {})
  const numbers = () => part.pulls?.()?.mine.map((p) => p.number)
  assert.deepEqual(numbers(), [3, 4])

  const merged: Merged = { url: 'https://github.com/octo/app/pull/4' }
  part.onMerged?.(merged)
  assert.deepEqual(numbers(), [3], 'gone before GitHub is asked again')
  await settle()
  assert.deepEqual(numbers(), [3], 'and it stays gone while GitHub still lists it')

  const before = source.reads
  part.onMerged?.({ repo: 'octo/app', number: 3 })
  assert.deepEqual(numbers(), [])
  part.onMerged?.({})
  await settle()
  assert.ok(source.reads > before, 'a merge with no address reads GitHub again')
  part.close?.()
})

test('pulls gives Change Review the own pull requests as mine, the review requests as waiting, and says when they are made up', async () => {
  const part = await partFor({ source: counting({ reviews: [7], pulls: [3, 4] }) })
  await run(part, 'github.refresh', {})
  const found = part.pulls?.()
  assert.deepEqual([found?.mine.map((p) => p.number), found?.waiting.map((p) => p.number), found?.sample], [[3, 4], [7], false])

  const sample = await partFor()
  assert.equal(sample.pulls?.()?.sample, true)
})
