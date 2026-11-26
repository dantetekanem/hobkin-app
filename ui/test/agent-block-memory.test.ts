import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { beforeEach, test } from 'node:test'

// Settings are kept in the window's storage, which is empty here. `@/` points at ui/src, as Vite resolves it.
const storage = { getItem: () => null, setItem() {}, removeItem() {} }
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage, addEventListener() {}, removeEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })

const { createElement, useState } = await import('react')
const { mountCounting } = await import('./render-count.ts')
const { BlockPlace, blockMemoryOf, useBlock, useBlocks } = await import('../src/features/agent-activity/blocks.ts')
const { useSettings } = await import('../src/features/settings/store.ts')

/** What each drawn block showed, by its id, and the way to press its header. */
const shown = new Map<string, boolean>()
const presses = new Map<string, () => void>()
function Block({ id }: { id: string }) {
  const { open, toggle } = useBlock('change', id)
  shown.set(id, open)
  presses.set(id, () => toggle())
  return null
}

/** A row of an agent's windowed list, drawn or not as the view moves, and the same block drawn outside any list. */
let draw = (_drawn: boolean) => {}
function Row({ windowed, list }: { windowed: boolean; list: string }) {
  const [drawn, setDrawn] = useState(true)
  draw = setDrawn
  if (!drawn) return null
  const block = createElement(Block, { id: 'edit-1' })
  if (!windowed) return block
  return createElement(BlockPlace.Provider, { value: { blocks: blockMemoryOf(list), row: 'step-7' } }, block)
}

beforeEach(() => {
  useBlocks.setState(useBlocks.getInitialState())
  // Code changes arrive open, as the user set in Settings.
  useSettings.setState({ openByDefault: { change: true, shell: false, looks: false, other: false } })
  shown.clear()
})

test('a windowed row drawn again after Control+O closed every block shows its block closed, not open as Settings says', async () => {
  const mounted = await mountCounting(() => createElement(Row, { windowed: true, list: 'agent a' }))
  assert.equal(shown.get('edit-1'), true, 'it arrived open')
  await mounted.change(() => useBlocks.getState().toggleAll())
  await mounted.change(() => useBlocks.getState().toggleAll())
  assert.equal(shown.get('edit-1'), false, 'every block closed')

  // Scrolled out of view and back: drawn again.
  await mounted.change(() => draw(false))
  await mounted.change(() => draw(true))
  assert.equal(shown.get('edit-1'), false)
  await mounted.unmount()
})

test('a windowed row drawn again keeps what the user chose by its header, and so does the agent opened again', async () => {
  useSettings.setState({ openByDefault: { change: false, shell: false, looks: false, other: false } })
  const mounted = await mountCounting(() => createElement(Row, { windowed: true, list: 'agent b' }))
  assert.equal(shown.get('edit-1'), false)
  await mounted.change(() => presses.get('edit-1')!())
  assert.equal(shown.get('edit-1'), true, 'opened by its header')

  await mounted.change(() => draw(false))
  await mounted.change(() => draw(true))
  assert.equal(shown.get('edit-1'), true, 'still open when scrolled back to')
  await mounted.unmount()

  const again = await mountCounting(() => createElement(Row, { windowed: true, list: 'agent b' }))
  assert.equal(shown.get('edit-1'), true, 'still open when the agent is opened again')
  await again.unmount()
})

test("another agent's rows remember their own blocks", async () => {
  const first = await mountCounting(() => createElement(Row, { windowed: true, list: 'agent c' }))
  await first.change(() => presses.get('edit-1')!())
  assert.equal(shown.get('edit-1'), false, 'closed by its header')
  await first.unmount()

  const other = await mountCounting(() => createElement(Row, { windowed: true, list: 'agent d' }))
  assert.equal(shown.get('edit-1'), true, 'the same block id on another agent arrives as Settings says')
  await other.unmount()
})

test('a block outside a windowed list is drawn as before: drawn again, it starts afresh', async () => {
  const mounted = await mountCounting(() => createElement(Row, { windowed: false, list: 'unused' }))
  await mounted.change(() => useBlocks.getState().toggleAll())
  await mounted.change(() => useBlocks.getState().toggleAll())
  assert.equal(shown.get('edit-1'), false)

  await mounted.change(() => draw(false))
  await mounted.change(() => draw(true))
  assert.equal(shown.get('edit-1'), true, 'it arrives again at this press of Control+O, open as Settings says')
  await mounted.unmount()
})
