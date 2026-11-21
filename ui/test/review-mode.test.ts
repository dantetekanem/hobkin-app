import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'
import { modeOfKey } from '../src/features/review/story/mode.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const effects = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, openModelRun: () => {} }
const press = (session: ReturnType<typeof createSession>, key: string, shift = false) => pressKey(session.getState(), { key, shift, alt: false }, effects)
const firstFocus = sample.story[0]!.focus

test('O is Free Roam and P is Story, and each, wherever the reviewer is, starts its mode from the beginning and closes the code', () => {
  assert.deepEqual(['o', 'O', 'p', 'P', 'r', 's', 't'].map(modeOfKey), ['roam', 'roam', 'story', 'story', null, null, null])
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  assert.equal(session.getState().mode, 'story', 'a review with nothing remembered opens in Story')
  session.getState().goTo(3)
  press(session, 'Enter')
  assert.ok(session.getState().code)

  assert.equal(press(session, 'o'), true)
  const roam = session.getState()
  assert.deepEqual([roam.mode, roam.focus, roam.story.whole, roam.code, roam.wire, roam.move.kind], ['roam', [], true, null, null, 'whole'], 'Free Roam starts with the whole graph in view and nothing in focus')

  press(session, 'ArrowDown')
  assert.equal(press(session, 'P'), true)
  const story = session.getState()
  assert.deepEqual([story.mode, story.story.step, story.focus, story.code, story.move.kind], ['story', 0, firstFocus, null, 'jump'], 'Story starts at its first step, framed as a step is')

  // P in Story starts it over, and O in Free Roam gives the whole graph back.
  press(session, 'ArrowRight')
  press(session, 'ArrowRight')
  press(session, 'p')
  assert.equal(session.getState().story.step, 0)
  press(session, 'o')
  press(session, 'ArrowDown')
  press(session, 'O')
  assert.deepEqual(session.getState().focus, [])
})

test('in Free Roam nothing leads: every arrow walks the nodes, a node of a step is focused alone, the step keys move nothing, and Enter and notes are about the node', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  // The story was on step 2, which tells three nodes, when Free Roam was chosen.
  session.getState().goTo(1)
  session.getState().setMode('roam')
  const told = session.getState().view.story[session.getState().story.step]!.focus
  assert.equal(told.length > 1, true)

  press(session, 'ArrowDown')
  const first = session.getState().focus
  assert.equal(first.length, 1, 'from nothing in focus, an arrow lands on a node')
  assert.equal(press(session, 'ArrowRight'), true)
  assert.equal(session.getState().focus.length, 1)
  assert.notDeepEqual(session.getState().focus, first, 'Right walks to another node, as Shift with Right does in Story')

  // A node that step tells is focused alone: no step takes the focus back to its three, and B pulls nothing back to it.
  session.getState().focusOn(told[0]!)
  const on = session.getState()
  assert.deepEqual([on.focus, on.story.detour], [[told[0]], told[0]])
  for (const key of ['3', ' ', 'Home', 'End', 'b']) {
    press(session, key)
    assert.deepEqual([session.getState().focus, session.getState().story.step], [[told[0]], on.story.step], `${key} moves nothing in Free Roam`)
  }

  press(session, 'Enter')
  assert.equal(session.getState().nodeOf.has(session.getState().code!), true, 'Enter opens the code of the node in focus')
  press(session, 'Enter')
  assert.equal(session.getState().code, null)
  session.getState().startNote('comment')
  assert.deepEqual(session.getState().editor?.target, { kind: 'node', node: told[0] }, 'a comment is about the node in focus')
})

test('the mode chosen last is remembered: the next review and the same one after a reload open in it, and an older saved state opens in Story', () => {
  const storage = memoryStorage()
  createSession(sample, createReviewMemory(storage)).getState().setMode('roam')

  const reloaded = createSession(sample, createReviewMemory(storage)).getState()
  assert.deepEqual([reloaded.mode, reloaded.focus, reloaded.story.whole], ['roam', [], true], 'it opens in Free Roam, at its start')
  const another = createSession({ ...sample, id: 'change:hobkin:another', snapshot: 'another-snapshot' }, createReviewMemory(storage)).getState()
  assert.equal(another.mode, 'roam')

  // What an older window saved has no mode, and a hand edit can hold anything: both open in Story, the rest kept.
  for (const reviewMode of [undefined, 'banana']) {
    const older = memoryStorage()
    older.setItem('hobkin-client-review', JSON.stringify({ state: { reviews: {}, unsyncedNotes: {}, panelShare: 0.4, splitDiff: true, panelPinned: false, ...(reviewMode ? { reviewMode } : {}) }, version: 1 }))
    const memory = createReviewMemory(older)
    assert.deepEqual([memory.getState().reviewMode, memory.getState().panelShare, memory.getState().splitDiff], ['story', 0.4, true])
    const opened = createSession(sample, memory).getState()
    assert.deepEqual([opened.mode, opened.story.step, opened.story.whole, opened.focus], ['story', 0, false, firstFocus])
  }
})
