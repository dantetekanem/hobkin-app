import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canvasGrowth, useView } from '../src/app/view-store.ts'
import { resolveEscape, type KeyContext } from '../src/app/key-map.ts'

const view = () => useView.getState()

test('a click on an agent in the list shows its canvas to stay as it is, and the chat keeps its room', () => {
  view().openScreen('routines')
  view().previewAgent('a1', 1)
  view().openAgentCanvas('a1') // What a click on its row does.
  assert.equal(view().screen, 'agent')
  assert.equal(view().openAgent, 'a1')
  assert.equal(view().previewReturn, null, 'it stays when the list is left')
  assert.equal(canvasGrowth(view()), 0, 'the canvas does not grow over the chat')
  view().closeAgentCanvas()
  assert.equal(view().screen, 'routines')
  useView.setState({ screen: 'review', canvasEngaged: true, conversationWidth: 460 })
  assert.ok(canvasGrowth(view()) > 0, 'a review that has the user attention still takes the room')
  useView.setState({ screen: 'routines', canvasEngaged: false })
})

test("a TLA+ run opened from a review keeps the review's room, and one opened elsewhere does not take it", () => {
  useView.setState({ screen: 'work', conversationWidth: 460, canvasEngaged: false, trail: [] })
  view().openReviewFor('r1')
  const reviewing = canvasGrowth(view())
  assert.ok(reviewing > 0)
  view().openProofRun('run-1')
  assert.equal(view().screen, 'proof')
  assert.equal(canvasGrowth(view()), reviewing, 'the window stays as wide as the review was')
  view().closeProof()
  assert.equal(view().screen, 'review')
  assert.equal(canvasGrowth(view()), reviewing)

  view().closeReview()
  useView.setState({ screen: 'work', canvasEngaged: true })
  view().openProofRun('run-2')
  assert.equal(canvasGrowth(view()), 0, 'from Work it opens at the usual width')
  view().closeProof()
  useView.setState({ screen: 'routines', canvasEngaged: false, openReview: null })
})

for (const screen of ['reports', 'routines', 'actions', 'github', 'work', 'mind'] as const) {
  test(`promoting a dock preview returns to ${screen}, even after switching agents`, () => {
    useView.setState({ screen, openAgent: null, previewReturn: null, trail: [] })
    view().previewAgent('a1', 1)
    view().previewAgent('a2', 1)
    view().openAgentCanvas('a2')
    view().endAgentPreview() // The dock's blur follows the transcript pointer-down.
    assert.equal(view().screen, 'agent')
    assert.equal(view().previewReturn, null, 'a promoted canvas is no longer a preview')
    assert.equal(view().trail.at(-1)?.screen, screen)
    view().openAgentCanvas('a3')
    view().closeAgentCanvas()
    assert.equal(view().screen, screen)
    assert.equal(view().openAgent, null)
    assert.deepEqual(view().trail, [])
  })
}

test('a plain preview still ends when the list is left, and an agent opened from the list keeps its way back', () => {
  view().openScreen('routines')
  view().previewAgent('a1', 1)
  view().endAgentPreview()
  assert.equal(view().screen, 'routines')
  view().previewAgent('a2', 1)
  view().openAgentCanvas('a2') // Enter on it, which also puts the keyboard in its input.
  view().endAgentPreview()
  assert.equal(view().screen, 'agent', 'the keyboard leaving the list for the input does not leave')
  view().closeAgentCanvas()
  assert.equal(view().screen, 'routines')
})

test('rapid entry, opening and a second agent keep the original opener without waiting for motion', () => {
  view().openScreen('routines')
  view().previewAgent('a1', 1)
  view().openAgentCanvas('a1')
  assert.equal(view().openAgent, 'a1')
  view().previewAgent('a2', 1)
  view().openAgentCanvas('a2')
  view().endAgentPreview()
  assert.equal(view().openAgent, 'a2')
  assert.equal(view().trail.at(-1)?.screen, 'routines')
  assert.equal(view().previewReturn, null)
  view().closeAgentCanvas()
  assert.equal(view().screen, 'routines')
})

test('Escape leaves an agent canvas for its opener, while a local handler still gets first refusal', () => {
  const context: KeyContext = { zone: 'canvas', screen: 'agent', screens: [], messageEmpty: true, inOverlay: false, veilOpen: false, asking: false, githubInMenu: true }
  assert.deepEqual(resolveEscape(context, false), { do: 'leave-screen' })
  assert.equal(resolveEscape(context, true), null)
})

test('a walk that starts on an agent window goes back to that agent when the list is left, and still closes to the opener', () => {
  view().openScreen('routines')
  view().openAgentCanvas('a1')
  view().previewAgent('a2', 1)
  view().previewAgent('a3', 1)
  view().endAgentPreview()
  assert.deepEqual([view().screen, view().openAgent], ['agent', 'a1'])
  assert.equal(view().previewFrom, null, 'the walk is over')
  view().closeAgentCanvas()
  assert.equal(view().screen, 'routines')
})

test('an agent chosen from the list stays, and a walk from a screen goes back to the screen', () => {
  view().openScreen('routines')
  view().openAgentCanvas('a1')
  view().previewAgent('a2', 1)
  view().openAgentCanvas('a2')
  assert.equal(view().previewFrom, null)
  view().endAgentPreview()
  assert.equal(view().openAgent, 'a2')
  view().closeAgentCanvas()
  view().previewAgent('a4', 1)
  view().endAgentPreview()
  assert.equal(view().screen, 'routines')
})

test('the remembered agent is forgotten when the view moves to another screen', () => {
  view().openScreen('routines')
  view().openAgentCanvas('a1')
  view().previewAgent('a2', 1)
  view().openScreen('work')
  assert.equal(view().previewFrom, null)
  view().endAgentPreview()
  assert.equal(view().screen, 'work')
})
