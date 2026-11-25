import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { escapeReview } from '../src/features/review/entry.ts'
import { pressKey, type KeyEffects, type KeyPress } from '../src/features/review/keys.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'
import { partsInFile, readLook, stepShowing } from '../src/features/review/state/look.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const effects: KeyEffects = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, proofKey: () => {}, codeKey: () => false }
const press = (session: ReturnType<typeof createSession>, key: string, shift = false, more: Partial<KeyEffects> = {}) =>
  pressKey(session.getState(), { key, shift, alt: false }, { ...effects, ...more })
/** A session in the code view, following its memory as the open review does. */
const codeSession = () => {
  const memory = createReviewMemory(memoryStorage())
  const session = createSession(sample, memory, null, { look: 'code' })
  session.connect()
  return { memory, session }
}

test('a review opens in the look it is given, Graph when none is, and I goes to the code and back to the graph where it was', () => {
  assert.equal(createSession(sample, createReviewMemory(memoryStorage())).getState().look, 'graph', 'Graph unless told otherwise')
  assert.deepEqual([readLook('code'), readLook('graph'), readLook(undefined), readLook('story')], ['code', 'graph', 'graph', 'graph'])

  const { session } = codeSession()
  assert.equal(session.getState().look, 'code')
  assert.deepEqual(session.getState().diff, { file: null, at: null, ask: 0 }, 'the code view starts on its first file')

  assert.equal(press(session, 'i'), true)
  assert.equal(session.getState().look, 'graph')
  press(session, 'ArrowRight')
  press(session, 'ArrowRight')
  const step = session.getState().story.step
  assert.equal(press(session, 'I'), true)
  assert.equal(session.getState().look, 'code')
  press(session, 'i')
  assert.deepEqual([session.getState().look, session.getState().story.step], ['graph', step], 'the graph is where it was')
})

test('from the code view O and P open the graph in their mode, from its start', () => {
  const { session } = codeSession()
  session.getState().goTo(4)
  assert.equal(press(session, 'p'), true)
  assert.deepEqual([session.getState().look, session.getState().mode, session.getState().story.step], ['graph', 'story', 0])
  session.getState().setLook('code')
  assert.equal(press(session, 'O'), true)
  assert.deepEqual([session.getState().look, session.getState().mode, session.getState().focus], ['graph', 'roam', []])
})

test('in the code view a step, a part and a note show their file and lines, and the graph follows', () => {
  const { memory, session } = codeSession()
  session.getState().goTo(3)
  assert.equal(session.getState().story.step, 3, 'the story follows')
  assert.deepEqual(session.getState().diff, { file: 'src/cli/doing.mjs', at: { side: 'added', startLine: 19, endLine: 28 }, ask: 1 })

  // Step 5 shows only unchanged code, in a file the code view does not list: the code view stays where it is.
  session.getState().goTo(5)
  assert.deepEqual([session.getState().diff.file, session.getState().diff.ask], ['src/cli/doing.mjs', 1])

  session.getState().focusOn('u8')
  assert.deepEqual(session.getState().diff, { file: 'src/cli/ui.mjs', at: { side: 'added', startLine: 2147, endLine: 2184 }, ask: 2 })

  // What would open the graph's code panel shows the code here instead.
  assert.equal(session.getState().openCode('u1'), true)
  assert.equal(session.getState().code, null, 'no code panel in the code view')
  assert.equal(session.getState().diff.file, 'src/cli/application.mjs')

  const lines = { kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 150, endLine: 152, hash: 'h' } as const
  const note = memory.getState().addNote(sample, { step: 's6', target: lines, intent: 'comment', text: 'Why here?' })!
  session.getState().showNote(note.id)
  assert.deepEqual(session.getState().diff, { file: 'src/cli/runtime.mjs', at: { side: 'added', startLine: 150, endLine: 152 }, ask: 4 })
})

test('a file shown in the code view keeps a selection on it and drops one on another file', () => {
  const { session } = codeSession()
  const lines = { kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 150, endLine: 150, hash: 'h' } as const
  session.getState().showFile('src/cli/runtime.mjs')
  session.getState().selectLines(lines)
  session.getState().showFile('src/cli/runtime.mjs', { side: 'added', startLine: 540, endLine: 573 })
  assert.equal(session.getState().selection, lines)
  session.getState().showFile('src/cli/ui.mjs')
  assert.deepEqual([session.getState().diff.file, session.getState().diff.at, session.getState().selection], ['src/cli/ui.mjs', null, null])
})

test('a note in the code view is about the selected lines, or the file, on the first step that shows them, and C on lines with a comment opens it', () => {
  const { memory, session } = codeSession()
  session.getState().showFile('src/cli/runtime.mjs')
  const lines = { kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 150, endLine: 151, hash: 'h' } as const
  session.getState().selectLines(lines)
  session.getState().startNote('comment')
  assert.deepEqual(session.getState().editor, { step: 's6', target: lines }, 'step 6 shows these lines')
  memory.getState().setDraft(sample, { intent: 'comment', text: 'Keep this short' })
  const kept = session.getState().saveNote()!
  assert.equal(kept.step, 's6')

  // The cursor on one of those lines, C opens that comment, and D starts a question.
  session.getState().selectLines({ ...lines, startLine: 151, endLine: 151 })
  session.getState().startNote('comment')
  assert.equal(session.getState().editor?.editing, kept.id)
  session.getState().closeEditor()
  session.getState().startNote('question')
  assert.equal(session.getState().editor?.editing, undefined)
  session.getState().closeEditor()

  // Lines no part covers are on the first step that shows their file.
  session.getState().selectLines({ ...lines, startLine: 1, endLine: 2 })
  session.getState().startNote('comment')
  assert.equal(session.getState().editor?.step, 's6')
  session.getState().closeEditor()

  // With nothing selected, as with the files focused, the note is about the file, through its first part.
  session.getState().selectLines(null)
  session.getState().startNote('question')
  assert.deepEqual(session.getState().editor, { step: 's6', target: { kind: 'node', node: 'u5' } })
})

test('the parts of a file and the step that shows a note, as the code view reads them', () => {
  const ui = sample.files.find((file) => file.id === 'src/cli/ui.mjs')!
  assert.deepEqual(partsInFile(sample.nodes, ui).map((node) => node.id), ['u7', 'u8', 'c2'], 'changed parts first, unchanged code after')
  const steps = sample.story
  const expand = (id: string) => [id]
  const nodeOf = (id: string) => sample.nodes.find((node) => node.id === id)
  assert.equal(stepShowing(steps, expand, nodeOf, { kind: 'lines', fileId: 'src/cli/ui.mjs', side: 'deleted', startLine: 2150, endLine: 2150, hash: '' }), 's10')
  assert.equal(stepShowing(steps, expand, nodeOf, { kind: 'lines', fileId: 'src/cli/ui.mjs', side: 'added', startLine: 2070, endLine: 2071, hash: '' }), 's9')
  assert.equal(stepShowing(steps, expand, nodeOf, { kind: 'node', node: 'u9' }), 's13')
  assert.equal(stepShowing(steps, expand, nodeOf, { kind: 'lines', fileId: 'nowhere.ts', side: 'added', startLine: 1, endLine: 1, hash: '' }), null)
})

test('Z in the code view marks every part of a file seen, again takes the marks off, and the graph has them', () => {
  const { session } = codeSession()
  assert.equal(session.getState().toggleFileSeen('src/cli/runtime.mjs'), true)
  assert.deepEqual(['u5', 'u6'].map((id) => session.getState().seen.has(id)), [true, true])
  session.getState().setLook('graph')
  assert.equal(session.getState().seen.has('u5'), true, 'the graph shares the marks')
  session.getState().setLook('code')
  session.getState().toggleFileSeen('src/cli/runtime.mjs')
  assert.deepEqual(['u5', 'u6'].map((id) => session.getState().seen.has(id)), [false, false])
  assert.equal(session.getState().toggleFileSeen('nowhere.ts'), false)

  // Going to a step from the panel marks nothing in the code view: a file is seen when the reviewer says so.
  session.getState().goTo(6)
  assert.deepEqual(['u5', 'u6'].map((id) => session.getState().seen.has(id)), [false, false])
})

test('the code view opens where the graph code panel was, and the graph keeps no selection of the code view', () => {
  const memory = createReviewMemory(memoryStorage())
  const session = createSession(sample, memory)
  session.getState().goTo(6)
  session.getState().openCode('u6')
  session.getState().setLook('code')
  assert.deepEqual([session.getState().code, session.getState().diff.file, session.getState().diff.at], [null, 'src/cli/runtime.mjs', { side: 'added', startLine: 540, endLine: 573 }])
  session.getState().selectLines({ kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 540, endLine: 540, hash: 'h' })
  session.getState().setLook('graph')
  assert.equal(session.getState().selection, null)
})

test('a review left for another page comes back in the same look, on the same file', () => {
  const { memory, session } = codeSession()
  session.getState().showFile('src/cli/ui.mjs')
  const place = session.getState().placeNow()
  assert.deepEqual([place.look, place.file], ['code', 'src/cli/ui.mjs'])
  const back = createSession(sample, memory, place, { look: 'graph' })
  assert.deepEqual([back.getState().look, back.getState().diff.file], ['code', 'src/cli/ui.mjs'], 'the place wins over the setting')
  const older = createSession(sample, memory, { ...place, look: undefined, file: undefined }, { look: 'code' })
  assert.deepEqual([older.getState().look, older.getState().diff.file], ['graph', null], 'a place kept before the code view was in the graph')
})

test('while the code view is the look its own keys go to it first, with Option, and the rest are the review own', () => {
  const { session } = codeSession()
  const heard: KeyPress[] = []
  const codeKey = (press: KeyPress) => {
    heard.push(press)
    return ['ArrowDown', 'Enter', 'z', 'j', ']'].includes(press.key)
  }
  const verdicts: string[] = []
  for (const key of ['ArrowDown', 'Enter', 'z', 'j', ']']) assert.equal(press(session, key, false, { codeKey }), true, key)
  assert.equal(pressKey(session.getState(), { key: 'ArrowUp', shift: false, alt: true }, { ...effects, codeKey }), false, 'Option is the code view to use or leave')
  assert.deepEqual(heard.at(-1), { key: 'ArrowUp', shift: false, alt: true })
  assert.equal(press(session, 'a', false, { codeKey, verdict: (kind) => void verdicts.push(kind) }), true)
  assert.deepEqual(verdicts, ['approve'])
  press(session, 'c', false, { codeKey })
  assert.ok(session.getState().editor, 'C writes a comment')
  session.getState().closeEditor()
  const outline = session.getState().outline
  assert.equal(press(session, 'l', false, { codeKey }), true)
  assert.equal(session.getState().outline, outline, 'the outline is the graph own')
  assert.equal(press(session, '4', false, { codeKey }), false, 'no step keys in the code view')
  assert.equal(session.getState().look, 'code')
})

test('Escape in the code view closes the note, the finder, the proof, then the code view selection, then the review', () => {
  const { session } = codeSession()
  let closed = 0
  let selected = true
  const collapse = () => {
    const had = selected
    selected = false
    return had
  }
  const escape = () => escapeReview(session.getState(), () => void (closed += 1), collapse)

  session.getState().startNote('comment')
  session.getState().openFinder()
  session.getState().openProof('run-1')
  escape()
  assert.equal(session.getState().editor, null)
  escape()
  assert.equal(session.getState().finder, false)
  escape()
  assert.equal(session.getState().proof, null)
  escape()
  assert.deepEqual([selected, closed], [false, 0], 'a selection of several lines goes back to the cursor')
  escape()
  assert.equal(closed, 1)
})

test('I opens the code view only where one takes its keys', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  const { codeKey: _, ...noCodeView } = effects
  assert.equal(pressKey(session.getState(), { key: 'i', shift: false, alt: false }, noCodeView), false)
  assert.equal(session.getState().look, 'graph')
})
