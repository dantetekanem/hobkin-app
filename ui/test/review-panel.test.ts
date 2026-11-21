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
const effects = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, openModelRun: () => {} }

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

test('A approves, M approves and merges, and X sends the fixes', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  const asked: string[] = []
  for (const key of ['a', 'M', 'x']) {
    const used = pressKey(session.getState(), { key, shift: false, alt: false }, { ...effects, verdict: (kind) => asked.push(kind) })
    assert.equal(used, true)
  }
  assert.deepEqual(asked, ['approve', 'approve-merge', 'request-changes'])
})

test("T opens the run of the change's first TLA+ model check in the panel", () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  let opened = 0
  for (const key of ['t', 'T']) assert.equal(pressKey(session.getState(), { key, shift: false, alt: false }, { ...effects, openModelRun: () => (opened += 1) }), true)
  assert.equal(opened, 2)
})

test("N and C start a comment, and D and H a question to hobkin, in the review's input, about what the reviewer is on", () => {
  for (const [key, intent] of [['n', 'comment'], ['C', 'comment'], ['d', 'question'], ['H', 'question']] as const) {
    const memory = createReviewMemory(memoryStorage())
    const session = createSession(sample, memory)
    assert.equal(pressKey(session.getState(), { key, shift: false, alt: false }, effects), true, key)
    assert.deepEqual(session.getState().editor, { step: sample.story[0]!.id, target: { kind: 'step' } }, key)
    assert.equal(memory.getState().of(sample).draft?.intent, intent, key)
  }
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

