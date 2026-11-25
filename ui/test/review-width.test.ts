import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canvasGrowth, covered, DIVIDER_WIDTH } from '../src/app/view-store.ts'

/** How wide the canvas is in a window, once it has grown: it starts after the chat and the divider, less its growth. */
const canvasWidth = (windowWidth: number, conversationWidth: number, growth: number) => windowWidth - (conversationWidth + DIVIDER_WIDTH - growth)

test('a review that has the user attention covers 98% of the window, whatever the chat width, and leaves the rest of the chat in view', () => {
  for (const [windowWidth, conversationWidth] of [[1440, 460], [1280, 360], [1920, 720], [1728, 500]] as const) {
    const growth = canvasGrowth({ screen: 'review', canvasEngaged: true, conversationWidth, windowWidth })
    const share = canvasWidth(windowWidth, conversationWidth, growth) / windowWidth
    assert.ok(Math.abs(share - 0.98) < 0.001, `${windowWidth} wide with a ${conversationWidth} chat: ${share}`)
    assert.equal(covered({ growth, conversationWidth, settled: true, chatFocused: false }), false, 'a strip of the chat stays in view')
  }
})

test('a TLA+ run opened from a review keeps the same width, and a review the user stepped out of gives the chat its room', () => {
  const width = { conversationWidth: 460, windowWidth: 1440 }
  const review = canvasGrowth({ screen: 'review', canvasEngaged: true, ...width })
  assert.equal(canvasGrowth({ screen: 'proof', canvasEngaged: true, trail: [{ screen: 'review' }] as never, ...width }), review)
  assert.equal(canvasGrowth({ screen: 'review', canvasEngaged: false, ...width }), 0)
})
