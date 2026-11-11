import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hostRows } from '../src/features/actions/host.ts'
import { answersOf, waiting } from '../src/features/actions/items.ts'
import { sampleItems } from '../src/features/actions/sample.ts'
import { emptyQueue } from '../src/features/questions/queue.ts'

const decision = (id: string, rest: Record<string, unknown> = {}) => ({
  id,
  key: null,
  from: 'Routine inbox-sweep',
  question: 'Unsubscribe from the newsletter?',
  tldr: 'Unsubscribe from the newsletter?',
  choices: [
    { value: 'yes', label: 'Unsubscribe' },
    { value: 'no', label: 'Keep it' },
  ],
  answerTo: { kind: 'routine', id: 'inbox-sweep' },
  recommended: 'yes',
  why: 'It has not been opened in 9 weeks.',
  changed: null,
  at: '2026-11-09T08:00:00.000Z',
  ...rest,
})

test("hobkin's decisions are answered with its own decision action, with every choice and hobkin's pick", () => {
  const [row] = hostRows({ decisions: [decision('d1')], waiting: null })

  assert.deepEqual(row!.answers, { by: 'decision', id: 'd1' })
  assert.deepEqual(row!.question.choices.map(({ value }) => value), ['yes', 'no'])
  assert.equal(row!.question.recommended, 'yes')
  assert.equal(row!.question.why, 'It has not been opened in 9 weeks.')
  assert.equal(row!.opens, undefined)
})

test('a learning proposal is answered with the three choices hobkin offers for it', () => {
  const rows = hostRows({
    decisions: [],
    waiting: {
      proposals: [
        { id: 'a1b2c3', title: 'Keep reports short', question: 'Keep reports short: 4 of 5 were skimmed. Shall hobkin plan it?', scope: 'morning-recap', at: '2026-11-09T09:00:00.000Z' },
        { id: 'd4e5f6', title: 'Skip lockfile churn', question: 'Skip lockfile churn?', scope: 'work.storefront.do', at: '2026-11-09T09:30:00.000Z' },
      ],
    },
  })

  assert.deepEqual(rows[0]!.answers, { by: 'learning', id: 'a1b2c3' })
  assert.deepEqual(rows[0]!.question.choices, [
    { value: 'yes', label: 'Yes, plan it' },
    { value: 'later', label: 'No, but ask me later' },
    { value: 'no', label: 'No, never again' },
  ])
  assert.equal(rows[1]!.question.choices[2]!.label, 'No, never again for this repo', 'a proposal about a repo is never asked again for that repo')
  assert.equal(rows[0]!.question.question, 'Keep reports short: 4 of 5 were skimmed. Shall hobkin plan it?', 'the sheet asks the whole question')
})

test('what waits elsewhere opens where it is handled: a report in Reports, work in the Work screen', () => {
  const rows = hostRows({
    decisions: [],
    waiting: {
      wrong: [
        { key: 'report:r1', tab: 'reports', report: 'r1', fact: 'Dependency look: Upgrade jsonwebtoken today.' },
        { key: 'launch:storefront:3fa9c1', tab: 'work', fact: 'storefront, error rate up since 09:12' },
      ],
      reports: [{ id: 'r2', title: 'Morning recap', at: '2026-11-09T07:02:00.000Z', level: 'useful', next: 'Read the billing note.' }],
      branches: [{ slug: 'storefront', item: '3fa9c1', title: 'Fix the login redirect loop', project: 'storefront', at: '2026-11-09T03:12:00.000Z' }],
      yours: [{ slug: 'billing-api', item: 'b72e10', title: 'Rotate the webhook secret', project: 'billing-api' }],
      asks: [{ kind: 'allowance', title: 'Raise the daily budget', reason: 'The queue is long.' }],
    },
  })
  const opens = Object.fromEntries(rows.map((row) => [row.summary, row.opens]))

  assert.deepEqual(opens['Dependency look: Upgrade jsonwebtoken today.'], { screen: 'reports', report: 'r1' })
  assert.deepEqual(opens['Morning recap'], { screen: 'reports', report: 'r2' })
  assert.deepEqual(opens['storefront, error rate up since 09:12'], { screen: 'work' })
  assert.deepEqual(opens['Fix the login redirect loop'], { screen: 'work' })
  assert.deepEqual(opens['Rotate the webhook secret'], { screen: 'work' })
  assert.deepEqual(opens['Raise the daily budget'], { screen: 'work' })
  assert.ok(rows.every((row) => row.answers === undefined), 'none of these is answered here')
})

test('an open item is answered as hobkin takes it: a decision by a choice or own words, a proposal by its choices only, the rest where it is handled', () => {
  const [decided, proposal, report] = hostRows({
    decisions: [decision('d1')],
    waiting: {
      proposals: [{ id: 'a1b2c3', title: 'Keep reports short', question: 'Shall hobkin plan it?', scope: 'morning-recap', at: '2026-11-09T09:00:00.000Z' }],
      reports: [{ id: 'r1', title: 'Morning recap', at: '2026-11-09T10:00:00.000Z' }],
    },
  })

  assert.deepEqual(answersOf(decided!, false), { choices: decided!.question.choices, words: true })
  assert.deepEqual(answersOf(proposal!, false), { choices: proposal!.question.choices, words: false })
  assert.deepEqual(answersOf(report!, false), { choices: [], words: false })
})

test('a sample item is answered on this screen only, and only while the screen shows samples', () => {
  const [row] = waiting(sampleItems, emptyQueue)

  assert.deepEqual(answersOf(row!, true), { choices: row!.question.choices, words: true })
  assert.deepEqual(answersOf(row!, false), { choices: [], words: false }, 'without a way to hobkin, nothing is answered')
})
