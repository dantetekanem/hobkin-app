import assert from 'node:assert/strict'
import { test } from 'node:test'
import { draftReducer, editorEnter, emptyDraft, hobkinPrompt, type Attachment, type DraftAction, type DraftState } from '../src/features/chat/draft.ts'
import { startArgs } from '../src/features/hobkins/rules.ts'
import { useNewHobkin } from '../src/features/hobkins/store.ts'

const after = (state: DraftState, ...actions: DraftAction[]) => actions.reduce(draftReducer, state)
const picture: Attachment = { id: 'p1', name: 'chart.png', mimeType: 'image/png', preview: 'blob:chart', handle: 'h1' }
const press = (keys: Partial<Record<'ctrl' | 'meta' | 'shift', boolean>>) => editorEnter({ ctrl: false, meta: false, shift: false, ...keys })

test('in the prompt editor Shift+Control+Enter gives the prompt to a durable hobkin, and Control or Command+Enter still sends it to hobkin', () => {
  assert.equal(press({ ctrl: true, shift: true }), 'durable')
  assert.equal(press({ ctrl: true }), 'send')
  assert.equal(press({ meta: true }), 'send')
  assert.equal(press({ meta: true, shift: true }), 'send', 'Shift+Command+Enter sends to hobkin as before')
  assert.equal(press({}), null, 'Enter alone adds a line')
  assert.equal(press({ shift: true }), null)
})

test('the sheet gets the words as they are written and how many images stay behind, and nothing without words', () => {
  assert.deepEqual(hobkinPrompt({ text: '  Plan the release\n\n1. Tag it ', attachments: [] }), { text: '  Plan the release\n\n1. Tag it ', images: 0 })
  assert.deepEqual(hobkinPrompt({ text: 'Look at this', attachments: [picture] }), { text: 'Look at this', images: 1 })
  assert.equal(hobkinPrompt({ text: ' \n ', attachments: [picture] }), null, 'images alone cannot start one: hobkin.start takes no images')
})

test('Start sends the prompt as the first message, and with no prompt it sends none as before', () => {
  const engine = { kind: 'tier', tier: 'mid' } as const
  assert.deepEqual(startArgs({ cwd: '~', engine, text: '  Plan the release\n' }), { cwd: '~', engine, text: 'Plan the release' })
  assert.deepEqual(startArgs({ cwd: '~', engine }), { cwd: '~', engine })
  assert.deepEqual(startArgs({ cwd: '~', engine, text: '  ' }), { cwd: '~', engine })
})

test('the words leave the editor only once the hobkin started, and its images stay in the draft', () => {
  const editor = after(emptyDraft, { type: 'typed', text: 'Plan the release' }, { type: 'attached', attachment: picture }, { type: 'editor-toggled' })
  const gone = after(editor, { type: 'handed-off', text: 'Plan the release' })
  assert.deepEqual([gone.place, gone.leaving, gone.text, gone.from], ['input', false, '', null])
  assert.deepEqual(gone.attachments, [picture], 'hobkin.start takes no images, so they wait in the draft')
  assert.deepEqual(gone.sent, ['Plan the release'], 'Up brings it back, as for any message sent')

  // Words that came into the draft while the sheet was open are not lost with the prompt.
  const grown = after(editor, { type: 'stopped', unsent: ['Earlier words'] })
  const kept = after(grown, { type: 'handed-off', text: 'Plan the release' })
  assert.equal(kept.text, grown.text)
  assert.equal(kept.place, 'input')
})

test('a sheet closed or refused leaves the draft alone, and Command+N later opens it with no prompt', () => {
  let handedOff = 0
  const sheet = useNewHobkin.getState()
  sheet.openSheet({ text: 'Plan the release', images: 0, onStarted: () => handedOff++ })
  assert.equal(useNewHobkin.getState().prompt?.text, 'Plan the release')

  // Closed, or a start the host refused: Start never got to remember a hobkin, so the editor keeps its words.
  useNewHobkin.getState().closeSheet()
  assert.equal(handedOff, 0)
  useNewHobkin.getState().openSheet()
  assert.equal(useNewHobkin.getState().prompt, null, 'Command+N carries no old prompt')

  // Started: the prompt went with it, once.
  useNewHobkin.getState().openSheet({ text: 'Plan the release', images: 0, onStarted: () => handedOff++ })
  useNewHobkin.getState().remember({ id: 'h1' }, '~', { kind: 'tier', tier: 'mid' })
  assert.equal(handedOff, 1)

  // Started from Command+N, there is nothing to hand off.
  useNewHobkin.getState().openSheet()
  useNewHobkin.getState().remember({ id: 'h2' }, '~', { kind: 'tier', tier: 'mid' })
  assert.equal(handedOff, 1)
})
