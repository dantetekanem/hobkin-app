import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'zustand/vanilla'
import type { PendingQuestion } from '../../shared/protocol/question.ts'
import { connectQuestions } from '../src/features/questions/bridge.ts'
import { useQuestions } from '../src/features/questions/store.ts'
import { emptyQueue } from '../src/features/questions/queue.ts'

const asked = (id: string): PendingQuestion => ({
  id,
  from: 'Routine inbox-sweep',
  question: 'Unsubscribe from the newsletter?',
  tldr: 'It has not been opened in 9 weeks.',
  choices: [
    { value: 'yes', label: 'Unsubscribe' },
    { value: 'no', label: 'Keep it' },
  ],
  other: true,
  recommended: 'yes',
  why: 'The same news comes in the release notes.',
  askedAt: 0,
  expiresAt: 30000,
})

/** hobkin's side of it: the question the host holds, and what went back. */
function connected(answer: (id: string, reply: unknown) => Promise<void> = async () => {}) {
  useQuestions.setState({ queue: emptyQueue })
  const host = createStore<{ question: PendingQuestion | null }>(() => ({ question: null }))
  const sent: unknown[][] = []
  const stop = connectQuestions({
    host,
    sheet: useQuestions,
    answer: async (id, reply) => {
      sent.push(['answer', id, reply])
      await answer(id, reply)
    },
    defer: async (id) => {
      sent.push(['defer', id])
    },
  })
  return { host, sent, stop }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test("hobkin's question rises on the sheet, with who asks and hobkin's pick and its reason", () => {
  const { host, stop } = connected()
  host.setState({ question: asked('q1') })

  assert.deepEqual(useQuestions.getState().queue.waiting, [
    {
      id: 'q1',
      from: 'Routine inbox-sweep',
      question: 'Unsubscribe from the newsletter?',
      tldr: 'It has not been opened in 9 weeks.',
      choices: asked('q1').choices,
      recommended: 'yes',
      why: 'The same news comes in the release notes.',
    },
  ])
  stop()
})

test('a question of several lines is headed by its short form, as Action Items heads it, and a summary that repeats the heading is left out', () => {
  const { host, stop } = connected()
  const onSheet = (id: string) => useQuestions.getState().queue.waiting.find((question) => question.id === id)
  host.setState({
    question: {
      ...asked('q1'),
      question: 'The checkout test needs a Stripe test key. Which one should it use?\nThe shared key is in the password manager.',
      tldr: 'The checkout test needs a Stripe test key',
    },
  })
  const several = onSheet('q1')
  // The host holds one question at a time, so the next one puts this one off, and each is read as it rises.
  host.setState({ question: { ...asked('q2'), question: 'Unsubscribe from the newsletter?', tldr: 'Unsubscribe from the newsletter?' } })
  const plain = onSheet('q2')

  assert.equal(several!.question, 'The checkout test needs a Stripe test key')
  assert.equal(several!.tldr, 'The checkout test needs a Stripe test key. Which one should it use? The shared key is in the password manager.')
  assert.equal(plain!.question, 'Unsubscribe from the newsletter?')
  assert.equal('tldr' in plain!, false)
  stop()
})

test('an answer on the sheet goes back to hobkin, by its choice or in the words the user typed', async () => {
  const { host, sent, stop } = connected()
  host.setState({ question: asked('q1') })
  useQuestions.getState().answer('q1', { value: 'yes' })
  host.setState({ question: asked('q2') })
  useQuestions.getState().answer('q2', { typed: 'Only the monthly one' })
  await tick()

  assert.deepEqual(sent, [
    ['answer', 'q1', { value: 'yes' }],
    ['answer', 'q2', { typed: 'Only the monthly one' }],
  ])
  stop()
})

test("later, or the sheet's own wait running out, puts it off with hobkin, which keeps it in Action Items", async () => {
  const { host, sent, stop } = connected()
  host.setState({ question: asked('q1') })
  useQuestions.getState().defer('q1')
  await tick()

  assert.deepEqual(sent, [['defer', 'q1']])
  stop()
})

test('a question hobkin takes back leaves the sheet, and nothing goes back for it', async () => {
  const { host, sent, stop } = connected()
  host.setState({ question: asked('q1') })
  host.setState({ question: null })
  await tick()

  assert.deepEqual(useQuestions.getState().queue.waiting, [])
  assert.deepEqual(sent, [])
  stop()
})

test('an answer hobkin refuses puts the question off instead, so it waits in Action Items', async () => {
  const { host, sent, stop } = connected(async () => {
    throw Error('This question takes one of its choices.')
  })
  host.setState({ question: { ...asked('q1'), other: false } })
  useQuestions.getState().answer('q1', { typed: 'Neither' })
  await tick()
  await tick()

  assert.deepEqual(sent, [
    ['answer', 'q1', { typed: 'Neither' }],
    ['defer', 'q1'],
  ])
  stop()
})

test('questions that are not hobkin\'s, such as an Action Items row or a sample, are left to the screen that raised them', async () => {
  const { sent, stop } = connected()
  useQuestions.getState().raiseSample()
  const sample = useQuestions.getState().queue.waiting[0]!
  useQuestions.getState().answer(sample.id, { value: sample.choices[0]!.value })
  await tick()

  assert.deepEqual(sent, [])
  stop()
})
