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
  assert.ok(body.startsWith(`**[made by hobkin · ${version}]**\n\n`), body)
  assert.equal(body.match(/<details>/g)?.length, 1)
  assert.equal(body.match(/<summary>Agent extra information<\/summary>/g)?.length, 1)
  assert.ok(body.endsWith('\n\n—'))
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

test('agent line, detached and general review comments are attributed, escaped and never hide their findings', () => {
  const agent = note({ text: 'The request fails. </details><script>bad()</script>\n```\nKeep this safeguard.' })
  const inline = pullReviewPost(sample, [agent], 'request-changes', '')
  envelope(inline.comments[0]!.body, 'version unavailable')
  assert.ok(inline.comments[0]!.body.indexOf('The request fails.') < inline.comments[0]!.body.indexOf('<details>'))
  assert.equal(inline.comments[0]!.body.includes('<script>'), false)
  for (const detached of [new Set([agent.id]), new Set<string>()]) {
    const loose = detached.size ? agent : note({ target: { kind: 'step' } })
    const post = pullReviewPost(sample, [loose], 'request-changes', '', detached)
    envelope(post.body, 'version unavailable')
    assert.ok(post.body.indexOf('The request fails.') < post.body.indexOf('<details>'))
  }
  const general = [1, 2, 3].map((number) => note({ id: `n${number}`, target: { kind: 'step' }, text: `Failure ${number} needs attention.` }))
  const grouped = pullReviewPost(sample, general, 'request-changes', '').body
  envelope(grouped, 'version unavailable')
  for (const entry of general) assert.ok(grouped.indexOf(entry.text) < grouped.indexOf('<details>'))

  const human = note({ author: 'user', text: 'My **exact** text.\n\nDo not rewrite it.' })
  const before = pullReviewPost(sample, [human], 'comment', 'My summary.')
  const mixed = pullReviewPost(sample, [human, note({ id: 'n2' })], 'comment', 'My summary.')
  assert.deepEqual(mixed.comments[0], before.comments[0], 'the human-owned publication path is unchanged')
  assert.equal(mixed.body, before.body)
  assert.equal(pullReviewPost(sample, [note({ sent: 1 }), note({ intent: 'question' })], 'comment', 'Only this.').body.includes('The request fails.'), false)
})

test('the real review publisher sends the previewed agent envelope once, leaves human content alone, and refuses bad summaries', async (t) => {
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
  const agent = note({
    target: { kind: 'lines', fileId: file.fileId, side: 'added', startLine: 1, endLine: 1, hash: hashLines(file.head!, 1, 1) },
  })
  const save = (text: string) => store.saveNotes(pull, { entries: [{ op: 'put', note: { ...agent, text } }], draft: null })
  save('The request fails. Keep this safeguard.')
  const preview = await reviews.preview(pullId, 'request-changes', 'My human summary.')
  assert.equal(sent.length, 0)
  envelope(preview.post!.comments[0]!.body, 'version unavailable')
  await reviews.verdict(pullId, 'request-changes', 'My human summary.', preview.confirm)
  assert.deepEqual(JSON.parse(sent[0]!), preview.post)
  await assert.rejects(reviews.verdict(pullId, 'request-changes', 'My human summary.', preview.confirm), /changed since it was shown/)
  assert.equal(sent.length, 1, 'sent notes do not get posted again with an old confirmation')
  save('Works.\n\nTests pass.\n\nDeployment failed; user action required.')
  await assert.rejects(reviews.preview(pullId, 'request-changes', ''), /one or two.*summary paragraphs/i)
  assert.equal(sent.length, 1)
})

test('unsafe long agent prose fails before a verdict can send it instead of folding an unseen failure away', () => {
  assert.throws(() => pullReviewPost(sample, [note({ text: 'Works.\n\nA check passed.\n\nDeployment failed; user action required.' })], 'comment', ''), /one or two.*summary paragraphs/i)
})
