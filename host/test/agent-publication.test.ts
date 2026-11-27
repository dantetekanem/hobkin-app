import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { hashLines } from '#shared/review/lines.ts'
import type { Note } from '#shared/review/notes.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { pullReviewPost } from '#shared/review/verdict.ts'
import { gitPublisher } from '../src/review/publish.ts'
import { Reviews } from '../src/review/reviews.ts'
import { sampleReviewSource } from '../src/review/sample-source.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const files = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]
const target = { kind: 'change', slug: 'shop', item: 'word' } as const
const id = 'change:shop:word'
const clientVersion = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version
const note = (rest: Partial<Note> = {}): Note => ({
  id: 'n1',
  step: sample.story[0]!.id,
  target: { kind: 'lines', fileId: sample.files[0]!.id, side: 'added', startLine: 1, endLine: 1, hash: '' },
  text: 'The request fails. Keep this safeguard.',
  author: 'hobkin',
  at: 1,
  intent: 'comment',
  ...rest,
})
const noWork = () => { throw Error('No work action is allowed.') }
const card = () => ({ landing: 'merge' as const, yes: 'Merge it.', branch: 'hobkin/word', pr: null })

function envelope(body: string, version: string) {
  assert.ok(body.endsWith(`\n\n**[made by hobkin · ${version}]**`), body)
  assert.doesNotMatch(body, /<details\b/i)
  assert.ok(body.includes(`Reviewed commit: ${sample.change.head}`))
}

test('confirmed PR publication sends exactly its preview with the generating job version, not the current package version', async (t) => {
  const store = reviewStore(temporaryDirectory(t))
  const meta = { preparedAt: '2026-11-13T12:00:00Z', storyBy: 'host' as const, producerVersion: '3.2.1' }
  store.write(target, sample, files, meta)
  const sent: { args: readonly string[]; input?: string }[] = []
  const gitCalls: string[][] = []
  const publish = gitPublisher({
    repoOf: () => '/projects/shop.invalid',
    baseOf: async () => 'main',
    git: async (_repo, args) => {
      gitCalls.push([...args])
      return args[0] === 'remote' ? 'https://github.com/acme/shop.git' : ''
    },
    gh: async (args, input) => {
      sent.push({ args, input })
      return { kind: 'done', stdout: '{"html_url":"https://github.com/acme/shop/pull/9"}' }
    },
  })
  const source = sampleReviewSource()
  const reviews = new Reviews({ store, sources: { change: source, pull: source }, work: noWork, card, publish })
  t.after(() => reviews.close())
  const preview = await reviews.preview(id, 'approve', '')
  assert.equal(sent.length, 0)
  assert.equal(gitCalls.some((args) => args[0] === 'push'), false)
  const body = preview.lines.find((line) => line.startsWith('Its description: '))!.slice('Its description: '.length)
  envelope(body, 'v3.2.1')
  assert.ok(body.includes(sample.summary))
  await assert.rejects(reviews.verdict(id, 'approve', '', 'not-confirmed'), /changed since it was shown/)
  assert.equal(sent.length, 0)
  await reviews.verdict(id, 'approve', '', preview.confirm)
  assert.equal(sent.length, 1)
  assert.equal(JSON.parse(sent[0]!.input!).body, body)
  assert.ok(gitCalls.some((args) => args[0] === 'push'))
})

test('new preparation persists the client producer version; old reviews do not acquire a later version', async (t) => {
  const store = reviewStore(temporaryDirectory(t))
  const source = sampleReviewSource()
  const publish = {
    plan: async () => ({ slug: 'shop', repo: 'acme/shop', base: 'main', branch: 'hobkin/word' }),
    open: async () => { throw Error('No send is allowed.') },
  }
  const reviews = new Reviews({ store, sources: { change: source, pull: source }, work: noWork, card, publish })
  t.after(() => reviews.close())
  reviews.prepare(id)
  await reviews.settled(id)
  assert.equal(store.latest(target)!.meta?.producerVersion, clientVersion)
  const legacy = reviewStore(temporaryDirectory(t))
  legacy.write(target, sample, files)
  const reopened = new Reviews({ store: legacy, sources: { change: source, pull: source }, work: noWork, card, publish })
  t.after(() => reopened.close())
  const preview = await reopened.preview(id, 'approve', '')
  const body = preview.lines.find((line) => line.startsWith('Its description: '))!.slice('Its description: '.length)
  envelope(body, 'version unavailable')
})

test("hobkin's own notes, on lines, detached or general, never go with a pull request review; the user's go as written", () => {
  const agent = note({ text: 'The request fails. Keep this safeguard.' })
  const general = [1, 2, 3].map((number) => note({ id: `n${number}`, target: { kind: 'step' }, text: `Failure ${number} needs attention.` }))
  for (const detached of [new Set([agent.id]), new Set<string>()]) {
    const post = pullReviewPost(sample, [agent, ...general], 'request-changes', '', detached)
    assert.deepEqual([post.comments, 'body' in post], [[], false])
  }
  const human = note({ id: 'h1', author: 'user', text: 'My **exact** text.\n\nDo not rewrite it.' })
  const mixed = pullReviewPost(sample, [human, agent, ...general], 'comment', 'My summary.')
  assert.deepEqual(mixed.comments.map((comment) => comment.body), ['My **exact** text.\n\nDo not rewrite it.'])
  assert.equal(mixed.body, 'My summary.')
})

test("the real review publisher posts the previewed words once, refuses the same confirmation again, and leaves hobkin's note unsent", async (t) => {
  const store = reviewStore(temporaryDirectory(t))
  const pull = { kind: 'pull', owner: 'acme', repo: 'shop', number: 9 } as const
  const pullId = 'pr:acme/shop/9'
  store.write(pull, sample, files)
  const source = sampleReviewSource()
  const sent: string[] = []
  const reviews = new Reviews({
    store,
    sources: { change: source, pull: source },
    card: () => null,
    work: noWork,
    gh: async (_args, input) => {
      sent.push(input!)
      return { kind: 'done', stdout: '{}' }
    },
  })
  t.after(() => reviews.close())
  const file = files.find((entry) => entry.head != null)!
  const lines = { kind: 'lines' as const, fileId: file.fileId, side: 'added' as const, startLine: 1, endLine: 1, hash: hashLines(file.head!, 1, 1) }
  store.saveNotes(pull, {
    entries: [
      { op: 'put', note: note({ id: 'agent', target: lines }) },
      { op: 'put', note: note({ id: 'mine', author: 'user', target: lines, text: 'This line reads well.' }) },
    ],
    draft: null,
  })
  const preview = await reviews.preview(pullId, 'comment', 'My human summary.')
  assert.equal(sent.length, 0)
  assert.deepEqual([preview.post!.body, preview.post!.comments.map((comment) => comment.body)], ['My human summary.', ['This line reads well.']])
  await reviews.verdict(pullId, 'comment', 'My human summary.', preview.confirm)
  assert.deepEqual(JSON.parse(sent[0]!), preview.post)
  await assert.rejects(reviews.verdict(pullId, 'comment', 'My human summary.', preview.confirm), /changed since it was shown|posted already/)
  assert.equal(sent.length, 1, 'the same words never go twice')
  const sentAt = new Map(store.notes(pull).entries.map((entry) => (entry.op === 'put' ? [entry.note.id, entry.note.sent ?? null] : ['', null])))
  assert.equal(typeof sentAt.get('mine'), 'number', "the user's note is marked sent")
  assert.equal(sentAt.get('agent'), null, "hobkin's note stays unsent")
})
