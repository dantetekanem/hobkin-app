import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ApiCall, HostApi } from '../src/review/code-hosts.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { Reviews } from '../src/review/reviews.ts'
import { pullSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const target = { kind: 'pull' as const, host: 'corp', owner: 'acme', repo: 'shop', number: 7 }

/** A repository with a change on top of main, as a clone of the host would have it after the fetch. */
function repository(t: Parameters<typeof temporaryDirectory>[0]) {
  const repo = temporaryDirectory(t)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
  git('init', '--quiet', '--initial-branch=main')
  mkdirSync(join(repo, 'app'))
  writeFileSync(join(repo, 'app/cart.rb'), 'class Cart\n  def total = 1\nend\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Start')
  const base = git('rev-parse', 'HEAD')
  writeFileSync(join(repo, 'app/cart.rb'), 'class Cart\n  def total = 1.round\nend\n')
  git('commit', '--quiet', '-am', 'Round')
  return { repo, base, head: git('rev-parse', 'HEAD') }
}

test("a named host's pull request is read through its own API, fetched by its head branch, and placed by the user's address, with no call-graph scan where the host allows no checkout", async (t) => {
  const { repo, base, head } = repository(t)
  const calls: ApiCall[] = []
  const api: HostApi = async (call) => {
    calls.push(call)
    if (call.path === 'repos/acme/shop/pulls/7') return JSON.stringify({ state: 'open', title: 'Round the total', body: 'Rounds it.', base: { ref: 'main' }, head: { ref: 'round', sha: head }, user: { login: 'me@example.invalid' } })
    throw new Error(`nothing else is asked: ${call.path}`)
  }
  const fetched: unknown[] = []
  const scanned: unknown[] = []
  const source = pullSource({
    gh: async () => {
      throw new Error('gh is never asked for a named host')
    },
    apiOf: (pull) => (pull.host === 'corp' ? api : null),
    canCheckOut: (pull) => pull.host !== 'corp',
    checkout: { fetch: async (_pull, asked) => (fetched.push(asked), { repo, base }), repoFor: async () => repo, deleteBranch: async () => {} },
    vicinity: async (...args) => (scanned.push(args), { links: [] }),
    whoIsMe: async () => ({ viewer: null, emails: ['me@example.invalid'] }),
  })

  assert.equal(await source.head(target), head)
  const input = await source.read(target, head)
  assert.deepEqual(fetched, [{ head, baseBranch: 'main', headBranch: 'round' }])
  assert.deepEqual([input.change.project, input.change.title, input.description, input.owner], ['acme/shop', 'Round the total', 'Rounds it.', { author: 'me@example.invalid', mine: true }])
  assert.equal(input.capture.files.length, 1, 'the code is read from the clone')
  assert.deepEqual(scanned, [], 'no call-graph scan on a host that allows no checkout')
  assert.ok(calls.every((call) => (call.method ?? 'GET') === 'GET'), 'only reads')
})

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const files = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]

test("a review of a named host's pull request is posted through that host's API, as the user, and merging or closing it waits for that host's own way", async (t) => {
  const store = reviewStore(temporaryDirectory(t))
  store.write(target, sample, files, { preparedAt: '2026-11-19T12:00:00.000Z', storyBy: 'host', owner: { author: 'me@example.invalid', mine: true } })
  const calls: ApiCall[] = []
  const api: HostApi = async (call) => {
    calls.push(call)
    return JSON.stringify({ html_url: 'https://git.example.invalid/acme/shop/pull/7#review-1' })
  }
  const noGh = async () => {
    throw new Error('gh is never asked for a named host')
  }
  const reviews = new Reviews({
    store,
    sources: { change: pullSource({ gh: noGh }), pull: pullSource({ gh: noGh, apiOf: () => api }) },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    gh: noGh,
    apiOf: (pull) => (pull.host === 'corp' ? api : null),
    now: () => 1000,
  })
  t.after(() => reviews.close())
  const id = 'pr:corp:acme/shop/7'
  reviews.saveNotes(id, { entries: [{ op: 'put', note: { id: 'n1', step: sample.story[1]!.id, target: { kind: 'step' }, intent: 'comment', text: 'Rename it later.', author: 'user', at: 1 } }], draft: null })

  const preview = await reviews.preview(id, 'comment', '')
  assert.equal(preview.lines[0], 'Comment on acme/shop#7 on corp, as you, through its API command.')
  assert.deepEqual(calls, [], 'a preview sends nothing')
  assert.deepEqual(await reviews.verdict(id, 'comment', '', preview.confirm), { message: 'Posted to corp: https://git.example.invalid/acme/shop/pull/7#review-1' })
  assert.deepEqual(calls, [{ method: 'POST', path: 'repos/acme/shop/pulls/7/reviews', body: preview.post }])

  for (const verdict of ['approve-merge', 'discard', 'discard-branch'] as const) await assert.rejects(reviews.preview(id, verdict, ''), /on corp/, verdict)
  assert.equal(calls.length, 1)
})

test('a pull request on a host that allows no checkout gets its map, code, notes and verdict, and no AI review: it is told ready once its graph is drawn', async (t) => {
  const { repo, base, head } = repository(t)
  const api: HostApi = async () => JSON.stringify({ state: 'open', title: 'Round the total', body: '', base: { ref: 'main' }, head: { ref: 'round', sha: head }, user: { login: 'dev' } })
  const started: unknown[] = []
  const ready: unknown[] = []
  const source = pullSource({ gh: async () => ({ kind: 'missing' }), apiOf: () => api, canCheckOut: () => false, checkout: { fetch: async () => ({ repo, base }), repoFor: async () => repo, deleteBranch: async () => {} }, whoIsMe: async () => ({ viewer: null }) })
  const reviews = new Reviews({
    store: reviewStore(temporaryDirectory(t)),
    sources: { change: source, pull: source },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    assessments: { start: (request: unknown) => void started.push(request), status: () => ({ state: 'idle', head: null }), present: () => null, read: () => null, stop: () => false, busy: () => false, forget: () => {}, close: () => {} } as never,
    checksOut: (pull) => pull.kind !== 'pull' || pull.host !== 'corp',
    onReady: (told) => void ready.push(told),
  })
  t.after(() => reviews.close())
  const id = 'pr:corp:acme/shop/7'
  reviews.prepare(id, { asked: true })
  await reviews.settled(id)
  assert.equal(reviews.status(id).state, 'ready')
  assert.ok(reviews.get(id).review.nodes.length > 0, 'its map and code are there')
  assert.deepEqual(started, [], 'no change review starts')
  assert.equal(ready.length, 1, 'the user who asked hears that its review is ready')
})
