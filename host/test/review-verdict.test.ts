import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import { reviewIdOf, targetOfReviewId } from '#shared/review/ids.ts'
import type { Note } from '#shared/review/notes.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import type { GhOutcome } from '../src/github-gh.ts'
import type { Moved } from '../src/review/landing.ts'
import { GRAPH_RULES, Reviews, type ChangeCard, type Publisher } from '../src/review/reviews.ts'
import { pullSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const files = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]
const step = sample.story.find((entry) => entry.title === 'The runtime keeps the word for one turn')!
const sendNode = sample.nodes.find((node) => node.title === 'send')!.id
const NEWER = 'f'.repeat(40)

/** Reviews over a review already in the home, with a fake hobkin and a fake gh that only write down what they were asked. */
function seated(t: TestContext, id: string, { card = { landing: 'merge', yes: 'Merge hobkin/7d02c9 into main on this machine. Nothing is pushed.', branch: 'hobkin/7d02c9-say-what-hobkin-is-doing', pr: null } as ChangeCard | null, publish }: { card?: ChangeCard | null; publish?: Publisher } = {}) {
  const home = temporaryDirectory(t)
  const store = reviewStore(home)
  const target = targetOfReviewId(id)!
  store.write(target, sample, files)
  const actions: unknown[][] = []
  const posts: { args: readonly string[]; input?: string }[] = []
  let refuse: string | null = null
  // The change is at the review's commit until a test moves it on.
  let at = sample.change.head
  const reviews = new Reviews({
    store,
    sources: { change: { head: async () => at, read: async () => Promise.reject(new Error('Nothing is read again here.')) }, pull: pullSource({ gh: async () => ({ kind: 'missing' }) }) },
    work: () => ({
      workAction: async (...args: unknown[]) => {
        actions.push(args)
        if (refuse) throw new Error(refuse)
        return { message: `hobkin did ${String(args[0])}.` }
      },
    }),
    card: () => card,
    ...(publish ? { publish } : {}),
    gh: async (args, input): Promise<GhOutcome> => {
      posts.push({ args, input })
      return { kind: 'done', stdout: JSON.stringify({ html_url: 'https://github.com/acme/shop/pull/482#pullrequestreview-1' }) }
    },
    now: () => 1000,
  })
  const notes = (entries: Note[]) => reviews.saveNotes(id, { entries: entries.map((note) => ({ op: 'put', note })), draft: null })
  /** The change moves on to a newer commit, and its review is prepared again for it, as the background does. */
  const moveOn = async () => {
    store.write(target, { ...sample, change: { ...sample.change, head: NEWER } }, files, { preparedAt: '2026-11-12T16:00:00.000Z', storyBy: 'host', graph: GRAPH_RULES })
    at = NEWER
    reviews.prepare(id)
    await reviews.settled(id)
  }
  return { reviews, store, target, actions, posts, notes, moveOn, refuse: (reason: string | null) => (refuse = reason) }
}

const note = (id: string, rest: Partial<Note>): Note => ({ id, step: step.id, target: { kind: 'step' }, intent: 'comment', text: 'x', author: 'user', at: 1, ...rest })

test("approve and merge calls the card's action and passes its refusal through", async (t) => {
  const id = reviewIdOf({ kind: 'change', slug: 'hobkin', item: '7d02c9' })
  const { reviews, actions, refuse } = seated(t, id)

  const preview = await reviews.preview(id, 'approve-merge', '')
  assert.deepEqual(preview.lines[0], 'Merge hobkin/7d02c9 into main on this machine. Nothing is pushed.')
  assert.deepEqual(actions, [], 'a preview does nothing')

  // The yes lands it the way its card would, pinned to the commit the review was built from.
  assert.deepEqual(await reviews.verdict(id, 'approve-merge', '', preview.confirm), { message: 'hobkin did merge.' })
  assert.deepEqual(actions, [['merge', 'hobkin', '7d02c9', { head: sample.change.head }]])

  const asked = () => reviews.list().reviews.find((item) => item.id === id)?.mergeAsked
  assert.equal(asked(), undefined, 'a merge that went through leaves nothing to track')

  // hobkin's own refusal, such as a branch that moved, comes back as it is.
  refuse('The branch moved since the card was shown.')
  await assert.rejects(reviews.verdict(id, 'approve-merge', '', preview.confirm), /The branch moved since the card was shown\./)
  // The user said merge and it did not merge: the list keeps that, with why, and so does the review's own status.
  assert.deepEqual(asked(), { at: new Date(1000).toISOString(), state: 'failed', why: 'The branch moved since the card was shown.' })
  assert.equal(reviews.status(id).mergeAsked?.state, 'failed')
  // A yes that goes through after that clears it.
  refuse(null)
  await reviews.verdict(id, 'approve-merge', '', preview.confirm)
  assert.equal(asked(), undefined)
  // A verdict that was not shown first does not go, and is no merge the user asked for.
  await assert.rejects(reviews.verdict(id, 'approve-merge', '', 'not-the-token'), /has changed since it was shown/)
  assert.equal(asked(), undefined)
  // A finished change has nobody to comment to.
  await assert.rejects(reviews.preview(id, 'comment', ''), /nobody to comment to/)
})

test('approving a finished change opens its pull request at the reviewed commit, and only after the yes', async (t) => {
  const id = reviewIdOf({ kind: 'change', slug: 'hobkin', item: '7d02c9' })
  const opened: unknown[] = []
  const publish: Publisher = {
    plan: async (slug, branch) => ({ repo: 'acme/shop', base: 'main', branch, slug }),
    open: async (plan, pull) => {
      opened.push({ plan, pull })
      return { url: 'https://github.com/acme/shop/pull/9' }
    },
  }
  const { reviews, actions } = seated(t, id, { publish })

  const preview = await reviews.preview(id, 'approve', '')
  // The title and description it opens with are shown, as they go into the token.
  assert.deepEqual(preview.lines, [
    `Push hobkin/7d02c9-say-what-hobkin-is-doing at ${sample.change.head.slice(0, 7)} to acme/shop on GitHub, as you.`,
    `Open a pull request from it into main, titled "${sample.change.title}".`,
    `Its description: ${sample.summary}`,
    'Nothing is merged.',
  ])
  assert.deepEqual(opened, [], 'a preview opens nothing')

  assert.deepEqual(await reviews.verdict(id, 'approve', '', preview.confirm), { message: 'Opened https://github.com/acme/shop/pull/9' })
  assert.deepEqual(opened, [{ plan: { repo: 'acme/shop', base: 'main', branch: 'hobkin/7d02c9-say-what-hobkin-is-doing', slug: 'hobkin' }, pull: { head: sample.change.head, title: sample.change.title, body: sample.summary } }])
  assert.deepEqual(actions, [])

  // A change whose pull request is open already has nothing to open: it can be merged, or sent back.
  const open = seated(t, id, { publish, card: { landing: 'mergePr', yes: 'Merge its PR.', branch: 'hobkin/7d02c9-say-what-hobkin-is-doing', pr: 'https://github.com/acme/shop/pull/8' } })
  await assert.rejects(open.reviews.preview(id, 'approve', ''), /already open: https:\/\/github\.com\/acme\/shop\/pull\/8/)
  // A host that cannot publish says so.
  await assert.rejects(seated(t, id).reviews.preview(id, 'approve', ''), /cannot open pull requests/)
})

test('a yes goes only for the review on the screen: one prepared again for a newer commit since is refused', async (t) => {
  const id = reviewIdOf({ kind: 'change', slug: 'hobkin', item: '7d02c9' })
  const { reviews, actions, moveOn } = seated(t, id)
  const shown = sample.change.head
  const merge = await reviews.preview(id, 'approve-merge', '', shown)
  const ask = await reviews.preview(id, 'request-changes', 'Say why.', shown)

  await moveOn()
  assert.equal(reviews.get(id).review.change.head, NEWER)
  const moved = /: This review is for commit 7d02c99; the change has moved to fffffff\. Rebuild the review and look again\.$/
  await assert.rejects(reviews.preview(id, 'approve-merge', '', shown), moved)
  await assert.rejects(reviews.verdict(id, 'approve-merge', '', merge.confirm, shown), moved)
  // Without the screen's commit, the token still holds the commit it was shown for, whatever the verdict.
  await assert.rejects(reviews.verdict(id, 'approve-merge', '', merge.confirm), /has changed since it was shown/)
  await assert.rejects(reviews.verdict(id, 'request-changes', 'Say why.', ask.confirm), /has changed since it was shown/)
  assert.deepEqual(actions, [], 'the newer commit is never landed on a yes given to the older one')

  // Looked at again, the newer review lands its own commit.
  const again = await reviews.preview(id, 'approve-merge', '', NEWER)
  await reviews.verdict(id, 'approve-merge', '', again.confirm, NEWER)
  assert.deepEqual(actions, [['merge', 'hobkin', '7d02c9', { head: NEWER }]])
})

test('a review prepared again while a yes is under way never changes what the yes does', async (t) => {
  const id = reviewIdOf({ kind: 'change', slug: 'hobkin', item: '7d02c9' })
  const opened: string[] = []
  let plans = 0
  let seat: ReturnType<typeof seated> | null = null
  const publish: Publisher = {
    plan: async (slug, branch) => {
      // The yes's own look at where the pull request goes: meanwhile the change moves on and is prepared again.
      if ((plans += 1) === 2) await seat!.moveOn()
      return { repo: 'acme/shop', base: 'main', branch, slug }
    },
    open: async (_plan, pull) => {
      opened.push(pull.head)
      return { url: 'https://github.com/acme/shop/pull/9' }
    },
  }
  seat = seated(t, id, { publish })
  const preview = await seat.reviews.preview(id, 'approve', '', sample.change.head)
  await seat.reviews.verdict(id, 'approve', '', preview.confirm, sample.change.head)
  assert.deepEqual(opened, [sample.change.head], 'the pull request opens at the commit that was shown')
})

test('a pull request gets one GitHub review through gh, exactly as it was shown, and only after the yes', async (t) => {
  const id = 'pr:acme/shop/482'
  const { reviews, posts, notes, store, target } = seated(t, id)
  notes([
    note('n1', { target: { kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 176, endLine: 178, hash: 'stale' }, text: 'Read as one.' }),
    note('n2', { target: { kind: 'node', node: sendNode }, text: 'Name it after what it holds.' }),
    note('n3', { intent: 'question', text: 'For hobkin only.' }),
  ])

  const preview = await reviews.preview(id, 'request-changes', 'Two things.')
  assert.equal(posts.length, 0, 'nothing is posted to show what would be')
  assert.equal(preview.post?.event, 'REQUEST_CHANGES')
  assert.equal(preview.post?.commit_id, sample.change.head)
  // n1's lines no longer hold what it was written on, so it goes in the body instead of on the wrong lines.
  assert.deepEqual(preview.post?.comments, [])
  assert.match(preview.post!.body, /^\*\*hobkin automated review\*\*\n\nTwo things\.\n\n<details>\n<summary>See more<\/summary>\n\n- About src\/cli\/runtime\.mjs, lines 176 to 178, as changed: Read as one\.\n- About send/)
  assert.equal(preview.post!.body.includes('For hobkin only'), false)

  const done = await reviews.verdict(id, 'request-changes', 'Two things.', preview.confirm)
  assert.equal(done.message, 'Posted to GitHub: https://github.com/acme/shop/pull/482#pullrequestreview-1')
  assert.equal(posts.length, 1)
  assert.deepEqual(posts[0]!.args, ['api', '--hostname', 'github.com', '--method', 'POST', 'repos/acme/shop/pulls/482/reviews', '--input', '-'])
  assert.deepEqual(JSON.parse(posts[0]!.input!), preview.post)

  // The comments went with it, so they are marked sent and are not posted again. The question stays for hobkin.
  const after = store.notes(target).entries.map((entry) => (entry.op === 'put' ? [entry.note.id, entry.note.sent ?? null] : null))
  assert.deepEqual(after, [['n1', 1000], ['n2', 1000], ['n3', null]])
  assert.equal((await reviews.preview(id, 'comment', '')).post!.body, '**hobkin automated review**\n\nCommented.')
})

/** A pull request's review in the home, with a gh that answers as GitHub would and writes down every call. */
function pullSeat(
  t: TestContext,
  {
    viewer = 'me',
    author = 'dev',
    settings = { allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true } as Record<string, boolean>,
    refuseMerge = null as string | null,
    current = sample.change.head,
    moved = undefined as Moved | undefined,
  } = {},
) {
  const id = 'pr:acme/shop/482'
  const store = reviewStore(temporaryDirectory(t))
  store.write(targetOfReviewId(id)!, sample, files)
  const calls: { args: readonly string[]; input?: string }[] = []
  const github = { settings }
  const gh = async (args: readonly string[], input?: string): Promise<GhOutcome> => {
    calls.push({ args, input })
    const path = args.find((arg) => arg === 'user' || arg.startsWith('repos/'))
    if (path === 'user') return { kind: 'done', stdout: JSON.stringify({ login: viewer }) }
    if (path === 'repos/acme/shop') return { kind: 'done', stdout: JSON.stringify(github.settings) }
    if (path === 'repos/acme/shop/pulls/482') return { kind: 'done', stdout: JSON.stringify({ user: { login: author }, base: { ref: 'main' }, head: { sha: current } }) }
    if (path === 'repos/acme/shop/pulls/482/reviews') return { kind: 'done', stdout: JSON.stringify({ html_url: 'https://github.com/acme/shop/pull/482#pullrequestreview-1' }) }
    if (path === 'repos/acme/shop/pulls/482/merge') {
      return refuseMerge ? { kind: 'failed', code: 1, stdout: '', stderr: refuseMerge } : { kind: 'done', stdout: JSON.stringify({ merged: true, sha: 'e'.repeat(40) }) }
    }
    return { kind: 'failed', code: 1, stdout: '', stderr: `HTTP 404: ${args.join(' ')}` }
  }
  /** Each time the host heard that something merged. */
  const merges: number[] = []
  const reviews = new Reviews({
    store,
    sources: { change: { head: async () => null, read: async () => Promise.reject(new Error('unused')) }, pull: pullSource({ gh }) },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    gh,
    // What moved since the review, as a checkout of the pull request would say it.
    ...(moved ? { pullMoved: async () => moved } : {}),
    onMerged: () => merges.push(calls.length),
    now: () => 1000,
  })
  /** What was sent: every call that was not a read. */
  const sent = () => calls.filter((call) => call.args.includes('--method'))
  return { id, reviews, store, calls, sent, merges, github, target: targetOfReviewId(id)! }
}

const PINNED = `At commit ${sample.change.head.slice(0, 7)}, the one this review was built from. GitHub refuses if the pull request has moved since.`

test('once a pull request has merged, the host is told, so what GitHub lists is read again at once and the merged one leaves', async (t) => {
  const { id, reviews, merges } = pullSeat(t)
  const approved = await reviews.preview(id, 'approve', 'Looks right.')
  await reviews.verdict(id, 'approve', 'Looks right.', approved.confirm)
  assert.deepEqual(merges, [], 'an approval alone merges nothing')
  const preview = await reviews.preview(id, 'approve-merge', '')
  await reviews.verdict(id, 'approve-merge', '', preview.confirm)
  assert.equal(merges.length, 1)
})

test("approve and merge on someone else's pull request approves it, then merges the reviewed commit the way its repository allows", async (t) => {
  const { id, reviews, sent } = pullSeat(t)
  const preview = await reviews.preview(id, 'approve-merge', 'Ship it.')
  assert.deepEqual(preview.lines, ['Approve acme/shop#482 on GitHub, as you, through gh, with no comments on lines.', 'Then merge it into main by squashing its commits into one.', PINNED])
  assert.equal(preview.post?.event, 'APPROVE')
  assert.deepEqual(sent(), [], 'a preview only reads GitHub')

  assert.deepEqual(await reviews.verdict(id, 'approve-merge', 'Ship it.', preview.confirm), { message: 'Merged acme/shop#482 into main, after approving it. https://github.com/acme/shop/pull/482#pullrequestreview-1' })
  const [approve, merge] = sent()
  assert.deepEqual(approve!.args, ['api', '--hostname', 'github.com', '--method', 'POST', 'repos/acme/shop/pulls/482/reviews', '--input', '-'])
  assert.deepEqual(JSON.parse(approve!.input!), preview.post)
  // `sha` is the reviewed commit, so GitHub refuses the merge if the pull request moved since.
  assert.deepEqual(merge!.args, ['api', '--hostname', 'github.com', '--method', 'PUT', 'repos/acme/shop/pulls/482/merge', '--input', '-'])
  assert.deepEqual(JSON.parse(merge!.input!), { sha: sample.change.head, merge_method: 'squash' })
})

test('the merge method is the repository’s: squash when it allows it, else a merge commit, else rebase', async (t) => {
  const merged = async (settings: Record<string, boolean>) => {
    const seat = pullSeat(t, { settings })
    const preview = await seat.reviews.preview(seat.id, 'approve-merge', '')
    await seat.reviews.verdict(seat.id, 'approve-merge', '', preview.confirm)
    return [preview.lines[1], JSON.parse(seat.sent().at(-1)!.input!).merge_method]
  }
  assert.deepEqual(await merged({ allow_squash_merge: false, allow_merge_commit: true, allow_rebase_merge: true }), ['Then merge it into main with a merge commit.', 'merge'])
  assert.deepEqual(await merged({ allow_squash_merge: false, allow_merge_commit: false, allow_rebase_merge: true }), ['Then merge it into main by rebasing its commits onto it.', 'rebase'])
  const none = pullSeat(t, { settings: { allow_squash_merge: false, allow_merge_commit: false, allow_rebase_merge: false } })
  await assert.rejects(none.reviews.preview(none.id, 'approve-merge', ''), /allows no way to merge a pull request/)

  // The repository changing its settings after the preview changes what would be done, so the yes no longer goes.
  const seat = pullSeat(t)
  const preview = await seat.reviews.preview(seat.id, 'approve-merge', '')
  seat.github.settings = { allow_squash_merge: false, allow_merge_commit: true }
  await assert.rejects(seat.reviews.verdict(seat.id, 'approve-merge', '', preview.confirm), /has changed since it was shown/)
  assert.deepEqual(seat.sent(), [])
})

test('on the user’s own pull request, approve and merge merges it without an approval and says so; approve alone is refused before anything is sent', async (t) => {
  const { id, reviews, sent, store, target } = pullSeat(t, { viewer: 'Dev', author: 'dev' })
  await assert.rejects(reviews.preview(id, 'approve', 'Looks right.'), /GitHub does not let you approve your own pull request/)
  await assert.rejects(reviews.verdict(id, 'approve', 'Looks right.', 'any'), /GitHub does not let you approve your own pull request/)

  const preview = await reviews.preview(id, 'approve-merge', '')
  assert.deepEqual(preview.lines, ['GitHub does not let you approve your own pull request, so this merges it without an approval.', 'Merge acme/shop#482 into main by squashing its commits into one, as you, through gh.', PINNED])
  assert.equal(preview.post, undefined, 'with nothing written, nothing is posted first')
  assert.deepEqual(await reviews.verdict(id, 'approve-merge', '', preview.confirm), { message: 'Merged acme/shop#482 into main.' })
  assert.deepEqual(sent().map((call) => call.args[4]), ['PUT'], 'only the merge went')

  // What the user wrote still goes, as a comment, before the merge.
  reviews.saveNotes(id, { entries: [{ op: 'put', note: note('n1', { text: 'Rename it later.' }) }], draft: null })
  const commented = await reviews.preview(id, 'approve-merge', '')
  assert.equal(commented.lines[1], 'Comment on acme/shop#482 on GitHub first, as you, through gh, with no comments on lines.')
  assert.equal(commented.post?.event, 'COMMENT')
  await reviews.verdict(id, 'approve-merge', '', commented.confirm)
  assert.deepEqual(sent().slice(1).map((call) => call.args[4]), ['POST', 'PUT'])
  assert.equal(store.notes(target).entries.every((entry) => entry.op === 'put' && entry.note.sent === 1000), true, 'the comment is marked sent')
})

test('a merge GitHub refuses after the approval went says both', async (t) => {
  const { id, reviews, sent } = pullSeat(t, { refuseMerge: 'Pull Request is not mergeable (HTTP 405)' })
  const preview = await reviews.preview(id, 'approve-merge', '')
  await assert.rejects(reviews.verdict(id, 'approve-merge', '', preview.confirm), /^Error: It was approved on GitHub, but it was not merged: gh said: Pull Request is not mergeable \(HTTP 405\)$/)
  assert.deepEqual(sent().map((call) => call.args[4]), ['POST', 'PUT'])
})

test('a pull request that moved since its review is merged where it is now: the preview says what moved, and the yes is pinned to it', async (t) => {
  const { id, reviews, sent } = pullSeat(t, { current: NEWER, moved: { rebased: false, same: false, subjects: ['Fix the rounding'] } })
  // The screen shows the review of the older commit: approve and merge is not refused for it.
  const preview = await reviews.preview(id, 'approve-merge', '', sample.change.head)
  assert.deepEqual(preview.lines, [
    'Approve acme/shop#482 on GitHub, as you, through gh, with no comments on lines.',
    'Then merge it into main by squashing its commits into one.',
    'Since this review it gained 1 commit: "Fix the rounding".',
    'This merges fffffff, the commit shown here. GitHub refuses if the pull request moves again before then.',
  ])
  await reviews.verdict(id, 'approve-merge', '', preview.confirm, sample.change.head)
  const [approve, merge] = sent()
  assert.equal(JSON.parse(approve!.input!).commit_id, NEWER, 'the approval goes on the commit it merges')
  assert.deepEqual(JSON.parse(merge!.input!), { sha: NEWER, merge_method: 'squash' })

  // Rebased, the same change: said so. With no checkout to read, only that it moved.
  const rebased = pullSeat(t, { current: NEWER, moved: { rebased: true, same: true, subjects: [] } })
  assert.equal((await rebased.reviews.preview(rebased.id, 'approve-merge', '')).lines[2], 'Since this review it was rebased onto main: the same change, now at fffffff.')
  const unread = pullSeat(t, { current: NEWER })
  assert.equal((await unread.reviews.preview(unread.id, 'approve-merge', '')).lines[2], 'Since this review it moved to fffffff.')
})
