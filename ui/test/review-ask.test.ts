import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Units } from '#shared/review/assessment.ts'
import type { Review } from '#shared/review/types.ts'
import { useView } from '../src/app/view-store.ts'
import { pressKey, type KeyEffects } from '../src/features/review/keys.ts'
import { askHobkin, changeAsk, questionAsk, submitNote, type AskCommand } from '../src/features/review/panel/ask.ts'
import { whatMatters } from '../src/features/review/panel/sidebar.ts'
import { toStepUnit } from '../src/features/review/reading/model.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const units = JSON.parse(readFileSync(new URL('../../packages/change-review/skills/change-review/examples/units.json', import.meta.url), 'utf8')) as Units
const review = { ...sample, id: 'change:hobkin:7d02c9', memoryScope: 'host:/home' } as Review

/** A host that takes every message, and the calls it got. Nothing is sent anywhere. */
function host(answer: (args: unknown) => { id: string; queued: boolean } = () => ({ id: 'm1', queued: false })) {
  const calls: { name: string; args: unknown }[] = []
  const command: AskCommand = async (name, args) => {
    calls.push({ name, args })
    return answer(args)
  }
  return { command, calls }
}

/** An open review with the user's attention: the canvas has slid over the chat, and only a sliver of it shows. */
function reviewing() {
  useView.setState({ screen: 'review', canvasEngaged: true })
  const memory = createReviewMemory(memoryStorage())
  const session = createSession(review, memory)
  session.connect()
  return { memory, session }
}

const chatInView = () => useView.getState().canvasEngaged === false

test("a quick Ask link sends the unit's question, or what would change its level, to hobkin with the step and the node", async () => {
  const unit = toStepUnit(units.units[0]!)
  const question = questionAsk(unit, unit.questions[0]!)
  assert.equal(question, 'About "round_money changes its rounding mode for every caller, flag on or off": Is half-even rounding meant to apply to existing totals, or only to per-line tax?')
  const change = changeAsk(unit, unit.wouldChange[1]!)
  assert.equal(
    change,
    'About "round_money changes its rounding mode for every caller, flag on or off": the change review says this would leave it shown to work: Also branch on `:per_line_tax_rounding` at `round_money:35`, keeping the old line as the flag-off path. How would we do it?',
  )
  assert.match(changeAsk(unit, unit.wouldChange[0]!), /would leave it not shown by a test: Add a job test/)
  // Words that end without a stop get one, and a unit with no claim is asked about as it is.
  assert.equal(questionAsk({}, { text: 'Who reads the old key' }), 'Who reads the old key.')

  const { session } = reviewing()
  session.getState().goTo(4)
  const step = review.story[4]!
  // The step has two nodes in focus, and the code panel shows the second.
  const shown = step.focus[1]!
  const { command, calls } = host()

  // A link in the code panel names the node whose code is shown.
  assert.equal(await askHobkin(session, command, question, { node: shown }), true)
  assert.deepEqual(calls, [{ name: 'conversation.send', args: { text: question, review: { id: review.id, step: step.id, node: shown } } }])
  // Otherwise the node the reviewer is on: the one they pointed at, else the first in focus. Its words are trimmed.
  assert.equal(await askHobkin(session, command, '  Why here?  '), true)
  assert.deepEqual(calls.at(-1)?.args, { text: 'Why here?', review: { id: review.id, step: step.id, node: step.focus[0] } })
  assert.deepEqual(session.getState().asks.map((ask) => [ask.text, ask.state]), [[question, 'taken'], ['Why here?', 'taken']])
})

test("a message to hobkin from the review brings hobkin's chat into view to answer it, and nothing without words does", async () => {
  const { session } = reviewing()
  const { command, calls } = host()
  assert.equal(await askHobkin(session, command, '   '), false)
  assert.equal(calls.length, 0)
  assert.equal(chatInView(), false, 'nothing went, so the review keeps the room')

  assert.equal(await askHobkin(session, command, 'Is this safe?'), true)
  assert.equal(chatInView(), true, 'the chat slides back beside the review, wide enough to read the answer')
})

test('a message hobkin cannot take says why, and a queued one says it waits', async () => {
  const { session } = reviewing()
  const failing: AskCommand = async () => {
    throw new Error('hobkin is not running.')
  }
  assert.equal(await askHobkin(session, failing, 'Is this safe?'), false)
  assert.deepEqual(session.getState().asks.map(({ text, state, error }) => ({ text, state, error })), [{ text: 'Is this safe?', state: 'failed', error: 'hobkin is not running.' }])
  const { command } = host(() => ({ id: 'm2', queued: true }))
  await askHobkin(session, command, 'And now?')
  assert.equal(session.getState().asks.at(-1)?.state, 'queued')
})

test('a quick link in what matters sends its words to hobkin with the step and the node', async () => {
  const { session } = reviewing()
  session.getState().goTo(4)
  const step = review.story[4]!
  const matters = whatMatters(review, { story: '', summary: { level: 'high', critical: false, needsYou: 1, worthALook: 0, safe: 0, storyBy: 'host', at: '' }, units }, review.story, [])
  const words = matters.units[0]!.asks
  const { command, calls } = host()

  assert.equal(await askHobkin(session, command, words), true)
  assert.deepEqual(calls, [{ name: 'conversation.send', args: { text: words, review: { id: review.id, step: step.id, node: step.focus[0] } } }])
  assert.equal(chatInView(), true)
})

test("a comment written in the review's input is kept on what the reviewer is on, nothing goes to hobkin, and the keyboard goes back to the review", async () => {
  const { memory, session } = reviewing()
  session.getState().goTo(4)
  const step = review.story[4]!
  const { command, calls } = host()
  const send = (text: string) => askHobkin(session, command, text)

  session.getState().startNote('comment')
  memory.getState().setDraft(review, { intent: 'comment', text: 'Name it after what it holds.' })
  assert.equal(await submitNote(session, memory, send), 'review')
  assert.deepEqual(session.getState().notes.map((note) => [note.step, note.intent, note.text, note.sent ?? null]), [[step.id, 'comment', 'Name it after what it holds.', null]])
  assert.equal(calls.length, 0)
  assert.equal(chatInView(), false, 'a comment waits for the verdict, so the review keeps the room')
  assert.equal(session.getState().editor, null)
  assert.equal(memory.getState().of(review).draft, null)
})

test("a question asked of hobkin in the review's input goes to hobkin with the step and the node, brings the chat into view, and the keyboard stays in the input", async () => {
  const { memory, session } = reviewing()
  session.getState().goTo(4)
  const step = review.story[4]!
  const { command, calls } = host()
  const send = (text: string) => askHobkin(session, command, text)

  session.getState().startNote('question', { ask: true })
  memory.getState().setDraft(review, { intent: 'question', text: '  Why is this safe?  ' })
  assert.equal(await submitNote(session, memory, send), 'input')
  assert.deepEqual(calls, [{ name: 'conversation.send', args: { text: 'Why is this safe?', review: { id: review.id, step: step.id, node: step.focus[0] } } }])
  assert.equal(chatInView(), true)
  // It is kept as a question hobkin was asked, so the step still counts it.
  const [note] = session.getState().notes
  assert.deepEqual([note?.intent, note?.text, typeof note?.sent], ['question', 'Why is this safe?', 'number'])
  assert.deepEqual(session.getState().counts.steps[step.id], { comments: 0, questions: 1 })
  // The input is empty and ready for the next question, about the same place.
  assert.deepEqual(memory.getState().of(review).draft, { intent: 'question', text: '' })
  assert.deepEqual(session.getState().editor, { step: step.id, target: { kind: 'step' }, ask: true })
})

test("a question to discuss is kept for the agent with the comments: nothing goes to hobkin, and the keyboard goes back to the review", async () => {
  const { memory, session } = reviewing()
  session.getState().goTo(4)
  const step = review.story[4]!
  const { command, calls } = host()
  const send = (text: string) => askHobkin(session, command, text)

  session.getState().startNote('question')
  memory.getState().setDraft(review, { intent: 'question', text: 'Why a lock and not a retry?' })
  assert.equal(await submitNote(session, memory, send), 'review')

  assert.deepEqual(session.getState().notes.map((note) => [note.step, note.intent, note.text, note.sent ?? null]), [[step.id, 'question', 'Why a lock and not a retry?', null]])
  assert.equal(calls.length, 0)
  assert.equal(chatInView(), false)
  assert.equal(session.getState().editor, null)
})

test('C writes a comment, D a question to discuss with the agent, and H a question asked of hobkin at once', () => {
  const { session } = reviewing()
  const effects: KeyEffects = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, proofKey: () => {} }
  const press = (key: string) => pressKey(session.getState(), { key, shift: false, alt: false }, effects)
  const modeAfter = (key: string) => {
    press(key)
    const { editor } = session.getState()
    session.getState().closeEditor()
    return editor?.ask === true ? 'ask' : 'kept'
  }

  assert.deepEqual(['c', 'n', 'd', 'h', 'H'].map(modeAfter), ['kept', 'kept', 'kept', 'ask', 'ask'])
})

test('a question hobkin cannot take waits as a question not asked yet, and so does one where hobkin is not connected', async () => {
  const { memory, session } = reviewing()
  const failing: AskCommand = async () => {
    throw new Error('hobkin is not running.')
  }
  session.getState().startNote('question', { ask: true })
  memory.getState().setDraft(review, { intent: 'question', text: 'Is this tested?' })
  assert.equal(await submitNote(session, memory, (text) => askHobkin(session, failing, text)), 'input')
  assert.deepEqual(session.getState().notes.map((note) => [note.intent, note.text, note.sent ?? null]), [['question', 'Is this tested?', null]])
  assert.equal(session.getState().asks.at(-1)?.error, 'hobkin is not running.')

  // A sample review has no hobkin to send to: the question is kept, and the keyboard goes back to the review.
  useView.setState({ canvasEngaged: true })
  session.getState().startNote('question', { ask: true })
  memory.getState().setDraft(review, { intent: 'question', text: 'And this one?' })
  assert.equal(await submitNote(session, memory, null), 'review')
  assert.deepEqual(session.getState().notes.map((note) => [note.text, note.sent ?? null]), [['Is this tested?', null], ['And this one?', null]])
  assert.equal(chatInView(), false)
})

test('changing a question keeps the new words and sends nothing again', async () => {
  const { memory, session } = reviewing()
  const { command, calls } = host()
  const asked = memory.getState().addNote(review, { step: review.story[0]!.id, target: { kind: 'step' }, intent: 'question', text: 'Why?' })!
  memory.getState().markSent(review, [asked.id], 1)
  session.getState().editNote(asked.id)
  memory.getState().setDraft(review, { intent: 'question', text: 'Why here?', editing: asked.id })
  assert.equal(await submitNote(session, memory, (text) => askHobkin(session, command, text)), 'review')
  assert.deepEqual(session.getState().notes.map((note) => [note.text, note.sent]), [['Why here?', 1]])
  assert.equal(calls.length, 0)
})
