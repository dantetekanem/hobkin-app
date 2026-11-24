import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { useView } from '../src/app/view-store.ts'

const view = () => useView.getState()

beforeEach(() => {
  useView.setState({
    screen: 'work', trail: [], openAgent: null, openReview: null, openProof: null, project: null,
    settingsReturn: null, githubReturn: null, previewReturn: null, previewFrom: null, mindReturn: null, canvasReturn: null,
  })
})

const opened = { outright: () => view().openAgentCanvas('a1'), previewed: () => view().previewAgent('a1', 1) }
const ways = {
  toggle: () => view().toggleSettings(),
  close: () => view().closeSettings(),
  leave: () => view().leave(),
  back: () => view().back(),
}

for (const [how, open] of Object.entries(opened)) {
  for (const [way, out] of Object.entries(ways)) {
    test(`agent ${how}, Settings, then ${way} returns to the same agent`, () => {
      open()
      view().toggleSettings()
      assert.equal(view().screen, 'settings')
      out()
      assert.equal(view().screen, 'agent')
      assert.equal(view().openAgent, 'a1')
    })
  }
}

test('the keyboard stays on an agent’s screen when Settings is left for it, and goes to the input elsewhere', async () => {
  const { keyboardHomeFor } = await import('../src/app/key-map.ts')
  assert.equal(keyboardHomeFor('agent'), 'canvas')
  assert.equal(keyboardHomeFor('work'), 'input')
})
