import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { useView } from '../src/app/view-store.ts'

const view = () => useView.getState()

/** What took the keyboard: the message input or the open screen. */
let took: string[] = []

// The message input closes an agent's screen as it takes focus, as the chat's Composer does.
const input = {
  focus: () => {
    took.push('input')
    view().closeAgentCanvas()
  },
}
const section = { dataset: { canvasScreen: 'agent' }, focus: () => took.push('screen') }
const page = {
  activeElement: null as unknown,
  querySelector: (selector: string) => (selector === '[data-chat-side] textarea' ? input : { dataset: { activeCanvasScreen: 'agent' } }),
  querySelectorAll: () => [section],
  addEventListener: () => {},
  removeEventListener: () => {},
}

beforeEach(() => {
  took = []
  useView.setState({
    screen: 'work', trail: [], openAgent: null, openReview: null, openProof: null, project: null,
    settingsReturn: null, screenReturn: null, previewReturn: null, previewFrom: null, mindReturn: null, canvasReturn: null,
  })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: page })
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (run: () => void) => run() })
})
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
})

test('a sheet that closes over an agent’s screen leaves the keyboard on the agent, which stays open', async () => {
  const { focusHome } = await import('../src/app/focus-home.ts')
  view().openAgentCanvas('a1')
  focusHome()
  assert.deepEqual(took, ['screen'])
  assert.equal(view().screen, 'agent')
  assert.equal(view().openAgent, 'a1')
})

test('a sheet that closes anywhere else sends the keyboard to the message input', async () => {
  const { focusHome } = await import('../src/app/focus-home.ts')
  focusHome()
  assert.deepEqual(took, ['input'])
  assert.equal(view().screen, 'work')
})
