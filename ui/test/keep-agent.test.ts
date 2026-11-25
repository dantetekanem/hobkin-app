import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { useView } from '../src/app/view-store.ts'

const view = () => useView.getState()

beforeEach(() => {
  useView.setState({
    screen: 'work', trail: [], openAgent: null, openReview: null, openProof: null, project: null,
    settingsReturn: null, screenReturn: null, previewReturn: null, previewFrom: null, mindReturn: null, canvasReturn: null,
  })
})

test('a click on an agent previewed from the agents list keeps it open when the list lets the keyboard go', async () => {
  const { keepAgentPreview } = await import('../src/app/keep-agent.ts')
  view().previewAgent('hobkin-1', 1)
  keepAgentPreview()
  view().endAgentPreview()
  assert.equal(view().screen, 'agent')
  assert.equal(view().openAgent, 'hobkin-1')
})

test('without a click the preview still ends with the list', () => {
  view().previewAgent('hobkin-1', 1)
  view().endAgentPreview()
  assert.equal(view().screen, 'work')
})

test('a click on a page that is no preview changes nothing', async () => {
  const { keepAgentPreview } = await import('../src/app/keep-agent.ts')
  keepAgentPreview()
  assert.equal(view().screen, 'work')
  assert.equal(view().openAgent, null)
})
