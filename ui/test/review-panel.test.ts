import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { inputKey, pressKey } from '../src/features/review/keys.ts'
import { mergeHostNotes } from '../src/features/review/notes/merge.ts'
import type { Note, NoteEntry } from '../src/features/review/notes/notes.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const effects = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, proofKey: () => {} }

test("a note hobkin left on the host joins the window's notes, unless the window already has it or removed it", () => {
  const note = (id: string, text: string): Note => ({ id, step: 's1', target: { kind: 'step' }, intent: 'comment', text, author: 'hobkin', at: 1 })
  const local: NoteEntry[] = [{ op: 'put', note: note('n1', 'Changed here.') }, { op: 'remove', id: 'n2' }]
  const host: NoteEntry[] = [
    { op: 'put', note: note('n1', 'As the host had it.') },
    { op: 'put', note: note('n2', 'Removed here.') },
    { op: 'put', note: note('n3', 'New from hobkin.') },
  ]
  const merged = mergeHostNotes(local, host)
  assert.deepEqual(merged, [...local, { op: 'put', note: note('n3', 'New from hobkin.') }])
  assert.equal(mergeHostNotes(merged, host), merged, 'nothing new leaves the log as it is')
})

test('A approves, M approves and merges, and X talks to the agent', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  const asked: string[] = []
  for (const key of ['a', 'M', 'x']) {
    const used = pressKey(session.getState(), { key, shift: false, alt: false }, { ...effects, verdict: (kind) => asked.push(kind) })
    assert.equal(used, true)
  }
  assert.deepEqual(asked, ['approve', 'approve-merge', 'request-changes'])
})

test('T is the key of the proof beside the review, and Shift+T of its full page', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  const pressed: boolean[] = []
  for (const [key, shift] of [['t', false], ['T', false], ['T', true]] as const) {
    assert.equal(pressKey(session.getState(), { key, shift, alt: false }, { ...effects, proofKey: (shifted) => pressed.push(shifted) }), true)
  }
  assert.deepEqual(pressed, [false, false, true])
})

test("N and C start a comment, D a question to discuss with the agent, and H a question to hobkin, in the review's input, about what the reviewer is on", () => {
  const onStep = { step: sample.story[0]!.id, target: { kind: 'step' } }
  for (const [key, intent, editor] of [['n', 'comment', onStep], ['C', 'comment', onStep], ['d', 'question', onStep], ['H', 'question', { ...onStep, ask: true }]] as const) {
    const memory = createReviewMemory(memoryStorage())
    const session = createSession(sample, memory)
    assert.equal(pressKey(session.getState(), { key, shift: false, alt: false }, effects), true, key)
    assert.deepEqual(session.getState().editor, editor, key)
    assert.equal(memory.getState().of(sample).draft?.intent, intent, key)
  }
})

test('X presses Talk to agent, and asks for the verdict itself where nothing shows Talk to agent', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  const said: string[] = []
  const verdict = (kind: string) => void said.push(`verdict ${kind}`)
  assert.equal(pressKey(session.getState(), { key: 'x', shift: false, alt: false }, { ...effects, verdict, talk: () => void said.push('talk') }), true)
  assert.equal(pressKey(session.getState(), { key: 'X', shift: false, alt: false }, { ...effects, verdict }), true)
  assert.deepEqual(said, ['talk', 'verdict request-changes'])
})

test("in the review's input Enter sends, Shift with Enter starts a line, and Escape gives the keyboard back to the review", () => {
  assert.equal(inputKey({ key: 'Enter', shift: false }), 'send')
  assert.equal(inputKey({ key: 'Enter', shift: true }), 'type')
  // A word still being composed takes its Enter.
  assert.equal(inputKey({ key: 'Enter', shift: false, composing: true }), 'type')
  assert.equal(inputKey({ key: 'Escape', shift: false }), 'leave')
  // Every other key is a letter of the words: none walks the graph.
  assert.equal(inputKey({ key: 'n', shift: false }), 'type')
  assert.equal(inputKey({ key: 'ArrowRight', shift: false }), 'type')
})

