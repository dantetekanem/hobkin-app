import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '../../shared/review/types.ts'
import type { Verdict } from '../../shared/review/verdict.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createVerdictChoices, type VerdictCommands } from '../src/features/review/verdict.ts'

const CHANGE = 'change:hobkin:7d02c9'
const PULL = 'pr:acme/shop/482'
const TOKEN: Record<Verdict, string> = { approve: 'a'.repeat(64), 'approve-merge': 'b'.repeat(64), 'request-changes': 'c'.repeat(64), comment: 'd'.repeat(64) }

/** A fake host that shows each verdict and then does it, in its own words. Nothing is posted anywhere. */
const host = (name: string, args: any) => (name === 'review.preview' ? { verdict: args.verdict, lines: [`What ${args.verdict} does.`], confirm: TOKEN[args.verdict as Verdict] } : { message: `Done: ${args.verdict}` })

/** The review panel's verdict buttons over a fake host, and every call they made. */
function panel(id: string, answer: (name: string, args: any) => unknown, wiring: { comments?: () => string[]; markSent?: (ids: readonly string[]) => void } = {}) {
  const calls: { name: string; args: unknown }[] = []
  const command = (async (name: string, args: unknown) => {
    calls.push({ name, args })
    return answer(name, args)
  }) as VerdictCommands
  const choices = createVerdictChoices({ id, command, saveNotes: async () => void calls.push({ name: 'save', args: null }), current: () => true, ...wiring })
  return { choices, calls }
}

test("approve and approve-and-merge reach the host's verdict", async () => {
  for (const verdict of ['approve', 'approve-merge'] as const) {
    const lines = verdict === 'approve' ? ['Push hobkin/7d02c9 at 7d02c99 to acme/hobkin on GitHub, as you.', 'Nothing is merged.'] : ['Merge it into main.', 'At commit 7d02c99.']
    const { choices, calls } = panel(CHANGE, (name, args) => (name === 'review.preview' ? { verdict: args.verdict, lines, confirm: TOKEN[verdict] } : { message: `Done: ${args.verdict}` }))

    // The first yes saves the notes and asks the host what the verdict will do. Nothing is done yet.
    await choices.choose(verdict)
    assert.deepEqual(calls, [{ name: 'save', args: null }, { name: 'review.preview', args: { id: CHANGE, verdict, summary: '' } }])
    assert.deepEqual(choices.getState().preview?.lines, lines)

    // The second yes sends the token the host answered, and the host's own words come back.
    await choices.confirm()
    assert.deepEqual(calls.at(-1), { name: 'review.verdict', args: { id: CHANGE, verdict, summary: '', confirm: TOKEN[verdict] } })
    assert.equal(calls.filter(({ name }) => name === 'review.verdict').length, 1)
    assert.equal(choices.getState().message, `Done: ${verdict}`)
    assert.equal(choices.getState().preview, null)
  }

  // A verdict the host cannot do says why, and nothing is sent.
  const refused = panel(CHANGE, (name) => {
    if (name === 'review.preview') throw new Error('This change has no branch to push.')
    return { message: 'Should not happen' }
  })
  await refused.choices.choose('approve')
  await refused.choices.confirm()
  assert.equal(refused.choices.getState().error, 'This change has no branch to push.')
  assert.equal(refused.calls.some(({ name }) => name === 'review.verdict'), false)

  // So does one the host refuses at the last moment.
  const moved = panel(CHANGE, (name, args) => {
    if (name === 'review.verdict') throw new Error('What would be sent has changed since it was shown. Look at it again before sending.')
    return host(name, args)
  })
  await moved.choices.choose('approve-merge')
  await moved.choices.confirm()
  assert.match(moved.choices.getState().error ?? '', /changed since it was shown/)
})

test("Send fixes and a pull request's own choices are the host's verdict too, shown before they go", async () => {
  const choices: [string, Verdict][] = [[CHANGE, 'request-changes'], [PULL, 'approve'], [PULL, 'comment'], [PULL, 'request-changes']]
  for (const [id, verdict] of choices) {
    const panelFor = panel(id, host)
    await panelFor.choices.choose(verdict)
    assert.deepEqual(panelFor.calls, [{ name: 'save', args: null }, { name: 'review.preview', args: { id, verdict, summary: '' } }], `${id} ${verdict} is shown first`)
    await panelFor.choices.confirm()
    assert.deepEqual(panelFor.calls.at(-1), { name: 'review.verdict', args: { id, verdict, summary: '', confirm: TOKEN[verdict] } })
    assert.equal(panelFor.choices.getState().message, `Done: ${verdict}`)
  }
})

test('the comments a verdict takes are marked sent once the host has done it, so they never go twice', async () => {
  const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
  const review = { ...sample, id: CHANGE }
  const memory = createReviewMemory(memoryStorage())
  const step = review.story[1]!.id
  const comment = memory.getState().addNote(review, { step, target: { kind: 'step' }, intent: 'comment', text: 'Name it after what it holds.' })!
  const question = memory.getState().addNote(review, { step, target: { kind: 'step' }, intent: 'question', text: 'Why here?' })!
  const unsent = () => memory.getState().notesOf(review).filter((note) => note.intent === 'comment' && note.sent == null).map((note) => note.id)
  const wiring = { comments: unsent, markSent: (ids: readonly string[]) => memory.getState().markSent(review, ids, 50) }
  const sentAt = (id: string) => memory.getState().notesOf(review).find((note) => note.id === id)?.sent

  // Approving a finished change takes no comment with it: they wait for the fixes.
  const approve = panel(CHANGE, host, wiring)
  await approve.choices.choose('approve')
  await approve.choices.confirm()
  assert.equal(sentAt(comment.id), undefined)

  // A verdict the host refuses at the last moment sends nothing, so nothing is marked.
  const refused = panel(
    CHANGE,
    (name, args) => {
      if (name === 'review.verdict') throw new Error('What would be sent has changed since it was shown.')
      return host(name, args)
    },
    wiring,
  )
  await refused.choices.choose('request-changes')
  await refused.choices.confirm()
  assert.equal(sentAt(comment.id), undefined)

  // Sending the fixes marks the comment it carried, and not the question, which is hobkin's to answer.
  const fixes = panel(CHANGE, host, wiring)
  await fixes.choices.choose('request-changes')
  await fixes.choices.confirm()
  assert.deepEqual([sentAt(comment.id), sentAt(question.id)], [50, undefined])
  assert.deepEqual(unsent(), [])
})
