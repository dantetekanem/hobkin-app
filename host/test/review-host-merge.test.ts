import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import type { ReviewTarget } from '#shared/review/ids.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import type { ApiCall, HostApi } from '../src/review/code-hosts.ts'
import { Reviews } from '../src/review/reviews.ts'
import { pullSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const files = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]
const id = 'pr:corp:acme/shop/7'
const target = { kind: 'pull' as const, host: 'corp', owner: 'acme', repo: 'shop', number: 7 }
const MERGE_BY = { comment: '/merge', after: 'The merge queue lands it once its checks pass.' }
const NEWER = 'f'.repeat(40)
const noGh = async () => {
  throw new Error('gh is never asked for a named host')
}

/** A user's own pull request on a named host, as a stand-in host keeps it, and the reviews over it. */
function corp(t: TestContext, { author = 'me@example.invalid', draft = false, mergeable = true as boolean | null, mergeBy = MERGE_BY as typeof MERGE_BY | null, moveOnPost = null as string | null, bases = [] as number[], ways = true } = {}) {
  const store = reviewStore(temporaryDirectory(t))
  store.write(target, sample, files, { preparedAt: '2026-11-19T12:00:00.000Z', storyBy: 'host', owner: { author, mine: true } })
  const host = { state: 'open', head: sample.change.head }
  const calls: ApiCall[] = []
  const api: HostApi = async (call) => {
    calls.push(call)
    const { method = 'GET', path } = call
    if (path === 'repos/acme/shop/pulls/7' && method === 'GET') {
      return JSON.stringify({ state: host.state, draft, mergeable, head: { sha: host.head, ref: 'round', repo: { full_name: 'acme/shop' } }, base: { ref: 'main', repo: { full_name: 'acme/shop' } }, user: { login: author } })
    }
    if (path === 'repos/acme/shop/pulls/7' && method === 'PATCH') return (host.state = 'closed'), '{}'
    if (path === 'repos/acme/shop/pulls/7/reviews') {
      if (moveOnPost) host.head = moveOnPost
      return JSON.stringify({ html_url: 'https://git.example.invalid/acme/shop/pull/7#review-1' })
    }
    if (path === 'repos/acme/shop/issues/7/comments') return '{}'
    if (path === 'repos/acme/shop') return JSON.stringify({ default_branch: 'main' })
    if (path === 'repos/acme/shop/branches/round') return JSON.stringify({ protected: false })
    if (path.startsWith('repos/acme/shop/pulls?state=open&head=')) return JSON.stringify(host.state === 'open' ? [{ number: 7 }] : [])
    if (path.startsWith('repos/acme/shop/pulls?state=open&base=')) return JSON.stringify(bases.map((number) => ({ number })))
    throw new Error(`HTTP 404: ${method} ${path}`)
  }
  const deleted: [string, string][] = []
  const told: ReviewTarget[] = []
  const reviews = new Reviews({
    store,
    sources: { change: pullSource({ gh: noGh }), pull: pullSource({ gh: noGh, apiOf: () => api }) },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    gh: noGh,
    apiOf: () => api,
    hostWays: () => (ways ? { merge: true, mergeBy, emails: ['me@example.invalid'], deleteBranch: async (ref: string, sha: string) => void deleted.push([ref, sha]) } : null),
    onMerged: (merged) => void told.push(merged),
    now: () => 1000,
  })
  t.after(() => reviews.close())
  const writes = () => calls.filter((call) => (call.method ?? 'GET') !== 'GET').map((call) => [call.method, call.path, call.body])
  const comment = (text: string) => reviews.saveNotes(id, { entries: [{ op: 'put', note: { id: 'n1', step: sample.story[1]!.id, target: { kind: 'step' }, intent: 'comment', text, author: 'user', at: 1 } }], draft: null })
  return { reviews, store, host, writes, deleted, told, comment }
}

test("approve and merge on the user's own pull request on a named host posts their words as a comment, then the host's merge comment, and waits for the host", async (t) => {
  const { reviews, writes, told, comment, host } = corp(t)
  comment('Rename it later.')
  const preview = await reviews.preview(id, 'approve-merge', '')
  assert.deepEqual(preview.lines, [
    'On corp your own approval counts for nothing, so nothing is approved.',
    'Comment on acme/shop#7 on corp first, as you, through its API command, with no comments on lines.',
    'Then post "/merge" on it, which asks corp to merge it.',
    'The merge queue lands it once its checks pass.',
    `It asks at commit ${sample.change.head.slice(0, 7)}: if acme/shop#7 moves before then, nothing more is posted.`,
  ])
  assert.equal(preview.post?.event, 'COMMENT')
  assert.deepEqual(writes(), [], 'a preview sends nothing')

  const done = await reviews.verdict(id, 'approve-merge', '', preview.confirm)
  assert.equal(done.message, 'Asked corp to merge acme/shop#7, after your comment. The merge queue lands it once its checks pass. https://git.example.invalid/acme/shop/pull/7#review-1')
  assert.deepEqual(writes(), [['POST', 'repos/acme/shop/pulls/7/reviews', preview.post], ['POST', 'repos/acme/shop/issues/7/comments', { body: '/merge' }]])
  assert.deepEqual(told, [], 'nothing merged yet, so the GitHub screen is told nothing')
  const row = reviews.list().reviews.find((item) => item.id === id)
  assert.deepEqual([row?.mergeAsked?.state, row?.mergeAsked?.message], ['waiting', 'The merge queue lands it once its checks pass.'])

  // The same yes again posts nothing more: its comment went, so what it would send is no longer what was shown.
  await assert.rejects(reviews.verdict(id, 'approve-merge', '', preview.confirm), /changed since it was shown/)
  assert.equal(writes().length, 2)
  // Once the host has merged it, the sweep takes it off the list.
  host.state = 'closed'
  await reviews.sweepPulls({ force: true })
  assert.equal(reviews.list().reviews.some((item) => item.id === id), false)
})

test("on a pull request an agent opened because the user asked, approve and merge approves it first; a head that moves while the review posts stops before the merge comment", async (t) => {
  const agent = corp(t, { author: 'helper-bot' })
  const preview = await agent.reviews.preview(id, 'approve-merge', '')
  assert.equal(preview.lines[0], 'Approve acme/shop#7 on corp, as you, through its API command, with no comments on lines.')
  await agent.reviews.verdict(id, 'approve-merge', '', preview.confirm)
  // An approval with no words is the same yes again: it is one approval and one merge comment.
  await agent.reviews.verdict(id, 'approve-merge', '', preview.confirm)
  assert.deepEqual(agent.writes().map(([method, path]) => [method, path]), [['POST', 'repos/acme/shop/pulls/7/reviews'], ['POST', 'repos/acme/shop/issues/7/comments']])
  assert.equal((agent.writes()[0]![2] as { event: string }).event, 'APPROVE')

  const moving = corp(t, { moveOnPost: NEWER })
  moving.comment('Rename it later.')
  const shown = await moving.reviews.preview(id, 'approve-merge', '')
  await assert.rejects(moving.reviews.verdict(id, 'approve-merge', '', shown.confirm), /^Error: Your comment went on corp, but acme\/shop#7 moved to fffffff before its merge was asked, so the merge comment was not posted\.$/)
  assert.deepEqual(moving.writes().map(([, path]) => path), ['repos/acme/shop/pulls/7/reviews'])
})

test('a draft, a conflict, a closed pull request and a host with no merge entry are refused before anything is sent; approve alone is refused on the user’s own there', async (t) => {
  for (const [options, why] of [[{ draft: true }, /draft/], [{ mergeable: false }, /conflicts/], [{ mergeBy: null }, /no merge entry/]] as const) {
    const seat = corp(t, options)
    await assert.rejects(seat.reviews.preview(id, 'approve-merge', ''), why)
    assert.deepEqual(seat.writes(), [])
  }
  const closed = corp(t)
  closed.host.state = 'closed'
  await assert.rejects(closed.reviews.preview(id, 'approve-merge', ''), /not open on corp/)
  await assert.rejects(corp(t).reviews.preview(id, 'approve', 'Looks right.'), /your own approval counts for nothing/)
})

test("discarding the user's own pull request on a named host closes it through the host with their words first, and deleting its branch goes through git at the commit shown", async (t) => {
  const { reviews, writes, told, deleted } = corp(t)
  const preview = await reviews.preview(id, 'discard', 'Superseded.')
  assert.deepEqual(preview.lines, ['Close acme/shop#7 on corp without merging it, as you, through its API command.', 'Your words go on it as a comment first.', 'Its branch stays.'])
  assert.deepEqual(await reviews.verdict(id, 'discard', 'Superseded.', preview.confirm), { message: 'Closed acme/shop#7 on corp without merging it.' })
  assert.deepEqual(writes(), [['POST', 'repos/acme/shop/issues/7/comments', { body: 'Superseded.' }], ['PATCH', 'repos/acme/shop/pulls/7', { state: 'closed' }]])
  assert.deepEqual(told, [target], 'what closed elsewhere is told by its own target, so the GitHub screen reads it by its page')

  const branch = corp(t)
  const shown = await branch.reviews.preview(id, 'discard-branch', '')
  assert.ok(shown.lines.some((line) => line === `Then delete its branch round on corp, with git, as you, only if it is still at ${sample.change.head.slice(0, 7)}: a commit pushed since keeps it.`), shown.lines.join('\n'))
  await branch.reviews.verdict(id, 'discard-branch', '', shown.confirm)
  assert.deepEqual(branch.deleted, [['round', sample.change.head]])
  assert.equal(deleted.length, 0)

  await assert.rejects(corp(t, { bases: [9] }).reviews.preview(id, 'discard-branch', ''), /acme\/shop#9, an open pull request, merges/)
  await assert.rejects(corp(t, { ways: false }).reviews.preview(id, 'discard-branch', ''), /no way to delete/)
})
