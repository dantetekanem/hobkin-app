import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isFinishedBranch, kindOf, stepInRow, tally, toQuestion, waiting, type ActionItem } from '../src/features/actions/items.ts'
import { answer, defer, emptyQueue, raise, type Question } from '../src/features/questions/queue.ts'

const CHOICES = [
  { value: 'yes', label: 'Unsubscribe' },
  { value: 'no', label: 'Keep it' },
]

const item = (id: string, over: Partial<ActionItem> = {}): ActionItem => ({
  id,
  key: null,
  from: 'Routine inbox-sweep',
  question: 'Unsubscribe from the provider newsletter?',
  tldr: 'Unsubscribe from the provider newsletter?',
  choices: CHOICES,
  answerTo: { kind: 'routine', id: 'inbox-sweep' },
  recommended: null,
  why: null,
  changed: null,
  at: '2026-11-09T08:00:00.000Z',
  ...over,
})

const merge = item('merge', {
  from: 'Work mode',
  tldr: 'storefront: Fix the login redirect loop',
  question: [
    'storefront: Fix the login redirect loop · safe · 42 lines',
    'Risk: Expired sessions return to the page they came from.',
    '',
    'Undo: Revert the merge commit.',
  ].join('\n'),
  choices: [
    { value: 'later', label: 'Later' },
    { value: 'merge', label: 'Merge it' },
  ],
  answerTo: { kind: 'merge', slug: 'storefront', item: '3fa9c1', head: '7d02c99' },
})

const ids = (rows: readonly { id: string }[]) => rows.map(({ id }) => id)

test('lists waiting items and counts them', () => {
  const items = [
    item('new', { at: '2026-11-09T08:00:00.000Z' }),
    item('old', { at: '2026-11-07T08:00:00.000Z', tldr: 'Renew the domain before it lapses' }),
    item('done', { at: '2026-11-06T08:00:00.000Z', answer: 'yes', answeredAt: '2026-11-08T10:00:00.000Z' }),
  ]
  const rows = waiting(items, emptyQueue)

  assert.deepEqual(ids(rows), ['old', 'new'], 'the one that has waited longest comes first, and an answered one is gone')
  assert.equal(rows[0]!.summary, 'Renew the domain before it lapses', 'one line of summary')
  assert.equal(rows[0]!.from, 'Routine inbox-sweep', 'and its source')
  assert.equal(rows[0]!.at, '2026-11-07T08:00:00.000Z')

  assert.equal(tally(rows).total, 2, 'the count equals the number of rows')
  assert.equal(tally(rows).oldest, '2026-11-07T08:00:00.000Z')
  assert.deepEqual(tally([]), { total: 0, kinds: {}, oldest: null })
})

test('says what kind of thing is waiting', () => {
  assert.equal(kindOf(item('a')), 'routine')
  assert.equal(kindOf(item('a', { answerTo: { kind: 'action', id: 'calendar-prep' } })), 'routine', 'a to-do a routine filed')
  assert.equal(kindOf(item('a', { answerTo: { kind: 'work', slug: 'storefront', item: '3fa9c1' } })), 'work')
  assert.equal(kindOf(item('a', { answerTo: { kind: 'yours', slug: 'billing-api', item: 'a41c07' } })), 'yours')
  assert.equal(kindOf(merge), 'merge')
  assert.equal(kindOf(item('a', { answerTo: { kind: 'pickup', keys: ['storefront:3fa9c1'] } })), 'pickup')
  assert.equal(kindOf(item('a', { answerTo: { kind: 'deploy', slug: 'storefront', items: ['3fa9c1'] } })), 'approval', 'Deploy now? asks to ship')
  assert.equal(kindOf(item('a', { answerTo: { kind: 'outside' } })), 'question', 'a kind this screen has no name for is still a question')
  assert.equal(kindOf(item('a', { answerTo: null })), 'question')

  const rows = waiting([item('a'), merge, item('b')], emptyQueue)
  assert.deepEqual(tally(rows).kinds, { routine: 2, merge: 1 })
})

test('an item asks the way a question does', () => {
  // A short question is the heading itself.
  assert.deepEqual(toQuestion(item('a', { recommended: 'yes', why: 'It has never been opened.' })), {
    id: 'a',
    from: 'Routine inbox-sweep',
    question: 'Unsubscribe from the provider newsletter?',
    choices: CHOICES,
    recommended: 'yes',
    why: 'It has never been opened.',
  })

  // A question of several lines is headed by its short form, and its lines become the summary.
  const asked = toQuestion(merge)
  assert.equal(asked.question, 'storefront: Fix the login redirect loop')
  assert.equal(asked.tldr, 'storefront: Fix the login redirect loop · safe · 42 lines Risk: Expired sessions return to the page they came from. Undo: Revert the merge commit.')
  assert.deepEqual(asked.choices, merge.choices, 'with every choice it has')
  assert.equal('recommended' in asked, false, 'nothing is recommended unless hobkin said so')

  // So is one long line, such as the detail of a to-do a routine filed.
  const detail = 'The registrar sent three reminders and the card on file expired in October, so the renewal will not go through by itself.'
  const todo = toQuestion(item('a', { question: `${detail} ${detail}`, tldr: 'Renew the domain before it lapses' }))
  assert.equal(todo.question, 'Renew the domain before it lapses')
  assert.equal(todo.tldr, `${detail} ${detail}`)

  // A summary that only repeats the heading is left out.
  assert.equal(toQuestion(item('a', { question: 'Unsubscribe from the provider newsletter? It arrives every day.', tldr: 'Unsubscribe from the provider newsletter?' })).tldr, undefined)
  assert.equal(toQuestion(item('a', { tldr: 'The newsletter has never been opened' })).tldr, 'The newsletter has never been opened')

  // What changed since it was last asked is said too.
  assert.equal(toQuestion(item('a', { changed: 'It now arrives twice a day.' })).tldr, 'Changed: It now arrives twice a day.')
  assert.equal(toQuestion(item('a', { from: '' })).from, 'hobkin')

  // The sheet shows a reason under hobkin's pick. With no pick to hang it on, it goes with the summary, so it is not lost.
  const reasoned = toQuestion(item('a', { why: 'It has not been opened in 9 weeks.' }))
  assert.equal('why' in reasoned, false)
  assert.equal(reasoned.tldr, 'It has not been opened in 9 weeks.')
  assert.equal('recommended' in toQuestion(item('a', { recommended: 'maybe' })), false, 'a pick that is not one of its choices is no pick')
})

test("hobkin's pick comes first, so 1 answers with it, and the card keeps what it says of itself", () => {
  const always = { value: 'always', label: 'Always: From now on, unsubscribe from newsletters nobody opens.' }
  const card = item('a', {
    choices: [...CHOICES, { value: 'later', label: 'Ask me next week' }],
    recommended: 'no',
    answerTo: { kind: 'routine', id: 'inbox-sweep' },
    sure: 'low',
    reversible: true,
    deadline: '2026-11-26T22:00:00.000Z',
  })
  const asked = toQuestion(card)
  assert.deepEqual(asked.choices.map(({ value }) => value), ['no', 'yes', 'later'], 'the pick first, the rest as filed')
  assert.deepEqual(answer(raise(emptyQueue, asked), 'a', { value: asked.choices[0]!.value }).answered, [{ id: 'a', answer: { value: 'no' } }])
  assert.equal(asked.sure, 'low')
  assert.equal(asked.reversible, true)
  assert.equal(asked.defaultsAt, '2026-11-26T22:00:00.000Z')

  const learn = toQuestion(item('b', { choices: [...CHOICES, always], recommended: 'yes', learn: true }))
  assert.deepEqual(learn.choices.at(-1), always, 'the choice that keeps the rule stays last')
  assert.equal(learn.learn, true)

  const plain = toQuestion(item('c'))
  assert.deepEqual(plain.choices, CHOICES, 'with no pick, the choices stay as filed')
  assert.deepEqual(['sure', 'reversible', 'defaultsAt', 'learn'].filter((field) => field in plain), [], 'and a card that says nothing of itself shows nothing')
})

test('an answer resolves the item', () => {
  const items = [item('a'), item('b', { at: '2026-11-09T09:00:00.000Z' })]

  let queue = raise(emptyQueue, toQuestion(items[0]!))
  assert.deepEqual(ids(waiting(items, queue)), ['a', 'b'], 'while it is being asked it still waits')

  queue = answer(queue, 'a', { value: 'yes' })
  assert.deepEqual(ids(waiting(items, queue)), ['b'], 'answered by one of its choices, it leaves the list')

  queue = answer(raise(queue, toQuestion(items[1]!)), 'b', { typed: 'ask me again in a week' })
  assert.deepEqual(waiting(items, queue), [], 'and so does one answered in other words')
  assert.equal(tally(waiting(items, queue)).total, 0)
})

test('a timed-out question is listed', () => {
  const asked: Question = {
    id: 'q1',
    from: 'Fix the login redirect loop',
    question: 'Which way should expired sessions go?',
    tldr: 'The fix can keep the old behavior or send people back to where they were.',
    choices: [
      { value: 'return', label: 'Back to the page they were on' },
      { value: 'home', label: 'To the home page' },
    ],
    recommended: 'return',
  }
  let queue = defer(raise(emptyQueue, asked), 'q1')
  const rows = waiting([item('a')], queue)

  assert.deepEqual(ids(rows), ['a', 'q1'], 'it joins the list after what was already waiting')
  assert.equal(rows[1]!.kind, 'question')
  assert.equal(rows[1]!.from, 'Fix the login redirect loop')
  assert.equal(rows[1]!.summary, 'Which way should expired sessions go?')
  assert.deepEqual(rows[1]!.question, asked, 'and asks again with the same choices')
  assert.equal(rows[1]!.putOff, true)
  assert.equal(rows[0]!.putOff, false)

  // Put off a second time, it is still listed once.
  queue = defer(raise(queue, asked), 'q1')
  assert.deepEqual(ids(waiting([item('a')], queue)), ['a', 'q1'])

  // One of the list's own items that was put off keeps its place, and says so.
  queue = defer(raise(queue, toQuestion(item('a'))), 'a')
  const again = waiting([item('a')], queue)
  assert.deepEqual(ids(again), ['a', 'q1'])
  assert.equal(again[0]!.putOff, true)

  // Answered at last, it is gone.
  queue = answer(raise(queue, asked), 'q1', { value: 'home' })
  assert.deepEqual(ids(waiting([item('a')], queue)), ['a'])
})

test('a finished branch offers its review', () => {
  assert.equal(isFinishedBranch(merge), true)
  assert.equal(isFinishedBranch(item('a')), false)
  assert.equal(isFinishedBranch(item('a', { answerTo: { kind: 'merge', slug: 'storefront' } })), false, 'without its item and head there is nothing to review')

  const rows = waiting([item('a'), merge], emptyQueue)
  assert.deepEqual(rows.map(({ branch }) => branch), [false, true])
})

test('a row carries hobkin\'s pick and its links', () => {
  const [row] = waiting(
    [
      item('a', {
        recommended: 'yes',
        changed: 'It now arrives twice a day.',
        links: [{ label: 'The newsletter', url: 'https://example.com/newsletter' }],
      }),
    ],
    emptyQueue,
  )

  assert.equal(row!.pick, 'Unsubscribe', 'the pick is said in the choice\'s own words')
  assert.equal(row!.changed, 'It now arrives twice a day.')
  assert.deepEqual(row!.links, [{ label: 'The newsletter', url: 'https://example.com/newsletter' }])

  const [plain] = waiting([item('b')], emptyQueue)
  assert.equal(plain!.pick, null)
  assert.deepEqual(plain!.links, [])
})

test('left and right move within a row, and stop at its ends', () => {
  // -1 is the row itself. Its other controls are counted from 0.
  assert.equal(stepInRow(-1, 1, 2), 0, 'right steps onto the first of them')
  assert.equal(stepInRow(0, 1, 2), 1)
  assert.equal(stepInRow(1, 1, 2), 1, 'and stops at the last')
  assert.equal(stepInRow(1, -1, 2), 0)
  assert.equal(stepInRow(0, -1, 2), -1, 'left from the first goes back to the row')
  assert.equal(stepInRow(-1, -1, 2), -1)
  assert.equal(stepInRow(-1, 1, 0), -1, 'a row with nothing else in it keeps the keyboard')
})
