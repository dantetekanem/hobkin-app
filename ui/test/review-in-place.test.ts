import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const open = () => createSession(sample, createReviewMemory())
/** The view's index of a step of the review, as `goTo` takes it. */
const at = (session: ReturnType<typeof open>, stepId: string) => session.getState().view.stepOf[stepId]!

/**
 * A newer copy of the same review, at the same commit: its change review has rewritten the opening, dropped a step the
 * reviewer had passed, and rated a node again.
 */
const rewritten: Review = {
  ...sample,
  story: sample.story.filter((step) => step.id !== 's1').map((step) => (step.id === 'outcome' ? { ...step, title: 'What the change does, said again' } : step)),
  nodes: sample.nodes.map((node) => (node.id === 'u4' ? { ...node, title: 'doingAfter, rated again' } : node)),
}

test('a newer copy of the same review is taken in place: its graph and story follow, and the reviewer stays on their step', () => {
  const session = open()
  for (const step of ['s1', 's2', 's3']) session.getState().goTo(at(session, step))
  const before = session.getState()
  assert.deepEqual(before.focus, ['u4'])
  assert.ok(before.story.seen.includes('s1'))

  before.adopt(rewritten)
  const after = session.getState()
  assert.equal(after.review, rewritten)
  assert.equal(after.view.story[0]!.title, 'What the change does, said again')
  assert.equal(after.nodeOf.get('u4')?.title, 'doingAfter, rated again')
  assert.equal(after.view.story[after.story.step]!.id, 's3', 'the step they were on, at its new place in the story')
  assert.deepEqual(after.focus, ['u4'])
  assert.deepEqual([after.move.key, after.move.kind], [before.move.key + 1, 'jump'], 'the camera frames where they are again, in the graph as it is now')
  assert.deepEqual(after.move.fresh, { nodes: [], wires: [] }, 'nothing draws in again')
  assert.equal(after.story.seen.includes('s1'), false, 'a step the review no longer has is not counted as seen')
})

test('what the reviewer has open stays open while the newer copy still has it, and goes when it does not', () => {
  const session = open()
  session.getState().goTo(at(session, 's3'))
  session.getState().openCode('u4')
  session.getState().setPanelOpen(false)
  const asked = session.getState().startAsk('Why does doingAfter wait?')
  session.getState().adopt(rewritten)
  const kept = session.getState()
  assert.deepEqual([kept.code, kept.panelOpen, kept.asks.map((ask) => ask.key)], ['u4', false, [asked]])

  // A copy whose story has lost the step they were on, and the node whose code was open: back to its first step.
  const without: Review = { ...rewritten, story: rewritten.story.filter((step) => step.id !== 's3'), nodes: rewritten.nodes.filter((node) => node.id !== 'u4'), edges: rewritten.edges.filter((edge) => edge.from !== 'u4' && edge.to !== 'u4') }
  session.getState().adopt(without)
  const moved = session.getState()
  assert.equal(moved.story.step, 0)
  assert.equal(moved.code, null)
  assert.deepEqual(moved.history, { back: [], forward: [] }, 'the places to go back to were steps of the story before')
})

test('the same review again changes nothing', () => {
  const session = open()
  const before = session.getState()
  before.adopt(sample)
  assert.equal(session.getState(), before)
})
