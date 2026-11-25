import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { agentMessage } from '#shared/agent-message.ts'
import { reviewIdOf, targetOfReviewId } from '#shared/review/ids.ts'
import { GRAMMAR_EDITOR, type GrammarAsk } from '#shared/review/grammar.ts'
import { hashLines } from '#shared/review/lines.ts'
import type { Note } from '#shared/review/notes.ts'
import type { PullOwner, ReviewLanding } from '#shared/review/status.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import type { GhOutcome } from '../src/review/gh.ts'
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

/**
 * Reviews over a review already in the home, with a fake hobkin and a fake gh that only write down what they were asked.
 * `plan` is what hobkin says deleting the change's branch takes; `branch` lets a test refuse that look, change it, or fail the deletion.
 * `timeline` is every call to either, in the order they came.
 */
function seated(t: TestContext, id: string, { card = { landing: 'merge', yes: 'Merge hobkin/7d02c9 into main on this machine. Nothing is pushed.', branch: 'hobkin/7d02c9-say-what-hobkin-is-doing', pr: null } as ChangeCard | null, publish, plan = null as unknown, grammar, landing }: { card?: ChangeCard | null; publish?: Publisher; plan?: unknown; grammar?: GrammarAsk; landing?: ReviewLanding } = {}) {
  const home = temporaryDirectory(t)
  const store = reviewStore(home)
  const target = targetOfReviewId(id)!
  store.write(target, sample, files)
  const actions: unknown[][] = []
  const posts: { args: readonly string[]; input?: string }[] = []
  const timeline: string[] = []
  const branch = { plan, refuse: null as string | null, fail: null as string | null }
  let refuse: string | null = null
  // The change is at the review's commit until a test moves it on.
  let at = sample.change.head
  const reviews = new Reviews({
    store,
    sources: { change: { head: async () => at, read: async () => Promise.reject(new Error('Nothing is read again here.')) }, pull: pullSource({ gh: async () => ({ kind: 'missing' }) }) },
    work: () => ({
      workAction: async (...args: unknown[]) => {
        actions.push(args)
        timeline.push(`work ${String(args[0])}`)
        if (refuse) throw new Error(refuse)
        if (args[0] === 'deleteBranch' && (args[3] as { look?: boolean } | undefined)?.look) {
          if (branch.refuse) throw new Error(branch.refuse)
          return { message: 'It deletes its branch.', plan: branch.plan }
        }
        if (args[0] === 'deleteBranch' && branch.fail) throw new Error(branch.fail)
        return { message: `hobkin did ${String(args[0])}.` }
      },
    }),
    card: () => card,
    ...(landing ? { landing: () => landing } : {}),
    ...(publish ? { publish } : {}),
    ...(grammar ? { grammar } : {}),
    gh: async (args, input): Promise<GhOutcome> => {
      posts.push({ args, input })
      if (args.includes('--method')) timeline.push(`gh ${args[args.indexOf('--method') + 1]} ${args.find((arg) => arg.startsWith('repos/'))}`)
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
  return { reviews, store, target, actions, posts, timeline, branch, notes, moveOn, refuse: (reason: string | null) => (refuse = reason) }
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
  // Merged: it leaves the list of reviews, so nothing is left on screen that reads as if it were still waiting.
  assert.equal(reviews.list().reviews.some((item) => item.id === id), false)
  // The review itself still opens for whoever has it on screen, until they leave it.
  assert.equal(reviews.get(id).review.id, sample.id)

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
  const body = agentMessage({ summary: sample.summary, details: `Branch: ${sample.change.branch}\nBase: ${sample.change.base}\nReviewed commit: ${sample.change.head}` })
  // The title and description it opens with are shown, as they go into the token.
  assert.deepEqual(preview.lines, [
    `Push hobkin/7d02c9-say-what-hobkin-is-doing at ${sample.change.head.slice(0, 7)} to acme/shop on GitHub, as you.`,
    `Open a pull request from it into main, titled "${sample.change.title}".`,
    `Its description: ${body}`,
    'Nothing is merged.',
  ])
  assert.deepEqual(opened, [], 'a preview opens nothing')

  assert.deepEqual(await reviews.verdict(id, 'approve', '', preview.confirm), { message: 'Opened https://github.com/acme/shop/pull/9' })
  assert.deepEqual(opened, [{ plan: { repo: 'acme/shop', base: 'main', branch: 'hobkin/7d02c9-say-what-hobkin-is-doing', slug: 'hobkin' }, pull: { head: sample.change.head, title: sample.change.title, body } }])
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
  assert.match(preview.post!.body!, /^Two things\.\n\nAbout src\/cli\/runtime\.mjs, lines 176 to 178, as changed: Read as one\.\n\nAbout send, code in [^:]+: Name it after what it holds\.$/)
  assert.equal(preview.post!.body!.includes('For hobkin only'), false)

  const done = await reviews.verdict(id, 'request-changes', 'Two things.', preview.confirm)
  assert.equal(done.message, 'Posted to GitHub: https://github.com/acme/shop/pull/482#pullrequestreview-1')
  assert.equal(posts.length, 1)
  assert.deepEqual(posts[0]!.args, ['api', '--hostname', 'github.com', '--method', 'POST', 'repos/acme/shop/pulls/482/reviews', '--input', '-'])
  assert.deepEqual(JSON.parse(posts[0]!.input!), preview.post)

  // The comments went with it, so they are marked sent and are not posted again. The question stays for hobkin.
  const after = store.notes(target).entries.map((entry) => (entry.op === 'put' ? [entry.note.id, entry.note.sent ?? null] : null))
  assert.deepEqual(after, [['n1', 1000], ['n2', 1000], ['n3', null]])
  // With every comment sent, a comment would say nothing, so it is refused before anything is sent.
  await assert.rejects(reviews.preview(id, 'comment', ''), /nothing to post/)
})

test("a review posts only the user's words once: hobkin's note stays unsent, and a review with nothing to say is refused before anything goes", async (t) => {
  const id = 'pr:acme/shop/482'
  const { reviews, posts, notes, store, target } = seated(t, id)
  notes([
    note('n1', { text: 'Rename it later.' }),
    note('n2', { author: 'hobkin', text: 'hobkin thinks this needs a test.' }),
  ])
  const preview = await reviews.preview(id, 'comment', '')
  assert.deepEqual(preview.post, { event: 'COMMENT', commit_id: sample.change.head, body: 'Rename it later.', comments: [] })
  await reviews.verdict(id, 'comment', '', preview.confirm)
  assert.deepEqual(posts.map((post) => JSON.parse(post.input!)), [preview.post])
  const sent = store.notes(target).entries.map((entry) => (entry.op === 'put' ? [entry.note.id, entry.note.sent ?? null] : null))
  assert.deepEqual(sent, [['n1', 1000], ['n2', null]], "only the user's note is marked sent")

  // A request for changes needs words of the user's; a comment needs something.
  await assert.rejects(reviews.preview(id, 'request-changes', ''), /request for changes needs your words/)
  await assert.rejects(reviews.preview(id, 'comment', ''), /nothing to post/)

  // An approval with no words is posted once: the same confirmation again posts nothing more.
  const approval = await reviews.preview(id, 'approve', '')
  assert.deepEqual(approval.post, { event: 'APPROVE', commit_id: sample.change.head, comments: [] })
  await reviews.verdict(id, 'approve', '', approval.confirm)
  await assert.rejects(reviews.verdict(id, 'approve', '', approval.confirm), /posted already/)
  assert.equal(posts.filter((post) => post.args.includes('--method')).length, 2, 'one comment and one approval')
})

test("the user's words have their grammar fixed before they post: the preview shows what goes, its yes sends exactly that, and they are checked once", async (t) => {
  const passes: string[] = []
  const grammar: GrammarAsk = async ({ system, prompt }) => {
    passes.push(system)
    if (system !== GRAMMAR_EDITOR) return JSON.stringify({ judgments: [{ id: 'body', grammar_only: true }, { id: 'comment-0', grammar_only: false }] })
    assert.equal((JSON.parse(prompt) as { comments: string[] }).comments[0], 'rename it')
    return JSON.stringify({ body: "This doesn't handle the retry.", comments: ['Rename it to total.'] })
  }
  const id = 'pr:acme/shop/482'
  const { reviews, posts, notes } = seated(t, id, { grammar })
  const head = files.find((file) => file.fileId === 'src/cli/runtime.mjs')!.head!
  notes([note('n1', { text: 'this dont handle the retry' }), note('n2', { target: { kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 176, endLine: 176, hash: hashLines(head, 176, 176) }, text: 'rename it' })])

  const preview = await reviews.preview(id, 'comment', '')
  assert.deepEqual([preview.post?.body, preview.post?.comments.map((comment) => comment.body)], ["This doesn't handle the retry.", ['rename it']])
  assert.ok(preview.lines.includes('Grammar fixed in one place; what goes is shown below.'), preview.lines.join('\n'))
  // What could change the meaning is not made: it is handed over, for the reviewer to take in, as pi-coder asks for each.
  assert.deepEqual(preview.suggested, [{ original: 'rename it', suggestion: 'Rename it to total.' }])
  assert.equal(preview.lines.some((line) => line.startsWith('Not changed')), false, 'said once, where it can be taken in')
  await reviews.verdict(id, 'comment', '', preview.confirm)
  assert.deepEqual(JSON.parse(posts.find((post) => post.args.includes('--method'))!.input!), preview.post)
  assert.equal(passes.length, 2, 'the yes posts the words the preview checked, asking nothing again')
})

test('a grammar check that cannot run posts the words as written and says why', async (t) => {
  const id = 'pr:acme/shop/482'
  const { reviews, posts, notes } = seated(t, id, { grammar: async () => Promise.reject(new Error('the model is down')) })
  notes([note('n1', { text: 'this dont handle the retry' })])
  const preview = await reviews.preview(id, 'comment', '')
  assert.equal(preview.post?.body, 'this dont handle the retry')
  assert.ok(preview.lines.includes('Your words go as you wrote them: their grammar was not checked, because the check failed: the model is down.'), preview.lines.join('\n'))
  await reviews.verdict(id, 'comment', '', preview.confirm)
  assert.equal(JSON.parse(posts.find((post) => post.args.includes('--method'))!.input!).body, 'this dont handle the retry')
})

test('a stale window save keeps a posted comment out of later verdicts', async (t) => {
  const id = 'pr:acme/shop/482'
  const { reviews, notes, store, target } = seated(t, id)
  const stale = note('n1', { text: 'Already posted.' })
  notes([stale])
  const preview = await reviews.preview(id, 'comment', '')
  await reviews.verdict(id, 'comment', '', preview.confirm)

  const fresh = note('n2', { text: 'New feedback.' })
  notes([stale, fresh])

  assert.deepEqual(store.notes(target).entries, [
    { op: 'put', note: { ...stale, sent: 1000 } },
    { op: 'put', note: fresh },
  ])
  const later = await reviews.preview(id, 'comment', '')
  assert.doesNotMatch(later.post!.body!, /Already posted/)
  assert.match(later.post!.body!, /New feedback/)
})

/** A pull request's review in the home, with a gh that answers as GitHub would and writes down every call. */
function pullSeat(
  t: TestContext,
  {
    viewer = 'me',
    author = 'dev',
    settings = { allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true } as Record<string, boolean>,
    refuseMerge = null as string | null,
    refuseClose = null as string | null,
    refuseDelete = null as string | null,
    current = sample.change.head,
    headRef = 'feature/rounding',
    headRepo = 'acme/shop' as string | null,
    moved = undefined as Moved | undefined,
    protectedBranch = false,
    /** Other open pull requests from the same branch, and open pull requests that merge into it. */
    sharing = { heads: [] as number[], bases: [] as number[] },
    /** Whose its review recorded it is: the user's own unless a test says otherwise, null for a review from before that. */
    owner = { author: 'dev', mine: true } as PullOwner | null,
  } = {},
) {
  const id = 'pr:acme/shop/482'
  const store = reviewStore(temporaryDirectory(t))
  store.write(targetOfReviewId(id)!, sample, files, owner ? { preparedAt: '2026-11-12T15:00:00.000Z', storyBy: 'host', owner } : undefined)
  const calls: { args: readonly string[]; input?: string }[] = []
  /**
   * GitHub as these calls find it. `gate`, while set, holds the close until a test lets it go; `pushOnClose` is a commit
   * someone pushes to the branch just as the pull request closes; `deleted` says whether its branch went.
   */
  const github = { settings, state: 'open', head: current, gate: null as Promise<void> | null, pushOnClose: null as string | null, deleted: false }
  const branchPath = `repos/acme/shop/branches/${headRef.split('/').map(encodeURIComponent).join('/')}`
  const listed = (numbers: number[]) => ({ kind: 'done' as const, stdout: JSON.stringify(numbers.map((number) => ({ number }))) })
  const gh = async (args: readonly string[], input?: string): Promise<GhOutcome> => {
    calls.push({ args, input })
    const path = args.find((arg) => arg === 'user' || arg === 'graphql' || arg.startsWith('repos/'))
    if (path === 'user') return { kind: 'done', stdout: JSON.stringify({ login: viewer }) }
    if (path === 'repos/acme/shop') return { kind: 'done', stdout: JSON.stringify({ default_branch: 'main', node_id: 'R_shop', ...github.settings }) }
    if (path === branchPath) return { kind: 'done', stdout: JSON.stringify({ name: headRef, protected: protectedBranch }) }
    if (path === `repos/acme/shop/pulls?state=open&head=${encodeURIComponent(`acme:${headRef}`)}`) return listed([...(github.state === 'open' ? [482] : []), ...sharing.heads])
    if (path === `repos/acme/shop/pulls?state=open&base=${encodeURIComponent(headRef)}`) return listed(sharing.bases)
    // The one delete there is: `updateRefs`, which GitHub does only while the branch is still at `beforeOid`.
    if (path === 'graphql') {
      if (refuseDelete) return { kind: 'failed', code: 1, stdout: '', stderr: refuseDelete }
      const { variables } = JSON.parse(input ?? '{}') as { variables: { repo: string; name: string; before: string } }
      if (variables.repo !== 'R_shop' || variables.name !== `refs/heads/${headRef}` || variables.before !== github.head) {
        return { kind: 'done', stdout: JSON.stringify({ data: { updateRefs: null }, errors: [{ message: `refs/heads/${headRef} is not at ${variables.before}.` }] }) }
      }
      github.deleted = true
      return { kind: 'done', stdout: JSON.stringify({ data: { updateRefs: { clientMutationId: null } } }) }
    }
    if (path === 'repos/acme/shop/issues/482/comments') return { kind: 'done', stdout: JSON.stringify({ html_url: 'https://github.com/acme/shop/pull/482#issuecomment-1' }) }
    if (path === 'repos/acme/shop/pulls/482' && args.includes('PATCH')) {
      if (github.gate) await github.gate
      if (refuseClose) return { kind: 'failed', code: 1, stdout: '', stderr: refuseClose }
      github.state = 'closed'
      if (github.pushOnClose) github.head = github.pushOnClose
    }
    if (path === 'repos/acme/shop/pulls/482') {
      const head = { sha: github.head, ref: headRef, repo: headRepo ? { full_name: headRepo } : null }
      return { kind: 'done', stdout: JSON.stringify({ state: github.state, user: { login: author }, base: { ref: 'main', repo: { full_name: 'acme/shop' } }, head }) }
    }
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
    onMerged: (target) => merges.push(target.kind === 'pull' ? target.number : 0),
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
  assert.equal(reviews.list().reviews.some((item) => item.id === id), false, 'and its review leaves the list of reviews with it')
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

test("someone else's pull request is approved or commented on: merging and closing it are left to its author, and refused before anything is sent", async (t) => {
  for (const owner of [{ author: 'dev', mine: false }, null]) {
    const { id, reviews, sent } = pullSeat(t, { owner })
    for (const verdict of ['approve-merge', 'discard', 'discard-branch'] as const) {
      await assert.rejects(reviews.preview(id, verdict, ''), /left to its author/, `${verdict}, ${owner ? 'someone else' : 'a review from before'}`)
      await assert.rejects(reviews.verdict(id, verdict, '', 'any'), /left to its author/)
    }
    assert.deepEqual(sent(), [])
    assert.equal((await reviews.preview(id, 'approve', 'Looks right.')).post?.event, 'APPROVE')
  }
})

test('a merge GitHub refuses after the approval went says both', async (t) => {
  const { id, reviews, sent } = pullSeat(t, { refuseMerge: 'Pull Request is not mergeable (HTTP 405)' })
  const preview = await reviews.preview(id, 'approve-merge', '')
  await assert.rejects(reviews.verdict(id, 'approve-merge', '', preview.confirm), /^Error: It was approved on GitHub, but it was not merged: gh said: Pull Request is not mergeable \(HTTP 405\)$/)
  assert.deepEqual(sent().map((call) => call.args[4]), ['POST', 'PUT'])
  // The same yes again tries the merge again, and the approval does not go twice.
  await assert.rejects(reviews.verdict(id, 'approve-merge', '', preview.confirm), /not mergeable/)
  assert.deepEqual(sent().map((call) => call.args[4]), ['POST', 'PUT', 'PUT'])
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

test('a reviewed pull request that GitHub says is no longer open leaves the list, whoever merged or closed it', async (t) => {
  const { id, reviews, github } = pullSeat(t)
  assert.equal(reviews.list().reviews.some((item) => item.id === id), true)
  // Still open: it stays.
  await reviews.sweepPulls()
  assert.equal(reviews.list().reviews.some((item) => item.id === id), true)
  // Merged on github.com, outside the app.
  github.state = 'closed'
  await reviews.sweepPulls({ force: true })
  assert.equal(reviews.list().reviews.some((item) => item.id === id), false)
})

/** What was sent to GitHub: the method, the path and the body of every call that was not a read. */
const sentTo = (calls: { args: readonly string[]; input?: string }[]) => {
  const writes = calls.filter((call) => call.args.includes('--method'))

  return writes.map((call) => {
    const method = call.args[call.args.indexOf('--method') + 1]
    const path = call.args.find((arg) => arg.startsWith('repos/') || arg === 'graphql')
    const body = JSON.parse(call.input ?? 'null')

    return [method, path, body]
  })
}

test('discarding a pull request closes it on GitHub without merging it, and only after the yes', async (t) => {
  const { id, reviews, calls, merges } = pullSeat(t)

  const preview = await reviews.preview(id, 'discard', 'Superseded by the new checkout.')
  assert.deepEqual(sentTo(calls), [], 'a preview sends nothing')
  assert.deepEqual(preview.lines, ['Close acme/shop#482 on GitHub without merging it, as you.', 'Your words go on it as a comment first.', 'Its branch stays.'])
  assert.equal(preview.post, undefined, 'a discard is no review')

  // Other words than the ones shown are not what the user said yes to.
  await assert.rejects(reviews.verdict(id, 'discard', 'Something else.', preview.confirm), /has changed since it was shown/)
  assert.deepEqual(sentTo(calls), [])

  assert.deepEqual(await reviews.verdict(id, 'discard', 'Superseded by the new checkout.', preview.confirm), { message: 'Closed acme/shop#482 without merging it.' })
  assert.deepEqual(sentTo(calls), [
    ['POST', 'repos/acme/shop/issues/482/comments', { body: 'Superseded by the new checkout.' }],
    ['PATCH', 'repos/acme/shop/pulls/482', { state: 'closed' }],
  ])
  // It is closed on GitHub, so the host is told and it leaves the lists at once, and its review leaves with it.
  assert.deepEqual(merges, [482])
  assert.equal(reviews.list().reviews.some((item) => item.id === id), false)
})

test('a discard with no words only closes, and a close GitHub refuses says why and keeps the review', async (t) => {
  const quiet = pullSeat(t)
  const preview = await quiet.reviews.preview(quiet.id, 'discard', '  ')
  assert.deepEqual(preview.lines, ['Close acme/shop#482 on GitHub without merging it, as you.', 'Its branch stays.'])
  await quiet.reviews.verdict(quiet.id, 'discard', '  ', preview.confirm)
  assert.deepEqual(sentTo(quiet.calls), [['PATCH', 'repos/acme/shop/pulls/482', { state: 'closed' }]])

  const refused = pullSeat(t, { refuseClose: 'HTTP 403: Must have write access to close this pull request.' })
  const shown = await refused.reviews.preview(refused.id, 'discard', '')
  await assert.rejects(refused.reviews.verdict(refused.id, 'discard', '', shown.confirm), /Must have write access/)
  assert.deepEqual(refused.merges, [])
  assert.equal(refused.reviews.list().reviews.some((item) => item.id === refused.id), true)
})

test("discarding a finished change is hobkin's own no, and closes its pull request when one is open", async (t) => {
  const id = reviewIdOf({ kind: 'change', slug: 'hobkin', item: '7d02c9' })
  const local = seated(t, id)
  // A discard never needs a comment, and never waits on the review being for the newest commit.
  await local.moveOn()
  const preview = await local.reviews.preview(id, 'discard', '', sample.change.head.slice(0, 12))
  assert.deepEqual(preview.lines, ['Say no to this change. hobkin does not work on it again, and learns from the no.', 'Its branch stays.'])
  assert.deepEqual(local.actions, [], 'a preview does nothing')
  assert.deepEqual(await local.reviews.verdict(id, 'discard', '', preview.confirm, sample.change.head.slice(0, 12)), { message: 'hobkin did decline.' })
  assert.deepEqual(local.actions, [['decline', 'hobkin', '7d02c9']])
  assert.deepEqual(local.posts, [], 'with no pull request, nothing goes to GitHub')
  assert.equal(local.reviews.list().reviews.some((item) => item.id === id), false, 'and its review leaves the list')

  // With a pull request open, that is closed first, so a no never leaves an open pull request behind.
  const open = seated(t, id, { card: { landing: 'mergePr', yes: 'Merge its pull request.', branch: 'hobkin/7d02c9-say-what-hobkin-is-doing', pr: 'https://github.com/acme/shop/pull/482' } })
  const withPull = await open.reviews.preview(id, 'discard', '')
  assert.deepEqual(withPull.lines, [
    'Say no to this change. hobkin does not work on it again, and learns from the no.',
    'Close its pull request on GitHub without merging it, as you: https://github.com/acme/shop/pull/482',
    'Its branch stays.',
  ])
  assert.deepEqual(await open.reviews.verdict(id, 'discard', '', withPull.confirm), { message: 'hobkin did decline. Closed https://github.com/acme/shop/pull/482 without merging it.' })
  assert.deepEqual(sentTo(open.posts), [['PATCH', 'repos/acme/shop/pulls/482', { state: 'closed' }]])
  assert.deepEqual(open.actions, [['decline', 'hobkin', '7d02c9']])

  // hobkin's refusal comes back as it is, and the review stays for another try.
  const held = seated(t, id)
  held.refuse('"Say what hobkin is doing" is running, so it cannot be declined now.')
  const again = await held.reviews.preview(id, 'discard', '')
  await assert.rejects(held.reviews.verdict(id, 'discard', '', again.confirm), /is running, so it cannot be declined now/)
  assert.equal(held.reviews.list().reviews.some((item) => item.id === id), true)
})

test('discarding a pull request and deleting its branch closes it, then deletes its head branch on GitHub, and only after the yes', async (t) => {
  const { id, reviews, calls, merges, github, store, target } = pullSeat(t)
  reviews.saveNotes(id, { entries: [{ op: 'put', note: note('n1', { text: 'Rename it later.' }) }], draft: null })

  const preview = await reviews.preview(id, 'discard-branch', 'Superseded by the new checkout.')
  assert.deepEqual(sentTo(calls), [], 'a preview only reads GitHub')
  assert.deepEqual(preview.lines, [
    'Close acme/shop#482 on GitHub without merging it, as you.',
    'Your words go on it as a comment first.',
    `Then delete its branch feature/rounding on GitHub, in acme/shop, as you, only if it is still at ${sample.change.head.slice(0, 7)}: a commit pushed since keeps it.`,
    'Its commits stay on the closed pull request, and GitHub can restore the branch from there.',
  ])

  assert.deepEqual(await reviews.verdict(id, 'discard-branch', 'Superseded by the new checkout.', preview.confirm), { message: 'Closed acme/shop#482 without merging it, and deleted its branch feature/rounding.' })
  const writes = sentTo(calls)
  assert.deepEqual(writes.slice(0, 2), [
    ['POST', 'repos/acme/shop/issues/482/comments', { body: 'Superseded by the new checkout.' }],
    ['PATCH', 'repos/acme/shop/pulls/482', { state: 'closed' }],
  ])
  // The delete is one atomic update of the ref, from the commit shown to nothing.
  const [method, path, body] = writes[2]!
  assert.deepEqual([method, path, body.variables], ['POST', 'graphql', { repo: 'R_shop', name: 'refs/heads/feature/rounding', before: sample.change.head }])
  assert.match(body.query, /updateRefs\(input: \{ repositoryId: \$repo, refUpdates: \[\{ name: \$name, beforeOid: \$before, afterOid: "0{40}"/)
  assert.equal(writes.length, 3)
  assert.equal(github.deleted, true)
  assert.deepEqual(merges, [482])
  assert.equal(reviews.list().reviews.some((item) => item.id === id), false)
  // The review is kept, as a merged one is: the notes written on it are not deleted with the branch.
  assert.deepEqual(store.notes(target).entries.map((entry) => (entry.op === 'put' ? [entry.note.id, entry.note.sent ?? null] : null)), [['n1', null]])
})

test('a push to the branch while the pull request closes keeps the branch: the delete is pinned to the commit shown', async (t) => {
  const { id, reviews, github } = pullSeat(t)
  const preview = await reviews.preview(id, 'discard-branch', '')
  github.pushOnClose = NEWER
  await assert.rejects(
    reviews.verdict(id, 'discard-branch', '', preview.confirm),
    new RegExp(`Closed acme/shop#482 without merging it, but its branch feature/rounding was not deleted: refs/heads/feature/rounding is not at ${sample.change.head}\\.$`),
  )
  assert.equal(github.deleted, false)
})

test('a protected branch, the branch of another open pull request and one open pull requests merge into are not deleted, and Remove alone still closes', async (t) => {
  const refusals: [Parameters<typeof pullSeat>[1], RegExp][] = [
    [{ protectedBranch: true }, /Its branch feature\/rounding is protected in acme\/shop, so it is not deleted from here\. Remove closes the pull request and keeps the branch\.$/],
    [{ sharing: { heads: [490], bases: [] } }, /Its branch feature\/rounding is also the branch of acme\/shop#490, which is open, so it is not deleted\. Remove closes this pull request and keeps the branch\.$/],
    [{ sharing: { heads: [], bases: [501, 502, 503] } }, /Its branch feature\/rounding is what acme\/shop#501 and 2 more open pull requests merge into, so it is not deleted\. Remove closes this pull request and keeps the branch\.$/],
  ]
  for (const [options, refused] of refusals) {
    const seat = pullSeat(t, options)
    await assert.rejects(seat.reviews.preview(seat.id, 'discard-branch', ''), refused)
    await assert.rejects(seat.reviews.verdict(seat.id, 'discard-branch', '', 'any'), refused)
    const discard = await seat.reviews.preview(seat.id, 'discard', '')
    await seat.reviews.verdict(seat.id, 'discard', '', discard.confirm)
    assert.deepEqual(sentTo(seat.calls), [['PATCH', 'repos/acme/shop/pulls/482', { state: 'closed' }]], 'only the close went')
    assert.equal(seat.github.deleted, false)
  }
})

test('one verdict at a time on a review: the same yes again joins the one under way, another is refused, and a discard done is not done twice', async (t) => {
  const { id, reviews, calls, github } = pullSeat(t)
  let release!: () => void
  github.gate = new Promise<void>((resolve) => (release = resolve))
  const preview = await reviews.preview(id, 'discard', 'Superseded.')

  const first = reviews.verdict(id, 'discard', 'Superseded.', preview.confirm)
  const again = reviews.verdict(id, 'discard', 'Superseded.', preview.confirm)
  await assert.rejects(reviews.verdict(id, 'comment', '', 'another-token'), /Another verdict on this review is under way\. Wait for it to end, then look again\./)
  release()
  const closed = { message: 'Closed acme/shop#482 without merging it.' }
  assert.deepEqual(await Promise.all([first, again]), [closed, closed])
  assert.deepEqual(sentTo(calls).map(([method, path]) => [method, path]), [['POST', 'repos/acme/shop/issues/482/comments'], ['PATCH', 'repos/acme/shop/pulls/482']], 'one comment and one close')

  // A window still showing it gives the same yes once more: it is closed already, and nothing is sent again.
  await assert.rejects(reviews.verdict(id, 'discard', 'Superseded.', preview.confirm), /acme\/shop#482 is closed already, so there is nothing left to close\./)
  assert.equal(sentTo(calls).length, 2)
})

test('a branch in a fork or a repository’s default branch is never deleted from here, one that moved since is refused, and a delete GitHub refuses says what was done', async (t) => {
  const fork = pullSeat(t, { headRepo: 'dev/shop' })
  await assert.rejects(fork.reviews.preview(fork.id, 'discard-branch', ''), /Its branch feature\/rounding lives in dev\/shop, a fork, and is not deleted from here\. Remove closes the pull request and keeps the branch\.$/)
  const gone = pullSeat(t, { headRepo: null })
  await assert.rejects(gone.reviews.preview(gone.id, 'discard-branch', ''), /The repository its branch lived in is gone, so there is no branch to delete\. Remove closes the pull request\.$/)
  const main = pullSeat(t, { headRef: 'main' })
  await assert.rejects(main.reviews.preview(main.id, 'discard-branch', ''), /Its branch is main, the default branch of acme\/shop, which is never deleted\. Remove closes the pull request and keeps the branch\.$/)
  assert.deepEqual([...sentTo(fork.calls), ...sentTo(gone.calls), ...sentTo(main.calls)], [])

  // A commit pushed to the branch after the preview: deleting it now would take that too, so the yes no longer goes.
  const moved = pullSeat(t)
  const shown = await moved.reviews.preview(moved.id, 'discard-branch', '')
  moved.github.head = NEWER
  await assert.rejects(moved.reviews.verdict(moved.id, 'discard-branch', '', shown.confirm), /has changed since it was shown/)
  assert.deepEqual(sentTo(moved.calls), [])

  const refused = pullSeat(t, { refuseDelete: 'HTTP 422: Reference does not exist' })
  const asked = await refused.reviews.preview(refused.id, 'discard-branch', '')
  await assert.rejects(refused.reviews.verdict(refused.id, 'discard-branch', '', asked.confirm), /Closed acme\/shop#482 without merging it, but its branch feature\/rounding was not deleted: gh said: HTTP 422: Reference does not exist$/)
  assert.deepEqual(refused.merges, [482], 'it is closed on GitHub, so it leaves the lists all the same')
})

const BRANCH = 'hobkin/7d02c9-say-what-hobkin-is-doing'
const TREE = join(homedir(), '.hobkin/work/hobkin/trees/7d02c9-say-what-hobkin-is-doing')
/** What hobkin says deleting the change's branch takes: here and on GitHub, with its worktree and the files git ignores in it, and two commits only on it. */
const PLAN = { branch: BRANCH, here: sample.change.head, remote: { name: 'origin', url: 'git@github.com:acme/shop.git', sha: sample.change.head }, worktree: TREE, ignored: ['.env', 'build/', 'dist/', 'node_modules/', 'tmp/'], lost: 2 }
const WITH_PULL: ChangeCard = { landing: 'mergePr', yes: 'Merge its pull request.', branch: BRANCH, pr: 'https://github.com/acme/shop/pull/482' }

test('a no on a change hobkin no longer lists as finished: one waiting to merge after its refresh gets the no, so it never merges; one hobkin is done with only leaves the list', async (t) => {
  const id = reviewIdOf({ kind: 'change', slug: 'hobkin', item: '7d02c9' })
  // The user said merge: hobkin took the item back to bring it up to date, so no finished card lists it until that run ends.
  const asked = seated(t, id, { card: null, landing: { state: 'refreshing', at: '2026-11-21T10:00:00.000Z', message: 'An agent is bringing it up to date with main, and hobkin merges it once that run ends well.' } })
  const preview = await asked.reviews.preview(id, 'discard', '')
  assert.deepEqual(preview.lines, ['Say no to this change. hobkin does not work on it again, and learns from the no.', 'The merge you asked for does not happen.', 'Its branch stays.'])
  assert.deepEqual(asked.actions, [], 'a preview does nothing')
  assert.deepEqual(await asked.reviews.verdict(id, 'discard', '', preview.confirm), { message: 'hobkin did decline.' })
  assert.deepEqual(asked.actions, [['decline', 'hobkin', '7d02c9']])
  assert.equal(asked.reviews.list().reviews.some((item) => item.id === id), false, 'and its review leaves the list')

  // Said no to, closed or dropped elsewhere: there is no no to give, so only the review goes, and its branch with it when asked.
  const over = seated(t, id, { card: null, plan: PLAN })
  const quiet = await over.reviews.preview(id, 'discard', '')
  assert.deepEqual(quiet.lines, ['hobkin is done with this change already, so it only leaves this list.', 'Its branch stays.'])
  assert.deepEqual(await over.reviews.verdict(id, 'discard', '', quiet.confirm), { message: 'hobkin was done with this change already, so it only left the list.' })
  assert.deepEqual(over.actions, [], 'hobkin is told nothing')
  assert.equal(over.reviews.list().reviews.some((item) => item.id === id), false)

  const gone = seated(t, id, { card: null, plan: PLAN })
  const branch = await gone.reviews.preview(id, 'discard-branch', '')
  assert.deepEqual(branch.lines.slice(0, 2), ['hobkin is done with this change already, so it only leaves this list.', `Then delete its branch ${BRANCH} on this Mac and on GitHub, in acme/shop.`])
  assert.equal((await gone.reviews.verdict(id, 'discard-branch', '', branch.confirm)).message, 'It left the list. hobkin did deleteBranch.')
  assert.deepEqual(gone.actions.map((action) => action[0]), ['deleteBranch', 'deleteBranch', 'deleteBranch'], 'no decline: only the look, the look again, and the delete')

  // Anything but a no still needs the finished card.
  await assert.rejects(seated(t, id, { card: null }).reviews.preview(id, 'approve', ''), /hobkin no longer lists this change as finished/)
})

test("discarding a finished change and deleting its branch: its pull request closed, hobkin's no, then the branch hobkin deletes, exactly as shown", async (t) => {
  const id = reviewIdOf({ kind: 'change', slug: 'hobkin', item: '7d02c9' })
  const seat = seated(t, id, { card: WITH_PULL, plan: PLAN })
  seat.notes([note('n1', { text: 'Rename it later.' })])

  const preview = await seat.reviews.preview(id, 'discard-branch', '')
  assert.deepEqual(preview.lines, [
    'Say no to this change. hobkin does not work on it again, and learns from the no.',
    'Close its pull request on GitHub without merging it, as you: https://github.com/acme/shop/pull/482',
    `Then delete its branch ${BRANCH} on this Mac and on GitHub, in acme/shop.`,
    'Remove the worktree that holds it, at ~/.hobkin/work/hobkin/trees/7d02c9-say-what-hobkin-is-doing.',
    'Files git ignores in its worktree go with it: ".env", "build/", "dist/" and 2 more.',
    '2 commits on no other branch or tag on this Mac are lost.',
  ])
  assert.deepEqual(seat.actions, [['deleteBranch', 'hobkin', '7d02c9', { look: true }]], 'a preview only asks hobkin what it would delete')
  assert.deepEqual(seat.posts, [])

  const done = await seat.reviews.verdict(id, 'discard-branch', '', preview.confirm)
  assert.equal(done.message, 'Closed https://github.com/acme/shop/pull/482 without merging it. hobkin took the no. hobkin did deleteBranch.')
  // The yes looks once more, so it does only what was shown: then the close, the no and the deletion, in that order.
  assert.deepEqual(seat.timeline, ['work deleteBranch', 'work deleteBranch', 'gh PATCH repos/acme/shop/pulls/482', 'work decline', 'work deleteBranch'])
  assert.deepEqual(seat.actions.at(-1), ['deleteBranch', 'hobkin', '7d02c9', { expect: PLAN }], 'it deletes exactly what was shown')
  assert.equal(seat.reviews.list().reviews.some((item) => item.id === id), false)
  assert.deepEqual(seat.store.notes(seat.target).entries.map((entry) => (entry.op === 'put' ? entry.note.id : null)), ['n1'], 'its review keeps the notes written on it')
})

test('what deleting the branch takes is said as it is: on this Mac, on GitHub or elsewhere, and how many commits are lost', async (t) => {
  const id = reviewIdOf({ kind: 'change', slug: 'hobkin', item: '7d02c9' })
  const sha = sample.change.head
  const linesFor = async (plan: unknown) => (await seated(t, id, { plan }).reviews.preview(id, 'discard-branch', '')).lines.slice(1)

  assert.deepEqual(await linesFor({ ...PLAN, remote: null, worktree: null, lost: 0 }), [`Then delete its branch ${BRANCH} on this Mac.`, 'No commit is lost: every one on it is on another branch or tag on this Mac.'])
  assert.deepEqual(await linesFor({ ...PLAN, remote: null, ignored: ['.env', 'build/'], lost: 0 }), [
    `Then delete its branch ${BRANCH} on this Mac.`,
    'Remove the worktree that holds it, at ~/.hobkin/work/hobkin/trees/7d02c9-say-what-hobkin-is-doing.',
    'Files git ignores in its worktree go with it: ".env" and "build/".',
    'No commit is lost: every one on it is on another branch or tag on this Mac.',
  ])
  // A tree with nothing ignored in it says nothing of them, nor does what an older hobkin says without the list.
  const { ignored: _ignored, ...older } = PLAN
  assert.equal((await linesFor({ ...PLAN, ignored: [] })).some((line) => line.startsWith('Files git ignores')), false)
  assert.equal((await linesFor(older)).some((line) => line.startsWith('Files git ignores')), false)
  assert.deepEqual(await linesFor({ ...PLAN, here: null, remote: { name: 'origin', url: 'https://github.com/acme/shop.git', sha }, worktree: null, lost: 1 }), [
    `Then delete its branch ${BRANCH} on GitHub, in acme/shop. It is gone from this Mac already.`,
    '1 commit on no other branch or tag on this Mac is lost.',
  ])
  assert.deepEqual(await linesFor({ ...PLAN, remote: { name: 'origin', url: '/srv/git/shop.git', sha }, worktree: null, lost: null }), [`Then delete its branch ${BRANCH} on this Mac and on origin, at /srv/git/shop.git.`, 'Commits on no other branch or tag on this Mac are lost.'])
})

test("hobkin's refusal comes before anything is done, a branch that changed since is refused, and a deletion that fails after the no says what was done", async (t) => {
  const id = reviewIdOf({ kind: 'change', slug: 'hobkin', item: '7d02c9' })

  const held = seated(t, id, { card: WITH_PULL, plan: PLAN })
  held.branch.refuse = `${BRANCH} is checked out in the project's own folder, ~/Poetry/hobkin, so it is not deleted. Switch that folder to another branch first.`
  await assert.rejects(held.reviews.preview(id, 'discard-branch', ''), /is checked out in the project's own folder, ~\/Poetry\/hobkin, so it is not deleted\. Switch that folder to another branch first\.$/)
  await assert.rejects(held.reviews.verdict(id, 'discard-branch', '', 'any'), /checked out in the project's own folder/)
  assert.deepEqual([held.timeline.filter((call) => call !== 'work deleteBranch'), held.posts], [[], []], 'nothing was closed, declined or deleted')

  // The branch gained a commit after the preview, so deleting it now takes more than was shown.
  const moved = seated(t, id, { card: WITH_PULL, plan: PLAN })
  const shown = await moved.reviews.preview(id, 'discard-branch', '')
  moved.branch.plan = { ...PLAN, here: NEWER, lost: 3 }
  await assert.rejects(moved.reviews.verdict(id, 'discard-branch', '', shown.confirm), /has changed since it was shown/)
  assert.deepEqual(moved.timeline, ['work deleteBranch', 'work deleteBranch'])

  const failing = seated(t, id, { plan: PLAN })
  const asked = await failing.reviews.preview(id, 'discard-branch', '')
  failing.branch.fail = `Removed its worktree, but ${BRANCH} was not deleted on this Mac: cannot lock ref`
  await assert.rejects(failing.reviews.verdict(id, 'discard-branch', '', asked.confirm), new RegExp(`hobkin took the no, but its branch was not deleted: Removed its worktree, but ${BRANCH} was not deleted on this Mac: cannot lock ref$`))
  assert.deepEqual(failing.actions.map((action) => action[0]), ['deleteBranch', 'deleteBranch', 'decline', 'deleteBranch'])
  assert.equal(failing.reviews.list().reviews.some((item) => item.id === id), false, 'the no went, so its review leaves the list')
})
