import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import type { Note } from '#shared/review/notes.ts'
import type { OpenedReview, ReviewStatus, VerdictPreview } from '#shared/review/status.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { Client, hostFor } from './support.ts'

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review

test('a pull request opens in Change Review through the host, its notes are kept in the home, and a scripted host posts nothing', async (t) => {
  // No gh is given, so the pull request reads as the sample change and nothing can reach GitHub.
  const host = await hostFor(t)
  const client = await Client.connect(host)
  const id = 'pr:hobkin-sample/storefront/482'

  const unnamed = await client.command('review.prepare', { id: 'sample' })
  assert.equal(!unnamed.ok && unnamed.error.code, 'invalid-arguments')

  let status = await client.run<ReviewStatus>('review.prepare', { id })
  assert.equal(status.state, 'preparing', 'it answers at once')
  for (let tries = 0; status.state === 'preparing' && tries < 200; tries += 1) {
    await delay(25)
    status = await client.run<ReviewStatus>('review.status', { id })
  }
  assert.deepEqual([status.state, status.error, status.storyBy], ['ready', null, 'host'], 'a scripted host asks no model')

  const opened = await client.run<OpenedReview>('review.get', { id })
  assert.equal(opened.review.change.head, sample.change.head)
  assert.equal((await client.run<ReviewFileContents>('review.file', { id, fileId: 'src/cli/doing.mjs' })).base, null)

  // Notes are kept in the home, with the one being written, and come back when the review opens again.
  const step = opened.review.story[0]!.id
  const note: Note = { id: 'n1', step, target: { kind: 'step' }, intent: 'comment', text: 'Say why it waits.', author: 'user', at: 1 }
  await client.run('review.notes', { id, entries: [{ op: 'put', note }], draft: { intent: 'question', text: 'Half a' } })
  const again = await client.run<OpenedReview>('review.get', { id })
  assert.deepEqual([again.notes.entries, again.notes.draft], [[{ op: 'put', note }], { intent: 'question', text: 'Half a' }])
  // Only notes in the shape the review knows are kept.
  const odd = await client.command('review.notes', { id, entries: [{ op: 'put', note: { ...note, target: { kind: 'lines', fileId: 'a', side: 'left', startLine: 1, endLine: 1, hash: 'x' } } }], draft: null })
  assert.equal(!odd.ok && odd.error.code, 'invalid-arguments')

  // The preview shows what GitHub would get: GitHub has no steps, so a note on a step is just its words. A scripted host refuses to send it.
  const preview = await client.run<VerdictPreview>('review.preview', { id, verdict: 'approve', summary: 'Reads well.' })
  assert.deepEqual([preview.post?.event, preview.post?.body], ['APPROVE', 'Reads well.\n\nSay why it waits.'])
  const refused = await client.command('review.verdict', { id, verdict: 'approve', summary: 'Reads well.', confirm: preview.confirm })
  assert.match(!refused.ok ? refused.error.message : '', /posts nothing to GitHub/)
})
