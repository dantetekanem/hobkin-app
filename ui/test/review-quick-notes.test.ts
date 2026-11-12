import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import type { Note } from '../src/features/review/notes/notes.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { noteByline, notesAbout, notesOnStep, sentWords } from '../src/features/review/state/quick-notes.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const nodeOf = (title: string) => sample.nodes.find((node) => node.title === title)!
const stepOf = (title: string) => sample.story.find((step) => step.title === title)!

const send = nodeOf('send')
const anchor = send.anchors[0]!
const note = (id: string, at: number, change: Partial<Note>): Note => ({ id, step: 'outcome', target: { kind: 'step' }, intent: 'comment', text: id, author: 'user', at, ...change })

test('the panel lists what was written about a node, its lines and the nodes it stands for, oldest first', () => {
  const notes = [
    note('later', 30, { target: { kind: 'node', node: send.id } }),
    note('lines', 20, { target: { kind: 'lines', fileId: anchor.fileId, side: anchor.side, startLine: anchor.startLine, endLine: anchor.startLine, hash: 'x' } }),
    note('elsewhere', 10, { target: { kind: 'lines', fileId: anchor.fileId, side: anchor.side, startLine: anchor.endLine + 400, endLine: anchor.endLine + 401, hash: 'x' } }),
    note('other node', 5, { target: { kind: 'node', node: 'A1' } }),
    note('step', 1, { target: { kind: 'step' } }),
    note('member', 40, { target: { kind: 'node', node: 'm1' } }),
  ]
  assert.deepEqual(notesAbout(notes, send).map((entry) => entry.id), ['lines', 'later'])
  // A card that stands for other nodes, as a group of folded tests does, lists theirs too.
  assert.deepEqual(notesAbout(notes, send, [{ id: 'm1', anchors: [] }]).map((entry) => entry.id), ['lines', 'later', 'member'])
  assert.deepEqual(notesOnStep(notes, 'outcome').map((entry) => entry.id), ['step', 'other node', 'elsewhere', 'lines', 'later', 'member'])

  assert.equal(noteByline({ author: 'hobkin', intent: 'question' }), 'Hobkin · Question')
  assert.equal(noteByline({ author: 'user', intent: 'comment' }), 'You · Comment')
  assert.deepEqual([sentWords({ intent: 'question', sent: 9 }), sentWords({ intent: 'comment', sent: 9 }), sentWords({ intent: 'comment' })], ['Asked Hobkin', 'Sent', 'Not sent yet'])
})

test('showNotes opens the panel beside a node or on a step, and anything else closes it', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  const { showNotes } = session.getState()

  showNotes({ node: send.id })
  assert.deepEqual(session.getState().notesShown, { kind: 'node', node: send.id })
  assert.equal(session.getState().story.step, 0, 'reading the notes of a node moves nothing')

  // A step, by its index in the story as goTo takes it: the review goes there, and the panel lists its notes.
  const runtime = stepOf('The runtime keeps the word for one turn')
  const index = sample.story.indexOf(runtime)
  showNotes({ step: index })
  assert.equal(session.getState().story.step, index)
  assert.deepEqual(session.getState().notesShown, { kind: 'step', step: runtime.id })

  // Moving on closes it: the panel belongs to what it was opened beside.
  session.getState().step(1)
  assert.equal(session.getState().notesShown, null)

  showNotes({ node: send.id })
  showNotes(null)
  assert.equal(session.getState().notesShown, null)
  for (const target of [{ node: 'missing' }, { step: sample.story.length }, { step: 1.5 }, {}]) {
    showNotes({ node: send.id })
    showNotes(target)
    assert.equal(session.getState().notesShown, null, JSON.stringify(target))
  }
})
