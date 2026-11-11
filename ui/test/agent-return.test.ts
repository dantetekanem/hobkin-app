import assert from 'node:assert/strict'
import { test } from 'node:test'
import { useView } from '../src/app/view-store.ts'
import { resolveEscape, type KeyContext } from '../src/app/key-map.ts'

const view = () => useView.getState()

for (const screen of ['reports', 'routines', 'actions', 'github', 'work', 'mind'] as const) {
  test(`promoting a dock preview returns to ${screen}, even after switching agents`, () => {
    useView.setState({ screen, openAgent: null, previewReturn: null, agentReturn: null, agentTalk: false })
    view().previewAgent('a1', 1)
    view().previewAgent('a2', 1)
    view().openAgentCanvas('a2')
    view().endAgentPreview() // The dock's blur follows the transcript pointer-down.
    assert.equal(view().screen, 'agent')
    assert.equal(view().previewReturn, null, 'a promoted canvas is no longer a preview')
    assert.equal(view().agentReturn, screen)
    view().openAgentCanvas('a3')
    view().closeAgentCanvas()
    assert.equal(view().screen, screen)
    assert.equal(view().openAgent, null)
    assert.equal(view().agentReturn, null)
  })
}

test('a plain preview still ends when the list is left, and agent talk keeps its way back', () => {
  view().openScreen('routines')
  view().previewAgent('a1', 1)
  view().endAgentPreview()
  assert.equal(view().screen, 'routines')
  view().enterAgentTalk('a2')
  view().endAgentPreview()
  assert.equal(view().screen, 'agent', 'focusing the agent talk input does not leave')
  view().closeAgentCanvas()
  assert.equal(view().screen, 'routines')
  assert.equal(view().agentTalk, false)
})

test('rapid entry, talk return and a second agent keep the original opener without waiting for motion', () => {
  view().openScreen('routines')
  view().previewAgent('a1', 1)
  view().enterAgentTalk('a1')
  view().leaveAgentTalk()
  assert.equal(view().openAgent, 'a1')
  assert.equal(view().agentTalk, false)
  view().previewAgent('a2', 1)
  view().openAgentCanvas('a2')
  view().endAgentPreview()
  assert.equal(view().openAgent, 'a2')
  assert.equal(view().agentReturn, 'routines')
  assert.equal(view().previewReturn, null)
  view().closeAgentCanvas()
  assert.equal(view().screen, 'routines')
})

test('Escape leaves an agent canvas for its opener, while a local handler still gets first refusal', () => {
  const context: KeyContext = { zone: 'canvas', screen: 'agent', screens: [], messageEmpty: true, inOverlay: false, veilOpen: false, asking: false, githubInMenu: true }
  assert.deepEqual(resolveEscape(context, false), { do: 'leave-screen' })
  assert.equal(resolveEscape(context, true), null)
})
