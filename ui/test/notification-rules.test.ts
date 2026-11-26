import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HobkinSummary } from '../../shared/protocol/hobkins.ts'
import type { PendingQuestion } from '../../shared/protocol/question.ts'
import type { ChatMessage } from '../../shared/protocol/snapshot.ts'
import type { WaitingRow } from '../src/features/actions/items.ts'
import { needsOf, permissionLine, REVIEW_FRESH_MS, type NeedSources } from '../src/features/notifications/rules.ts'

const NOW = Date.parse('2026-11-13T12:00:00Z')

const question = (patch: Partial<PendingQuestion> = {}): PendingQuestion => ({
  id: 'ask-1', from: 'hobkin', question: 'Ship the fix today?', choices: [{ value: 'y', label: 'Yes' }, { value: 'n', label: 'No' }],
  other: true, askedAt: NOW, expiresAt: null, ...patch,
})

const row = (id: string, patch: Partial<WaitingRow> = {}): WaitingRow => ({
  id, kind: 'routine', from: 'Routine inbox-sweep', summary: `Summary of ${id}`, at: '2026-11-13T11:00:00Z',
  question: { id, from: 'Routine inbox-sweep', question: `Question ${id}`, choices: [] }, putOff: false, branch: false,
  pick: null, changed: null, links: [], item: null, answers: { by: 'decision', id }, ...patch,
})

const hobkin = (id: string, waiting: HobkinSummary['waiting'], patch: Partial<HobkinSummary> = {}): HobkinSummary => ({
  id, title: `Hobkin ${id}`, cwd: '/tmp', engine: { kind: 'tier', tier: 'casual' as never }, state: waiting ? 'waiting' : 'working',
  turns: 1, run: null, last: { status: 'completed', said: 'Done with the migration.\nMore below.', at: '2026-11-13T11:59:00Z' },
  waiting, createdAt: '2026-11-13T10:00:00Z', ...patch,
})

const reviewNotice = (id: string, at: number, review = 'change:storefront:3fa9c1'): ChatMessage =>
  ({ id, role: 'notice', content: 'The change review of "Fix login" in storefront is ready. Open it from its card in Work.', at, tone: 'useful', review }) as ChatMessage

const sources = (patch: Partial<NeedSources> = {}): NeedSources => ({ question: null, items: [], hobkins: [], messages: [], now: NOW, ...patch })

test('a question, a new action item, a durable hobkin waiting unseen and a fresh review ready each need the user once', () => {
  const needs = needsOf(sources({
    question: question(),
    items: [row('item-1')],
    hobkins: [hobkin('0123abcd', { since: '2026-11-13T11:59:00Z', seen: false })],
    messages: [reviewNotice('notice:client:review-ready:a', NOW - 1000)],
  }))
  assert.deepEqual(needs.map(({ id, kind, opens }) => ({ id, kind, opens })), [
    { id: 'ask-1', kind: 'question', opens: { to: 'question' } },
    { id: 'item-1', kind: 'item', opens: { to: 'item', id: 'item-1' } },
    { id: 'hobkin:0123abcd:2026-11-13T11:59:00Z', kind: 'hobkin', opens: { to: 'hobkin', id: '0123abcd' } },
    { id: 'notice:client:review-ready:a', kind: 'review', opens: { to: 'review', id: 'change:storefront:3fa9c1' } },
  ])
  for (const need of needs) {
    assert.ok(need.title.trim() && need.body.trim(), need.id)
    assert.ok(!need.body.includes('\n') && need.body.length <= 140, need.id)
  }
})

test('what merely happened, or was already seen, needs nobody', () => {
  const needs = needsOf(sources({
    hobkins: [
      hobkin('11111111', { since: '2026-11-13T11:00:00Z', seen: true }),
      hobkin('22222222', null),
    ],
    messages: [
      { id: 'm1', role: 'assistant', content: 'Here is the plan.' } as ChatMessage,
      { id: 'notice:quiet', role: 'notice', content: 'Routine ran.', at: NOW } as ChatMessage,
      reviewNotice('notice:client:review-ready:old', NOW - REVIEW_FRESH_MS - 1),
      { ...reviewNotice('notice:client:review-ready:undated', NOW), at: undefined } as ChatMessage,
    ],
  }))
  assert.deepEqual(needs, [])
})

test('a filed question keeps its own identity: on the sheet and under Action Items it is one need', () => {
  // hobkin presents a filed decision on the sheet with the decision's own id.
  const both = needsOf(sources({ question: question({ id: 'decision-7', from: 'Routine inbox-sweep' }), items: [row('decision-7')] }))
  assert.deepEqual(both.map(({ id, kind }) => [id, kind]), [['decision-7', 'question']])
  // Put off, it waits under Action Items with the same id, so it is still the same need.
  const later = needsOf(sources({ items: [row('decision-7')] }))
  assert.deepEqual(later.map(({ id }) => id), ['decision-7'])
})

test("the main agent's question put off into Action Items is the question it was, and is not told again", () => {
  const putOff = row('filed-later', { item: { answerTo: { kind: 'chat' } } as WaitingRow['item'] })
  assert.deepEqual(needsOf(sources({ items: [putOff, row('routine-item')] })).map(({ id }) => id), ['routine-item'])
})

test('each new turn a durable hobkin waits after is a need of its own', () => {
  const first = needsOf(sources({ hobkins: [hobkin('0123abcd', { since: '2026-11-13T11:00:00Z', seen: false })] }))
  const second = needsOf(sources({ hobkins: [hobkin('0123abcd', { since: '2026-11-13T11:30:00Z', seen: false })] }))
  assert.notEqual(first[0]!.id, second[0]!.id)
})

/** A line hobkin's desk let through, with the level it found (075-chief-of-staff S3). */
const leveled = (id: string, level: string, patch: Record<string, unknown> = {}): ChatMessage =>
  ({ id, role: 'notice', content: 'Deploy check: the build is red.\nThe log says more.', tone: 'critical', level, at: NOW - 1000, ...patch }) as ChatMessage

const digestOf = (id: string, at = NOW - 1000): ChatMessage =>
  ({
    id, role: 'notice', tone: 'useful', at,
    content: 'Digest: 1 for today, 1 that can wait.\n- The change review of "Fix login" in storefront is ready.\n- Morning recap finished.',
    digest: {
      levels: { P1: 1, P2: 1 },
      items: [
        { id: 'notice:client:review-ready:b', level: 'P1', content: 'The change review of "Fix login" in storefront is ready.', review: 'change:storefront:3fa9c1' },
        { id: 'notice:routine:c', level: 'P2', content: 'Morning recap finished.' },
      ],
    },
  }) as ChatMessage

test('levels set how a line reaches the user: P0 with the chime, a lone P1 as a soft cue alone, a digest as one soft notification', () => {
  const needs = needsOf(sources({
    messages: [
      leveled('notice:work:p0', 'P0'),
      leveled('notice:work:p1', 'P1'),
      digestOf('notice:digest:1'),
      // P2 and P3 wait for a digest or are only logged; a line from a hobkin before levels is as before.
      leveled('notice:work:p2', 'P2'),
      leveled('notice:work:p3', 'P3'),
      { id: 'notice:work:plain', role: 'notice', content: 'Deploy check: the build is red.', tone: 'critical', at: NOW - 1000 } as ChatMessage,
    ],
  }))
  assert.deepEqual(needs.map(({ id, kind, reach, opens }) => ({ id, kind, reach, opens })), [
    { id: 'notice:work:p0', kind: 'notice', reach: 'chime', opens: { to: 'chat' } },
    { id: 'notice:work:p1', kind: 'notice', reach: 'cue', opens: { to: 'chat' } },
    { id: 'notice:digest:1', kind: 'digest', reach: 'soft', opens: { to: 'chat' } },
  ])
  assert.deepEqual(needs.map(({ title, body }) => [title, body]), [
    ['Needs you now', 'Deploy check: the build is red.'],
    ['For today', 'Deploy check: the build is red.'],
    ['Digest', '1 for today, 1 that can wait.'],
  ])
})

test('a review that is ready keeps its notification without a level, and follows its level with one', () => {
  const ready = (id: string, level?: string) => ({ ...reviewNotice(id, NOW - 1000), ...(level ? { level } : {}) }) as ChatMessage
  const needs = needsOf(sources({ messages: [ready('plain'), ready('now', 'P0'), ready('today', 'P1'), ready('later', 'P2')] }))
  assert.deepEqual(needs.map(({ id, kind, reach, opens }) => ({ id, kind, reach, opens })), [
    { id: 'plain', kind: 'review', reach: 'chime', opens: { to: 'review', id: 'change:storefront:3fa9c1' } },
    { id: 'now', kind: 'review', reach: 'chime', opens: { to: 'review', id: 'change:storefront:3fa9c1' } },
    { id: 'today', kind: 'review', reach: 'cue', opens: { to: 'review', id: 'change:storefront:3fa9c1' } },
  ])
})

test('a leveled line or a digest is news only while it is fresh, and needs nobody once it is history', () => {
  const old = NOW - REVIEW_FRESH_MS - 1
  const needs = needsOf(sources({ messages: [leveled('old-p0', 'P0', { at: old }), leveled('undated', 'P0', { at: undefined }), digestOf('old-digest', old)] }))
  assert.deepEqual(needs, [])
})

test('only a refusal shows a line in Settings', () => {
  assert.equal(typeof permissionLine('denied'), 'string')
  for (const state of ['granted', 'prompt', 'unknown', 'unavailable'] as const) assert.equal(permissionLine(state), null, state)
})
