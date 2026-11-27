import assert from 'node:assert/strict'
import { test } from 'node:test'
import { beatAfter, beatOf, type Answers, type Facts } from '../src/features/onboarding/story.ts'

const answers: Answers = { replies: {} }
const withHost: Facts = { pi: null, connected: ['OpenAI Codex'], claude: false, smart: false, asked: null, host: true }
const noHost: Facts = { ...withHost, host: false }

test('with a host, the usage question comes after the account and before the review, however the story got there', () => {
  // An account found with no routines to offer, none at all, or routines done: each comes to the question.
  for (const from of ['found', 'no-account', 'thanks'] as const) assert.equal(beatAfter(from, answers, withHost), 'usage', from)
  assert.equal(beatAfter('usage', { ...answers, usage: false }, withHost), 'needs')
  assert.equal(beatAfter('usage', { ...answers, usage: true }, withHost), 'needs')

  // Without a host there is nowhere to keep the answer, so it is not asked.
  for (const from of ['found', 'no-account', 'thanks'] as const) assert.equal(beatAfter(from, answers, noHost), 'settings', from)
})

test('the usage question is a choice between two bubbles, and asks only once it is reached', () => {
  const beat = beatOf('usage', answers, withHost)
  assert.equal(beat.ask?.kind, 'choice')
  assert.equal(beat.ask?.kind === 'choice' && beat.ask.field, 'usage')
  assert.deepEqual(beat.ask?.kind === 'choice' ? beat.ask.options.map(({ value }) => value).toSorted() : [], ['no', 'yes'])
})
