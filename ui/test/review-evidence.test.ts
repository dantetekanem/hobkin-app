import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssessmentSummary } from '#shared/review/assessment.ts'
import type { ReviewNode } from '#shared/review/types.ts'
import { evidenceLines, unseenNeeds, unseenWords, type EvidenceFacts } from '../src/features/review/panel/evidence.ts'

type Node = EvidenceFacts['nodes'][number]
const testNode = (id: string, status: ReviewNode['status']): Node => ({ id, kind: 'test', status })
const code = (id: string, tier?: 'needs-you' | 'worth-a-look' | 'safe'): Node => ({ id, kind: 'code', ...(tier ? { attention: { tier, rank: 1, reasons: [] } } : {}) })
const summary = (more: Partial<AssessmentSummary> = {}): AssessmentSummary => ({
  level: 'mid',
  critical: false,
  needsYou: 0,
  worthALook: 2,
  safe: 5,
  storyBy: 'model',
  at: '2026-11-21T16:00:00Z',
  deploy: 'safe',
  ...more,
})
const none: EvidenceFacts = { nodes: [], assessment: null, status: null, parts: [], models: [], seen: new Set() }
const lines = (facts: Partial<EvidenceFacts>) => evidenceLines({ ...none, ...facts })
const said = (facts: Partial<EvidenceFacts>) => lines(facts).map(({ label, text, tone, opens }) => ({ label, text, tone, opens }))

test('the evidence above the verdict reads, in order, the tests, the AI review, the models and proofs, and what needs the reviewer that is seen', () => {
  const facts: Partial<EvidenceFacts> = {
    nodes: [
      testNode('t1', 'passed'),
      testNode('t2', 'failed'),
      testNode('t3', 'not-run'),
      testNode('t4', 'proves-change'),
      { id: 'h1', kind: 'test', status: 'passed', supports: ['t1'] },
      code('u1', 'needs-you'),
      code('u2', 'needs-you'),
      code('u3', 'safe'),
    ],
    assessment: { summary: summary({ level: 'high', deploy: 'risky', needsYou: 2 }) },
    parts: [{ level: 'mid', step: 0, node: null }, { level: 'high', step: 3, node: 'u1' }],
    models: [{ run: 'a', tone: 'ok' }, { run: 'b', tone: 'bad' }, { run: 'c', tone: 'live' }, { run: null, tone: 'quiet' }],
    seen: new Set(['u1']),
  }
  assert.deepEqual(said(facts), [
    // A helper is no test of its own. A failed test opens first.
    { label: 'Tests', text: '2 pass · 1 fails · 1 did not run', tone: 'bad', opens: { to: 'node', id: 't2' } },
    { label: 'AI review', text: 'Risky · 2 parts need you', tone: 'bad', opens: { to: 'step', index: 3 } },
    { label: 'Models and proofs', text: '1 holds · 1 fails · 1 still checking · 1 not checked', tone: 'bad', opens: { to: 'proof' } },
    { label: 'Needs you', text: '1 of 2 seen', tone: 'warn', opens: { to: 'unseen' } },
  ])
})

test('a clean change reads as clean, and each line still opens what it counts', () => {
  const clean = said({
    nodes: [testNode('t1', 'passed'), testNode('t2', 'passed'), code('u1', 'needs-you')],
    assessment: { summary: summary() },
    models: [{ run: 'a', tone: 'ok' }, { run: 'b', tone: 'ok' }],
    seen: new Set(['u1']),
  })
  assert.deepEqual(clean, [
    { label: 'Tests', text: '2 pass', tone: 'ok', opens: { to: 'node', id: 't1' } },
    { label: 'AI review', text: 'Safe · nothing needs you', tone: 'ok', opens: null },
    { label: 'Models and proofs', text: '2 of 2 hold', tone: 'ok', opens: { to: 'proof' } },
    { label: 'Needs you', text: '1 of 1 seen', tone: 'ok', opens: null },
  ])
})

test('a review with no tests, no models and no AI answer yet says so plainly, and nothing that did not run reads as passed', () => {
  assert.deepEqual(said({}), [
    { label: 'Tests', text: 'None in this change', tone: 'quiet', opens: null },
    { label: 'AI review', text: 'No answer yet', tone: 'quiet', opens: null },
    { label: 'Models and proofs', text: 'None in this change', tone: 'quiet', opens: null },
    { label: 'Needs you', text: 'Not said in this review', tone: 'quiet', opens: null },
  ])
  // Tests that did not run, models nothing checked, and a review under way: none of them is a pass.
  const unran = said({
    nodes: [testNode('t1', 'not-run'), testNode('t2', undefined), code('u1', 'safe')],
    status: { state: 'running', head: 'h', percent: 40 },
    models: [{ run: null, tone: 'quiet' }],
  })
  assert.deepEqual(unran, [
    { label: 'Tests', text: '2 did not run', tone: 'quiet', opens: { to: 'node', id: 't1' } },
    { label: 'AI review', text: 'Reviewing… 40%', tone: 'live', opens: null },
    { label: 'Models and proofs', text: '1 not checked', tone: 'quiet', opens: null },
    { label: 'Needs you', text: 'Nothing', tone: 'quiet', opens: null },
  ])
  assert.ok(lines({ status: { state: 'failed', head: 'h', error: 'It stopped.' } })[1]!.tone !== 'ok')
  assert.equal(lines({ status: { state: 'failed', head: 'h', error: 'It stopped.' } })[1]!.text, 'Stopped before its answer')
  // Some ran and some did not: not a clean pass either.
  assert.equal(lines({ nodes: [testNode('t1', 'passed'), testNode('t2', 'not-run')] })[0]!.tone, 'warn')
  assert.equal(lines({ models: [{ run: 'a', tone: 'ok' }, { run: 'b', tone: 'warn' }] })[2]!.tone, 'warn', 'a model with a part that never ran')
})

test('the first press of a yes says how many nodes that need the reviewer are not seen, and offers U', () => {
  const nodes = [code('u1', 'needs-you'), code('u2', 'needs-you'), code('u3', 'needs-you'), code('u4', 'safe')]
  assert.equal(unseenNeeds(nodes, new Set(['u2'])), 2)
  assert.equal(unseenWords(2), '2 nodes that need you are not seen yet. U goes to the next.')
  assert.equal(unseenWords(1), '1 node that needs you is not seen yet. U goes to it.')
  assert.equal(unseenNeeds(nodes, new Set(['u1', 'u2', 'u3'])), 0)
  assert.equal(unseenWords(0), null)
})
