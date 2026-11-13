import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { hostRows } from '../src/features/actions/host.ts'
import { emptyQueue } from '../src/features/questions/queue.ts'
import { useQuestions } from '../src/features/questions/store.ts'
import { useActionItems } from '../src/features/actions/store.ts'
import { hostStore } from '../src/lib/host/client.ts'
import { applyHostMessage, applyLink, initialHostState } from '../src/lib/host/state.ts'

const decision = {
  id: 'decision-1', key: null, from: 'Routine inbox', question: 'Renew the domain?',
  tldr: 'Renew the domain', choices: [{ value: 'yes', label: 'Renew' }],
  answerTo: { kind: 'action' }, recommended: 'yes', why: 'It expires soon.', changed: null,
  at: '2026-11-08T08:00:00Z',
}
const hello = (home = '/hobkin') => hostStore.setState({ home, link: 'open' })
const snapshot = (decisions: unknown[] = [], waiting: Record<string, unknown> | null = null, reset = true) =>
  hostStore.setState((state) => applyHostMessage(state, { type: 'state', rev: 1, ...(reset ? { reset: true } : {}), set: { decisions, waiting } }))
const rows = () => useActionItems.getState().rows

afterEach(() => {
  hostStore.setState(initialHostState, true)
  useQuestions.setState({ queue: emptyQueue })
})

test('host hello suppresses samples; snapshots replace decisions and empty stays empty', () => {
  assert.equal(useActionItems.getState().sample, true)
  hello()
  assert.equal(useActionItems.getState().sample, false)
  assert.deepEqual(rows(), [])
  snapshot([decision])
  assert.deepEqual(rows().map(({ id }) => id), [decision.id])
  assert.equal(rows()[0]?.pick, 'Renew')
  assert.equal(rows()[0]?.question.why, 'It expires soon.')
  snapshot([])
  assert.deepEqual(rows(), [])
})

test('updates and removals follow the host, disconnect retains real rows, a new home clears them', () => {
  hello()
  snapshot([decision])
  snapshot([{ ...decision, tldr: 'Updated renewal' }], null, false)
  assert.equal(rows()[0]?.summary, 'Updated renewal')
  hostStore.setState((state) => applyLink(state, 'lost'))
  assert.equal(rows()[0]?.id, decision.id)
  assert.equal(useActionItems.getState().sample, false)
  hello('/other-home')
  assert.deepEqual(rows(), [])
  snapshot([{ ...decision, id: 'other' }])
  assert.equal(rows()[0]?.id, 'other')
  snapshot([])
  assert.deepEqual(rows(), [])
})

test('all waiting groups carry real summaries without invented choices or review destinations', () => {
  const actual = hostRows({ decisions: [decision], waiting: {
    wrong: [{ key: 'launch:one', fact: 'A launch needs attention', tab: 'work' }],
    asks: [{ id: 'ask', question: 'Which account?' }],
    proposals: [{ id: 'proposal', title: 'An idea', reason: 'Needs approval' }],
    branches: [{ slug: 'app', item: 'abc', title: 'Ready branch', summary: 'Exact branch detail', at: '2026-11-07T08:00:00Z' }],
    yours: [{ slug: 'app', item: 'def', title: 'Your task', reason: 'Needs your access', attentionKind: 'personal' }],
    reports: [{ id: 'recap', title: 'Recap', next: 'Check the finding' }],
  } })
  assert.equal(actual.length, 7)
  assert.equal(actual[0]?.summary, 'Ready branch', 'known dates sort oldest first')
  assert.equal(actual.find(({ kind }) => kind === 'yours')?.question.tldr, 'Needs your access')
  assert.equal(actual.find(({ id }) => id === 'waiting:reports:recap')?.question.tldr, 'Check the finding')
  assert.ok(actual.filter(({ item, answers }) => item === null && answers?.by !== 'work').every(({ question, branch }) => question.choices.length === 0 && !branch))
})

test('work steps that Work does not show are cleared here with hobkin\'s done, never a shipping command', () => {
  const rows = hostRows({ waiting: {
    branches: [{ slug: 'app', item: 'shown', title: 'Finished branch' }],
    yours: [
      { slug: 'app', item: 'ship', title: 'Ship exact head', attentionKind: 'approval', head: 'abc123' },
      { slug: 'app', item: 'unknown', title: 'Investigate remaining work' },
      { slug: 'app', item: 'access', title: 'Provide access', attentionKind: 'personal' },
      { slug: 'app', item: 'shown', title: 'Finished branch', reason: 'Smoke test unverified' },
    ],
  } }).filter(row => row.id.startsWith('waiting:yours:'))
  assert.deepEqual(rows.map(row => row.kind), ['approval', 'work', 'yours', 'work'])
  for (const row of rows.slice(0, 3)) {
    const item = row.id.split(':').at(-1)!
    assert.equal(row.opens, undefined, 'Work has no card for it, so it is handled here')
    assert.deepEqual(row.question.choices.map(choice => choice.value), ['done'])
    assert.deepEqual(row.answers, { by: 'work', id: `app:${item}`, slug: 'app', item })
  }
  // A step Work does show as a finished change is still handled there.
  assert.equal(rows[3]?.opens?.screen, 'work')
  assert.equal(rows[3]?.answers, undefined)
})

test('only genuine decisions wait on the user: work that opens elsewhere and a lone mark-done are not action items', () => {
  hello()
  snapshot([decision], {
    branches: [{ slug: 'app', item: 'abc', title: 'Ready branch' }],
    yours: [{ slug: 'app', item: 'clear', title: 'Only you can do this' }],
    proposals: [{ id: 'a1b2c3', scope: 'work.app', title: 'A learning proposal', question: 'Plan it?' }],
    asks: [{ slug: 'app', item: 'prop', kind: 'proposal', question: 'Take this project?' }],
    reports: [{ id: 'recap', title: 'Recap' }],
  })
  // The decision (its own choices), the learning proposal (three choices) and the take-or-skip (two) stay. The finished
  // branch and the report open where they are handled, and the lone "Mark it done" step is a single option: none wait here.
  assert.deepEqual(
    rows().map(({ id }) => id).toSorted(),
    ['decision-1', 'waiting:asks:app:prop', 'waiting:proposals:a1b2c3'],
  )
})

test('host rows ignore local answers and deferred sample questions', () => {
  useQuestions.getState().raise({ id: decision.id, from: 'sample', question: 'Sample?', choices: [] })
  useQuestions.getState().answer(decision.id, { value: 'yes' })
  useQuestions.getState().raiseSample()
  const sampleId = useQuestions.getState().queue.waiting[0]!.id
  useQuestions.getState().defer(sampleId)
  hello()
  snapshot([decision])
  assert.deepEqual(rows().map(({ id }) => id), [decision.id])
})

test('malformed and answered decisions do not reach rendering; unsafe links are excluded', () => {
  const actual = hostRows({ decisions: [
    null, {}, { ...decision, choices: [null] }, { ...decision, at: 4 },
    { ...decision, answer: 'yes' }, { ...decision, links: [{ label: 'Unsafe', url: 'javascript:alert(1)' }, { label: 'Safe', url: 'https://example.com' }] },
  ], waiting: { branches: [null, {}, 42], yours: 'invalid' } })
  assert.equal(actual.length, 1)
  assert.deepEqual(actual[0]?.links, [{ label: 'Safe', url: 'https://example.com' }])
})
