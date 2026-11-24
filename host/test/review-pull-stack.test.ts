import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import type { GhOutcome } from '../src/review/gh.ts'
import { Reviews } from '../src/review/reviews.ts'
import { pullSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const files = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]

const STACKED = 'gh: Merging stacked PRs via this endpoint is not supported. Use the asynchronous merge endpoint instead. (HTTP 403)'
const query = (key: string, branch: string) => `repos/acme/shop/pulls?state=open&${key}=${encodeURIComponent(key === 'head' ? `acme:${branch}` : branch)}`

interface Layer {
  number: number
  head: string
  base: string
}

/**
 * The user's own pull request 482 in a repository whose other open pull requests are `others`, with a gh that answers as
 * GitHub would and writes down every call. `legacy` is what the old merge endpoint answers; `results` are what the
 * asynchronous merge says each time it is asked, the last one for good.
 */
function seat(t: TestContext, { viewer = 'dev', base = 'main', others = [] as Layer[], legacy = null as string | null, results = [] as unknown[] } = {}) {
  const id = 'pr:acme/shop/482'
  const store = reviewStore(temporaryDirectory(t))
  store.write(targetOfReviewId(id)!, sample, files, { preparedAt: '2026-11-12T15:00:00.000Z', storyBy: 'host', owner: { author: 'dev', mine: true } })
  const calls: { args: readonly string[]; input?: string }[] = []
  const asked: number[] = []
  const all = [...others, { number: 482, head: 'top', base }]
  const gh = async (args: readonly string[], input?: string): Promise<GhOutcome> => {
    calls.push({ args, input })
    const path = args.find((arg) => arg === 'user' || arg.startsWith('repos/'))!
    const done = (body: unknown): GhOutcome => ({ kind: 'done', stdout: JSON.stringify(body) })
    const list = (key: 'head' | 'base', branch: string) => done(all.filter((pull) => pull[key] === branch).map(({ number, head, base }) => ({ number, head: { ref: head, repo: { full_name: 'acme/shop' } }, base: { ref: base } })))
    if (path === 'user') return done({ login: viewer })
    if (path === 'repos/acme/shop') return done({ default_branch: 'main', allow_squash_merge: true })
    if (path === 'repos/acme/shop/pulls/482') return done({ state: 'open', user: { login: 'dev' }, base: { ref: base }, head: { sha: sample.change.head, ref: 'top' } })
    for (const key of ['head', 'base'] as const) for (const pull of all) if (path === query(key, key === 'head' ? pull.head : pull.base)) return list(key, key === 'head' ? pull.head : pull.base)
    if (path.startsWith('repos/acme/shop/pulls?state=open')) return done([])
    if (path === 'repos/acme/shop/pulls/482/merge') return legacy ? { kind: 'failed', code: 1, stdout: '', stderr: legacy } : done({ merged: true })
    if (path === 'repos/acme/shop/pulls/482/merge-async') return { kind: 'done', stdout: JSON.stringify({ status: 'pending', details: { uuid: 'u1' } }) }
    if (path === 'repos/acme/shop/pulls/482/merge-async/u1') {
      asked.push(1)
      const answer = results[Math.min(asked.length, results.length) - 1]
      return typeof answer === 'string' ? { kind: 'failed', code: 1, stdout: '', stderr: answer } : done(answer)
    }
    return { kind: 'failed', code: 1, stdout: '', stderr: `HTTP 404: ${args.join(' ')}` }
  }
  const reviews = new Reviews({ store, sources: { change: { head: async () => null, read: async () => Promise.reject(new Error('unused')) }, pull: pullSource({ gh }) }, work: () => ({ workAction: async () => ({}) }), card: () => null, gh, mergePollMs: 0, now: () => 1000 })
  /** What was sent: every call that was not a read. */
  const sent = () => calls.filter((call) => call.args.includes('--method'))
  return { id, reviews, sent, asked, store, target: targetOfReviewId(id)! }
}

const below: Layer[] = [
  { number: 480, head: 's1', base: 'main' },
  { number: 481, head: 's2', base: 's1' },
]

test('a layer over open pull requests does not merge before them: the preview and the yes both name them in order, and nothing is sent', async (t) => {
  const { id, reviews, sent } = seat(t, { base: 's2', others: below })
  const said = /#482 is layer 3 of 3: merge #480 and #481 first/
  await assert.rejects(reviews.preview(id, 'approve-merge', ''), said)
  await assert.rejects(reviews.verdict(id, 'approve-merge', '', 'any'), said)
  assert.deepEqual(sent(), [])
})

test('a mid layer is refused too, and the count includes the layers over it', async (t) => {
  const { id, reviews } = seat(t, { base: 's1', others: [below[0]!, { number: 483, head: 's3', base: 'top' }] })
  await assert.rejects(reviews.preview(id, 'approve-merge', ''), /#482 is layer 2 of 3: merge #480 first/)
})

test('approve alone still works on any layer, and a pull request on a branch no open pull request owns merges as before', async (t) => {
  const top = seat(t, { viewer: 'me', base: 's2', others: below })
  const approved = await top.reviews.preview(top.id, 'approve', 'Fine.')
  assert.equal(approved.post?.event, 'APPROVE')
  const plain = seat(t, { base: 'develop' })
  const preview = await plain.reviews.preview(plain.id, 'approve-merge', '')
  await plain.reviews.verdict(plain.id, 'approve-merge', '', preview.confirm)
  assert.equal(plain.sent().at(-1)!.args.includes('repos/acme/shop/pulls/482/merge'), true)
})

test('the bottom of a stack GitHub refuses on the old endpoint merges through the asynchronous one at the shown commit, and is followed until it merged', async (t) => {
  const pending = { status: 'pending', details: { uuid: 'u1' } }
  const { id, reviews, sent, asked } = seat(t, { others: [{ number: 481, head: 's2', base: 'top' }], legacy: STACKED, results: [pending, pending, { status: 'merged', details: { sha: 'e'.repeat(40) } }] })
  const preview = await reviews.preview(id, 'approve-merge', '')
  const said = await reviews.verdict(id, 'approve-merge', '', preview.confirm)
  assert.match(said.message, /^Merged acme\/shop#482 into main\./)
  const [old, async] = sent()
  assert.equal(old!.args.includes('repos/acme/shop/pulls/482/merge'), true)
  assert.equal(async!.args.includes('repos/acme/shop/pulls/482/merge-async'), true)
  assert.deepEqual(JSON.parse(async!.input!), { sha: sample.change.head, merge_method: 'squash' })
  assert.equal(asked.length, 3, 'asked again while it was pending')
})

test('an asynchronous merge GitHub refuses says why, and one put in a merge queue says it waits', async (t) => {
  const failed = seat(t, { legacy: STACKED, results: [{ status: 'failed', details: { message: 'Required status check is failing.' } }] })
  const preview = await failed.reviews.preview(failed.id, 'approve-merge', '')
  await assert.rejects(failed.reviews.verdict(failed.id, 'approve-merge', '', preview.confirm), /Required status check is failing/)

  const queued = seat(t, { legacy: STACKED, results: [{ status: 'enqueued', details: { message: 'Added to the merge queue.' } }] })
  const second = await queued.reviews.preview(queued.id, 'approve-merge', '')
  const said = await queued.reviews.verdict(queued.id, 'approve-merge', '', second.confirm)
  assert.match(said.message, /merge queue/)
  assert.equal(queued.store.mergeAsked(queued.target)?.state, 'waiting', 'kept in the list as a merge that waits')
})
