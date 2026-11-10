import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import { reviewIdOf, targetOfReviewId } from '#shared/review/ids.ts'
import type { Note } from '#shared/review/notes.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import type { GhOutcome } from '../src/github-gh.ts'
import { Reviews, type ChangeCard } from '../src/review/reviews.ts'
import { changeSource, pullSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const files = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]
const step = sample.story.find((entry) => entry.title === 'The runtime keeps the word for one turn')!
const sendNode = sample.nodes.find((node) => node.title === 'send')!.id

/** Reviews over a review already in the home, with a fake hobkin and a fake gh that only write down what they were asked. */
function seated(t: TestContext, id: string, { card = { landing: 'merge', yes: 'Merge hobkin/7d02c9 into main on this machine. Nothing is pushed.' } as ChangeCard | null } = {}) {
  const home = temporaryDirectory(t)
  const store = reviewStore(home)
  const target = targetOfReviewId(id)!
  store.write(target, sample, files)
  const actions: unknown[][] = []
  const posts: { args: readonly string[]; input?: string }[] = []
  let refuse: string | null = null
  const reviews = new Reviews({
    store,
    sources: { change: changeSource({ find: () => null, repoOf: () => null, baseOf: async () => 'main' }), pull: pullSource({ gh: async () => ({ kind: 'missing' }) }) },
    agent: async () => null,
    work: () => ({
      workAction: async (...args: unknown[]) => {
        actions.push(args)
        if (refuse) throw new Error(refuse)
        return { message: `hobkin did ${String(args[0])}.` }
      },
    }),
    card: () => card,
    gh: async (args, input): Promise<GhOutcome> => {
      posts.push({ args, input })
      return { kind: 'done', stdout: JSON.stringify({ html_url: 'https://github.com/acme/shop/pull/482#pullrequestreview-1' }) }
    },
    now: () => 1000,
  })
  const notes = (entries: Note[]) => reviews.saveNotes(id, { entries: entries.map((note) => ({ op: 'put', note })), draft: null })
  return { reviews, store, target, actions, posts, notes, refuse: (reason: string | null) => (refuse = reason) }
}

const note = (id: string, rest: Partial<Note>): Note => ({ id, step: step.id, target: { kind: 'step' }, intent: 'comment', text: 'x', author: 'user', at: 1, ...rest })

test("merge calls the card's action and passes its refusal through", async (t) => {
  const id = reviewIdOf({ kind: 'change', slug: 'hobkin', item: '7d02c9' })
  const { reviews, actions, refuse } = seated(t, id)

  const preview = reviews.preview(id, 'approve', '')
  assert.deepEqual(preview.lines[0], 'Merge hobkin/7d02c9 into main on this machine. Nothing is pushed.')
  assert.deepEqual(actions, [], 'a preview does nothing')

  // The yes lands it the way its card would, pinned to the commit the review was built from.
  assert.deepEqual(await reviews.verdict(id, 'approve', '', preview.confirm), { message: 'hobkin did merge.' })
  assert.deepEqual(actions, [['merge', 'hobkin', '7d02c9', { head: sample.change.head }]])

  // hobkin's own refusal, such as a branch that moved, comes back as it is.
  refuse('The branch moved since the card was shown.')
  await assert.rejects(reviews.verdict(id, 'approve', '', preview.confirm), /The branch moved since the card was shown\./)
  // A verdict that was not shown first does not go.
  await assert.rejects(reviews.verdict(id, 'approve', '', 'not-the-token'), /has changed since it was shown/)
  // A finished change has nobody to comment to.
  assert.throws(() => reviews.preview(id, 'comment', ''), /nobody to comment to/)
})

test('a pull request gets one GitHub review through gh, exactly as it was shown, and only after the yes', async (t) => {
  const id = 'pr:acme/shop/482'
  const { reviews, posts, notes, store, target } = seated(t, id)
  notes([
    note('n1', { target: { kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 176, endLine: 178, hash: 'stale' }, text: 'Read as one.' }),
    note('n2', { target: { kind: 'node', node: sendNode }, text: 'Name it after what it holds.' }),
    note('n3', { intent: 'question', text: 'For hobkin only.' }),
  ])

  const preview = reviews.preview(id, 'request-changes', 'Two things.')
  assert.equal(posts.length, 0, 'nothing is posted to show what would be')
  assert.equal(preview.post?.event, 'REQUEST_CHANGES')
  assert.equal(preview.post?.commit_id, sample.change.head)
  // n1's lines no longer hold what it was written on, so it goes in the body instead of on the wrong lines.
  assert.deepEqual(preview.post?.comments, [])
  assert.match(preview.post!.body, /Two things\.\n\n- About src\/cli\/runtime\.mjs, lines 176 to 178, as changed: Read as one\.\n- About send/)
  assert.equal(preview.post!.body.includes('For hobkin only'), false)

  const done = await reviews.verdict(id, 'request-changes', 'Two things.', preview.confirm)
  assert.equal(done.message, 'Posted to GitHub: https://github.com/acme/shop/pull/482#pullrequestreview-1')
  assert.equal(posts.length, 1)
  assert.deepEqual(posts[0]!.args, ['api', '--hostname', 'github.com', '--method', 'POST', 'repos/acme/shop/pulls/482/reviews', '--input', '-'])
  assert.deepEqual(JSON.parse(posts[0]!.input!), preview.post)

  // The comments went with it, so they are marked sent and are not posted again. The question stays for hobkin.
  const after = store.notes(target).entries.map((entry) => (entry.op === 'put' ? [entry.note.id, entry.note.sent ?? null] : null))
  assert.deepEqual(after, [['n1', 1000], ['n2', 1000], ['n3', null]])
  assert.match(reviews.preview(id, 'comment', '').post!.body, /^Commented\.$/)
})
