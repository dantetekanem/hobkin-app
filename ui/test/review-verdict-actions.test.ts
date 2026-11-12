import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Verdict } from '../../shared/review/verdict.ts'
import { createVerdictChoices, type VerdictCommands } from '../src/features/review/verdict.ts'

const CHANGE = 'change:hobkin:7d02c9'
const PULL = 'pr:acme/shop/482'

/** The review panel's verdict buttons over a fake host, and what each choice reached. */
function panel(id: string, host: (name: string, args: any) => unknown) {
  const calls: { name: string; args: unknown }[] = []
  const asked: Verdict[] = []
  const command = (async (name: string, args: unknown) => {
    calls.push({ name, args })
    return host(name, args)
  }) as VerdictCommands
  const choices = createVerdictChoices({
    id,
    command,
    saveNotes: async () => void calls.push({ name: 'save', args: null }),
    current: () => true,
    ask: async (verdict) => void asked.push(verdict),
  })
  return { choices, calls, asked }
}

test("approve and approve-and-merge reach the host's verdict", async () => {
  for (const verdict of ['approve', 'approve-merge'] as const) {
    const confirm = (verdict === 'approve' ? 'a' : 'b').repeat(64)
    const lines = verdict === 'approve' ? ['Push hobkin/7d02c9 at 7d02c99 to acme/hobkin on GitHub, as you.', 'Nothing is merged.'] : ['Merge it into main.', 'At commit 7d02c99.']
    const { choices, calls, asked } = panel(CHANGE, (name, args) => (name === 'review.preview' ? { verdict: args.verdict, lines, confirm } : { message: `Done: ${args.verdict}` }))

    // The first yes saves the notes and asks the host what the verdict will do. Nothing is done yet.
    await choices.choose(verdict)
    assert.deepEqual(calls, [{ name: 'save', args: null }, { name: 'review.preview', args: { id: CHANGE, verdict, summary: '' } }])
    assert.deepEqual(choices.getState().preview?.lines, lines)
    assert.deepEqual(asked, [], 'hobkin is not asked to do it in the conversation')

    // The second yes sends the token the host answered, and the host's own words come back.
    await choices.confirm()
    assert.deepEqual(calls.at(-1), { name: 'review.verdict', args: { id: CHANGE, verdict, summary: '', confirm } })
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
  // Choosing to ask hobkin instead leaves that refusal behind.
  await refused.choices.choose('request-changes')
  assert.deepEqual([refused.asked, refused.choices.getState().error], [['request-changes'], null])

  // So does one the host refuses at the last moment.
  const moved = panel(CHANGE, (name, args) => {
    if (name === 'review.verdict') throw new Error('What would be sent has changed since it was shown. Look at it again before sending.')
    return { verdict: args.verdict, lines: ['Merge it into main.'], confirm: 'c'.repeat(64) }
  })
  await moved.choices.choose('approve-merge')
  await moved.choices.confirm()
  assert.match(moved.choices.getState().error ?? '', /changed since it was shown/)

  // Send fixes, and a pull request's own choices, are still requests to hobkin in the conversation.
  const nothing = () => {
    throw new Error('The host is not asked.')
  }
  const fixes = panel(CHANGE, nothing)
  await fixes.choices.choose('request-changes')
  assert.deepEqual(fixes.asked, ['request-changes'])
  const pull = panel(PULL, nothing)
  for (const verdict of ['approve', 'comment', 'request-changes'] as const) await pull.choices.choose(verdict)
  assert.deepEqual(pull.asked, ['approve', 'comment', 'request-changes'])
  assert.deepEqual([...fixes.calls, ...pull.calls], [])
})
