import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { hashLines } from '#shared/review/lines.ts'
import type { Review } from '#shared/review/types.ts'
import { countNotes, detached, discussionMessage, foldNotes, noteTarget, whereInWords, type Note, type NoteEntry } from '../src/features/review/notes/notes.ts'
import { foldSteps } from '../src/features/review/notes/steps.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const idOf = (title: string) => sample.nodes.find((node) => node.title === title)!.id
const stepOf = (title: string) => sample.story.find((step) => step.title === title)!
const runtime = stepOf('The runtime keeps the word for one turn')
const helpers = stepOf('Two helpers, one for each kind of event')
const wire = `calls:${idOf('toolDoing')}>${idOf('searchingTool')}`
const lines = { kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 176, endLine: 178, hash: hashLines('a\nb\nc', 1, 3) } as const

test('a note belongs to a step and to what the reviewer was on, and is still there after a restart', () => {
  const storage = memoryStorage()
  const memory = createReviewMemory(storage)
  const { addNote } = memory.getState()

  const first = addNote(sample, { step: runtime.id, target: { kind: 'step' }, intent: 'comment', text: '  Name the field after what it holds.  ' })
  const second = addNote(sample, { step: runtime.id, target: { kind: 'node', node: idOf('send') }, intent: 'question', text: 'Why clear the word in send and not where it is set?' })
  addNote(sample, { step: helpers.id, target: { kind: 'wire', wire }, intent: 'question', text: 'Is this the only caller?' })
  addNote(sample, { step: runtime.id, target: lines, intent: 'comment', text: 'These three lines read as one.' })
  // Nothing to say is not a note.
  assert.equal(addNote(sample, { step: runtime.id, target: { kind: 'step' }, intent: 'comment', text: '   ' }), null)

  // Closing and reopening the review, or the app, is a new store over the same storage.
  const reopened = createReviewMemory(storage).getState().notesOf(sample)
  assert.equal(reopened.length, 4)
  assert.deepEqual(
    reopened.map((note) => [note.step, note.target.kind, note.intent, note.author]),
    [
      [runtime.id, 'step', 'comment', 'user'],
      [runtime.id, 'node', 'question', 'user'],
      [helpers.id, 'wire', 'question', 'user'],
      [runtime.id, 'lines', 'comment', 'user'],
    ],
  )
  assert.equal(reopened[0]!.text, 'Name the field after what it holds.')
  assert.deepEqual([reopened[0]!.id, reopened[1]!.id], [first!.id, second!.id])
  assert.equal(new Set(reopened.map((note) => note.id)).size, 4)

  // Another review, or the same change at another head, has its own notes.
  assert.deepEqual(createReviewMemory(storage).getState().notesOf({ ...sample, snapshot: 'f'.repeat(64) }), [])
})

test('notes are a log folded by id: an edit replaces a note and a removal drops it', () => {
  const note = (id: string, text: string, at: number): Note => ({ id, step: runtime.id, target: { kind: 'step' }, intent: 'comment', text, author: 'user', at })
  const log: NoteEntry[] = [
    { op: 'put', note: note('a', 'first', 1) },
    { op: 'put', note: note('b', 'second', 2) },
    { op: 'put', note: { ...note('a', 'first, said better', 1), intent: 'question' } },
    { op: 'put', note: note('c', 'third', 3) },
    { op: 'remove', id: 'b' },
    { op: 'remove', id: 'never-there' },
  ]

  assert.deepEqual(
    foldNotes(log).map((entry) => [entry.id, entry.text, entry.intent]),
    [
      ['a', 'first, said better', 'question'],
      ['c', 'third', 'comment'],
    ],
    'the edited note keeps its place',
  )
  assert.deepEqual(foldNotes([]), [])

  // Through the store: edit and remove, then reopen.
  const storage = memoryStorage()
  const memory = createReviewMemory(storage)
  const kept = memory.getState().addNote(sample, { step: runtime.id, target: { kind: 'step' }, intent: 'comment', text: 'Keep me.' })!
  const gone = memory.getState().addNote(sample, { step: runtime.id, target: { kind: 'step' }, intent: 'comment', text: 'Drop me.' })!
  memory.getState().editNote(sample, kept.id, { text: 'Keep me, as a question.', intent: 'question' })
  memory.getState().removeNote(sample, gone.id)
  // An edit that leaves nothing to say removes the note.
  const emptied = memory.getState().addNote(sample, { step: runtime.id, target: { kind: 'step' }, intent: 'comment', text: 'Soon empty.' })!
  memory.getState().editNote(sample, emptied.id, { text: ' ' })

  const after = createReviewMemory(storage).getState().notesOf(sample)
  assert.deepEqual(after.map((entry) => [entry.id, entry.text, entry.intent]), [[kept.id, 'Keep me, as a question.', 'question']])
})

test('counts the notes of each step, node, wire and line range, for their markers', () => {
  const note = (id: string, step: string, target: Note['target'], intent: Note['intent'] = 'comment'): Note => ({ id, step, target, intent, text: 'x', author: 'user', at: 1 })
  const counts = countNotes([
    note('1', runtime.id, { kind: 'step' }),
    note('2', runtime.id, { kind: 'node', node: idOf('send') }, 'question'),
    note('3', runtime.id, { kind: 'node', node: idOf('send') }),
    note('4', helpers.id, { kind: 'wire', wire }, 'question'),
    note('5', runtime.id, lines),
    note('6', runtime.id, lines, 'question'),
  ])

  // A step counts every note taken on it, whatever the note points at.
  assert.deepEqual(counts.steps[runtime.id], { comments: 3, questions: 2 })
  assert.deepEqual(counts.steps[helpers.id], { comments: 0, questions: 1 })
  assert.equal(counts.steps[stepOf('The row').id], undefined)
  assert.deepEqual(counts.nodes, { [idOf('send')]: 2 })
  assert.deepEqual(counts.wires, { [wire]: 1 })
  assert.deepEqual(counts.lines, [{ fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 176, endLine: 178, count: 2 }])
  assert.deepEqual([counts.comments, counts.questions], [3, 3])
})

test('says in words what a note is about, so it can be read without the graph', () => {
  const note = (target: Note['target'], step = runtime.id): Note => ({ id: 'n', step, target, intent: 'question', text: 'x', author: 'user', at: 1 })
  const at = sample.story.indexOf(runtime) + 1

  assert.equal(whereInWords(sample, note({ kind: 'step' })), `Step ${at} of ${sample.story.length}, "The runtime keeps the word for one turn".`)
  assert.equal(whereInWords(sample, note({ kind: 'node', node: idOf('send') })), `Step ${at} of ${sample.story.length}, "The runtime keeps the word for one turn". About send, code in src/cli/runtime.mjs.`)
  assert.equal(
    whereInWords(sample, note({ kind: 'wire', wire }, helpers.id)),
    `Step ${sample.story.indexOf(helpers) + 1} of ${sample.story.length}, "Two helpers, one for each kind of event". About the wire from toolDoing to searchingTool: toolDoing calls searchingTool.`,
  )
  assert.match(whereInWords(sample, note(lines)), /About src\/cli\/runtime\.mjs, lines 176 to 178, as changed\.$/)
  assert.match(whereInWords(sample, note({ ...lines, side: 'deleted', startLine: 9, endLine: 9 })), /About src\/cli\/runtime\.mjs, line 9, as it was before the change\.$/)
  // A note whose step or target is no longer in the review still says what it can.
  assert.equal(whereInWords(sample, note({ kind: 'node', node: 'gone' }, 'gone')), 'A step that is no longer in the story. About a node that is no longer in the review.')
})

test('hands the questions over as one message, each with its step and target in words', () => {
  const storage = memoryStorage()
  const memory = createReviewMemory(storage)
  const { addNote } = memory.getState()
  addNote(sample, { step: runtime.id, target: { kind: 'step' }, intent: 'comment', text: 'A comment is not a question.' })
  const why = addNote(sample, { step: runtime.id, target: { kind: 'node', node: idOf('send') }, intent: 'question', text: 'Why clear the word in send?\nIt is set in connectMain.' })!
  const only = addNote(sample, { step: helpers.id, target: { kind: 'wire', wire }, intent: 'question', text: 'Is this the only caller?' })!

  const message = discussionMessage(sample, memory.getState().notesOf(sample))!
  assert.equal(
    message,
    [
      `Two questions from my review of "${sample.change.title}" (${sample.change.project}, ${sample.change.branch}, at ${sample.change.head.slice(0, 7)}).`,
      '',
      // In the order of the story, not the order they were written in.
      `1. Step ${sample.story.indexOf(helpers) + 1} of ${sample.story.length}, "Two helpers, one for each kind of event". About the wire from toolDoing to searchingTool: toolDoing calls searchingTool.`,
      '   Is this the only caller?',
      '',
      `2. Step ${sample.story.indexOf(runtime) + 1} of ${sample.story.length}, "The runtime keeps the word for one turn". About send, code in src/cli/runtime.mjs.`,
      '   Why clear the word in send?',
      '   It is set in connectMain.',
    ].join('\n'),
  )
  assert.equal(message.includes('A comment is not a question.'), false, 'comments stay for the verdict')

  // Once handed over, a question is not sent again. A new one is.
  memory.getState().markSent(sample, [why.id, only.id], 1000)
  assert.equal(discussionMessage(sample, memory.getState().notesOf(sample)), null)
  assert.deepEqual(createReviewMemory(storage).getState().notesOf(sample).map((note) => note.sent), [undefined, 1000, 1000])
  addNote(sample, { step: runtime.id, target: { kind: 'step' }, intent: 'question', text: 'One more.' })
  assert.match(discussionMessage(sample, memory.getState().notesOf(sample))!, /^One question from my review/)
})

test('a new note is about the most particular thing the reviewer is on', () => {
  const on = { step: runtime.id, detour: null, wire: null, selection: null } as const
  assert.deepEqual(noteTarget(on), { kind: 'step' })
  assert.deepEqual(noteTarget({ ...on, detour: idOf('send') }), { kind: 'node', node: idOf('send') })
  assert.deepEqual(noteTarget({ ...on, detour: idOf('send'), wire }), { kind: 'wire', wire })
  assert.deepEqual(noteTarget({ ...on, detour: idOf('send'), wire, selection: lines }), lines)
})

test('a note on lines that have changed since is kept, and marked as detached', () => {
  const text = 'one\ntwo\nthree\nfour\n'
  const attached: Note = { id: 'a', step: runtime.id, target: { kind: 'lines', fileId: 'f.ts', side: 'added', startLine: 2, endLine: 3, hash: hashLines(text, 2, 3) }, intent: 'comment', text: 'x', author: 'user', at: 1 }
  const onStep: Note = { ...attached, id: 'b', target: { kind: 'step' } }

  assert.deepEqual(detached([attached, onStep], () => text), [])
  assert.deepEqual(detached([attached, onStep], () => 'one\ntwo\n3\nfour\n'), ['a'])
  assert.deepEqual(detached([attached, onStep], () => null), ['a'], 'a file that is gone detaches its notes too')
})

test('a long story folds the steps far from the current one into ranges', () => {
  const shape = (items: ReturnType<typeof foldSteps>) => items.map((item) => (item.type === 'step' ? item.index + 1 : `${item.from + 1} to ${item.to + 1}`))

  // A story that fits is shown whole.
  assert.deepEqual(shape(foldSteps(15, 6)), Array.from({ length: 15 }, (_, index) => index + 1))

  // A long one keeps its ends, the steps around the current one, and folds the rest.
  assert.deepEqual(shape(foldSteps(49, 24)), [1, 2, '3 to 20', 21, 22, 23, 24, 25, 26, 27, 28, 29, '30 to 47', 48, 49])
  assert.deepEqual(shape(foldSteps(49, 0)), [1, 2, 3, 4, 5, '6 to 47', 48, 49])
  assert.deepEqual(shape(foldSteps(49, 48)), [1, 2, '3 to 44', 45, 46, 47, 48, 49])
  // A fold says how many steps it holds.
  const fold = foldSteps(49, 24).find((item) => item.type === 'fold')!
  assert.deepEqual(fold, { type: 'fold', from: 2, to: 19, count: 18 })
  // A range the reviewer opened stays open, and a gap of one or two steps is not worth folding.
  assert.deepEqual(shape(foldSteps(49, 24, new Set([2]))).slice(0, 6), [1, 2, 3, 4, 5, 6])
  assert.deepEqual(shape(foldSteps(20, 8)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, '14 to 18', 19, 20])
})

test('an open review writes a note about what the reviewer is on, and keeps following its notes after a double mount', () => {
  const memory = createReviewMemory(memoryStorage())
  const session = createSession(sample, memory)
  // React mounts twice in development: connect, stop, connect again.
  session.connect()()
  const stop = session.connect()

  const index = sample.story.indexOf(runtime)
  session.getState().goTo(index)
  session.getState().startNote('question')
  memory.getState().setDraft(sample, { intent: 'question', text: 'Why here?' })
  session.getState().saveNote()
  assert.deepEqual(session.getState().notes.map((note) => [note.step, note.target.kind, note.intent, note.text]), [[runtime.id, 'step', 'question', 'Why here?']])
  assert.deepEqual(session.getState().counts.steps[runtime.id], { comments: 0, questions: 1 })

  // Off the path, a note is about the node in focus.
  session.getState().focusOn(idOf('send'))
  session.getState().startNote('comment')
  memory.getState().setDraft(sample, { intent: 'comment', text: 'Name it.' })
  session.getState().saveNote()
  assert.deepEqual(session.getState().counts.nodes, { [idOf('send')]: 1 })

  // Escape leaves the editor and the words stay for next time.
  session.getState().startNote('comment')
  memory.getState().setDraft(sample, { intent: 'comment', text: 'Half a thought' })
  session.getState().closeEditor()
  assert.equal(session.getState().editor, null)
  session.getState().startNote('comment')
  assert.equal(memory.getState().of(sample).draft?.text, 'Half a thought')

  stop()
  memory.getState().addNote(sample, { step: runtime.id, target: { kind: 'step' }, intent: 'comment', text: 'After closing.' })
  assert.equal(session.getState().notes.length, 2, 'a closed review no longer follows')
})
