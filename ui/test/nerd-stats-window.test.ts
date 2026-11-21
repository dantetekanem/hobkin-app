import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addedStyleSheets, graphicsCard, watchStyleSheets } from '../src/features/settings/window-readings.ts'

const node = (nodeName: string, rel?: string) => ({ nodeName, ...(rel === undefined ? {} : { rel }) })
const added = (...nodes: ReturnType<typeof node>[]) => ({ addedNodes: nodes })

test('a style element or a style sheet link is a style sheet added, and nothing else is', () => {
  assert.equal(addedStyleSheets([added(node('STYLE'))]), 1)
  assert.equal(addedStyleSheets([added(node('LINK', 'stylesheet')), added(node('LINK', 'preload stylesheet'))]), 2)
  // An SVG's style element names itself in lower case.
  assert.equal(addedStyleSheets([added(node('style'))]), 1)
  assert.equal(addedStyleSheets([added(node('DIV'), node('#text'), node('LINK', 'icon'), node('LINK', 'modulepreload'), node('SCRIPT'))]), 0)
  assert.equal(addedStyleSheets([added(node('DIV'), node('STYLE')), added(), added(node('STYLE'))]), 2)
})

test('the watch counts sheets added to the head and the body, and stops when let go', () => {
  type Records = { addedNodes: { nodeName: string }[] }[]
  const watched: { target: string; options: MutationObserverInit }[] = []
  let deliver: ((records: Records) => void) | null = null
  let stopped = 0
  class FakeObserver {
    constructor(callback: (records: Records) => void) {
      deliver = callback
    }
    observe(target: { name: string }, options: MutationObserverInit) {
      watched.push({ target: target.name, options })
    }
    disconnect() {
      stopped += 1
    }
  }
  const counts: number[] = []
  const stop = watchStyleSheets({ head: { name: 'head' }, body: { name: 'body' } } as never, (count) => counts.push(count), FakeObserver as never)
  assert.deepEqual(watched.map(({ target, options }) => [target, options.childList, options.subtree]), [['head', true, true], ['body', true, true]])

  deliver!([added(node('STYLE'))])
  deliver!([added(node('DIV'))])
  deliver!([added(node('STYLE'), node('LINK', 'stylesheet'))])
  // Only a change in the count is told.
  assert.deepEqual(counts, [1, 3])

  stop()
  assert.equal(stopped, 1)
})

test('the graphics card is read once and its drawing context is let go at once', () => {
  let lost = 0
  const gl = {
    getExtension: (name: string) => {
      if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_RENDERER_WEBGL: 0x9246 }
      if (name === 'WEBGL_lose_context') return { loseContext: () => void (lost += 1) }
      return null
    },
    getParameter: (which: number) => (which === 0x9246 ? 'Apple M5 Pro' : null),
  }
  assert.equal(graphicsCard(() => ({ getContext: () => gl }) as never), 'Apple M5 Pro')
  assert.equal(lost, 1)

  // A browser that hides the name still lets the context go.
  const hidden = { ...gl, getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: () => void (lost += 1) } : null) }
  assert.equal(graphicsCard(() => ({ getContext: () => hidden }) as never), '—')
  assert.equal(lost, 2)

  // No WebGL at all, or one that throws, reads as a dash.
  assert.equal(graphicsCard(() => ({ getContext: () => null }) as never), '—')
  assert.equal(graphicsCard(() => { throw new Error('no canvas') }), '—')
})
