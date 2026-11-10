import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { nodeRect, type Rect } from '#shared/review/layout.ts'
import { stressReview } from '#shared/review/stress.ts'
import type { Review } from '#shared/review/types.ts'
import { cameraFor, composeShot, toScreen, uncoveredArea, viewportFor, type Size } from '../src/features/review/story/camera.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review

const inside = (inner: Rect, outer: Rect, slack = 0.5) =>
  inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** The canvas at window widths from 1100 to 1600, with the chat bar open and closed, at three window heights. */
const canvases: Size[] = []
for (const window of [1100, 1280, 1440, 1600]) {
  for (const chat of [440 + 216, 440, 340]) {
    for (const height of [700, 860, 1000]) canvases.push({ width: window - chat - 12, height: height - 20 })
  }
}
const TOP = 76
const RAIL = 60
/** The code panel takes a share of the window's height. Closed, 30% and 70% are the cases that matter. */
const covers = (canvas: Size) => [0, 0.3, 0.7].map((share) => ({ top: TOP, bottom: RAIL + Math.round((canvas.height + 20) * share) }))

function rectsOf(review: Review, ids: readonly string[]): Rect[] {
  return ids.map((id) => {
    const node = review.nodes.find((entry) => entry.id === id)!
    return nodeRect(node.kind, node.position)
  })
}

test('frames the focus inside the uncovered area', async () => {
  let shots = 0
  for (const review of [sample, await stressReview()]) {
    for (const step of review.story.filter((entry) => entry.focus.length > 0)) {
      const focus = rectsOf(review, step.focus)
      const others = review.nodes.filter((node) => !step.focus.includes(node.id)).map((node) => nodeRect(node.kind, node.position))
      for (const canvas of canvases) {
        for (const cover of covers(canvas)) {
          const area = uncoveredArea(canvas, cover)
          for (const card of [null, { width: 320, height: 150 }, { width: 320, height: 380 }]) {
            const shot = composeShot({ focus, area, card, others })
            for (const rect of focus) {
              assert.ok(inside(toScreen(rect, shot.camera, area), area), `${review.id} ${step.id} in ${canvas.width}x${canvas.height} under ${cover.bottom}: ${JSON.stringify(toScreen(rect, shot.camera, area))} not in ${JSON.stringify(area)}`)
            }
            assert.ok(shot.camera.zoom > 0 && shot.camera.zoom <= 1, 'it never zooms past full size to fill the room')
            shots += 1
          }
        }
      }
    }
  }
  assert.ok(shots > 5000)

  // With room to spare the focus is shown at full size, and a single node sits in the middle of what is uncovered.
  const area = uncoveredArea({ width: 1000, height: 840 }, { top: TOP, bottom: RAIL })
  const one = rectsOf(sample, [sample.nodes.find((node) => node.title === 'doingAfter')!.id])
  const alone = composeShot({ focus: one, area, card: null, others: [] })
  assert.equal(alone.camera.zoom, 1)
  const onScreen = toScreen(one[0]!, alone.camera, area)
  assert.ok(Math.abs(onScreen.x + onScreen.width / 2 - (area.x + area.width / 2)) < 1)
  assert.ok(Math.abs(onScreen.y + onScreen.height / 2 - (area.y + area.height / 2)) < 1)

  // Opening the code panel shrinks the area from below, and the same focus moves up to stay inside it.
  const open = uncoveredArea({ width: 1000, height: 840 }, { top: TOP, bottom: RAIL + 258 })
  const raised = toScreen(one[0]!, composeShot({ focus: one, area: open, card: null, others: [] }).camera, open)
  assert.ok(raised.y < onScreen.y)
  assert.ok(raised.y + raised.height <= open.y + open.height)

  // The whole graph is framed the same way, for the first and last step and for the 0 key.
  const all = sample.nodes.map((node) => nodeRect(node.kind, node.position))
  const whole = composeShot({ focus: all, area, card: null, others: [] })
  for (const rect of all) assert.ok(inside(toScreen(rect, whole.camera, area), area))
  assert.ok(whole.camera.zoom < 1)
})

test('places the step text beside the focus without overlap', async () => {
  const sides = new Set<string>()
  for (const review of [sample, await stressReview()]) {
    for (const step of review.story.filter((entry) => entry.focus.length > 0)) {
      const focus = rectsOf(review, step.focus)
      const others = review.nodes.filter((node) => !step.focus.includes(node.id)).map((node) => nodeRect(node.kind, node.position))
      for (const canvas of canvases) {
        for (const cover of covers(canvas)) {
          const area = uncoveredArea(canvas, cover)
          for (const height of [120, 240, 400]) {
            const shot = composeShot({ focus, area, card: { width: 320, height }, others })
            const where = `${review.id} ${step.id} in ${canvas.width}x${canvas.height} under ${cover.bottom}, card ${height}`
            if (!shot.card) {
              // The text is left out only when the uncovered area cannot hold a readable card next to the focus.
              assert.ok(area.height < 330 || area.width < 360, where)
              continue
            }
            sides.add(shot.card.side)
            assert.ok(inside(shot.card, area), `${where}: the text stays inside the uncovered area`)
            assert.ok(shot.card.height >= Math.min(height, 120), `${where}: enough of the text shows`)
            for (const rect of focus) assert.equal(overlap(shot.card, toScreen(rect, shot.camera, area)), false, `${where}: the text is never on top of a focus node`)
          }
        }
      }
    }
  }
  assert.deepEqual([...sides].sort(), ['above', 'below', 'left', 'right'], 'each side is used somewhere')

  // On a wide canvas the text sits beside the node. On a narrow one it goes under it.
  const node = rectsOf(sample, [sample.nodes.find((entry) => entry.title === 'doingAfter')!.id])
  const card = { width: 320, height: 260 }
  const wide = composeShot({ focus: node, area: uncoveredArea({ width: 980, height: 840 }, { top: TOP, bottom: RAIL }), card, others: [] })
  assert.equal(wide.card?.side, 'right')
  assert.equal(wide.camera.zoom, 1)
  const narrow = composeShot({ focus: node, area: uncoveredArea({ width: 432, height: 840 }, { top: TOP, bottom: RAIL }), card, others: [] })
  assert.equal(narrow.card?.side, 'below')
  assert.equal(narrow.camera.zoom, 1)

  // It goes to the side with the most room: nodes on the right push it left.
  const area = uncoveredArea({ width: 980, height: 840 }, { top: TOP, bottom: RAIL })
  const crowded = [{ x: node[0]!.x + node[0]!.width + 60, y: node[0]!.y - 40, width: 272, height: 124 }]
  assert.equal(composeShot({ focus: node, area, card, others: crowded }).card?.side, 'left')
})

test('the left panel is covered area too, tucked or open', async () => {
  const canvas = { width: 1500, height: 1000 }
  const stress = await stressReview()
  for (const left of [64, 320]) {
    for (const bottom of [RAIL, RAIL + 300]) {
      const area = uncoveredArea(canvas, { top: TOP, bottom, left })
      assert.deepEqual([area.x, area.width], [left, canvas.width - left], 'the uncovered area starts where the panel ends')
      for (const review of [sample, stress]) {
        for (const step of review.story.filter((entry) => entry.focus.length > 0)) {
          const focus = rectsOf(review, step.focus)
          const shot = composeShot({ focus, area, card: { width: 320, height: 260 }, others: [] })
          for (const rect of focus) {
            const onScreen = toScreen(rect, shot.camera, area)
            assert.ok(onScreen.x >= left - 0.5, `${review.id} ${step.id}: no focus node is framed under a panel ${left} wide`)
            assert.ok(inside(onScreen, area))
          }
          if (shot.card) assert.ok(shot.card.x >= left - 0.5, 'and neither is its text')
        }
      }
    }
  }
  // A canvas the panel has nearly filled still frames the focus in what is left.
  const tight = uncoveredArea({ width: 620, height: 800 }, { top: TOP, bottom: RAIL, left: 300 })
  const node = rectsOf(sample, [sample.nodes[0]!.id])
  assert.ok(inside(toScreen(node[0]!, composeShot({ focus: node, area: tight, card: null, others: [] }).camera, tight), tight))
})

test('the camera and the viewport are two ways of saying where the graph sits', () => {
  const area = { x: 0, y: 76, width: 900, height: 600 }
  const camera = { x: 1234.5, y: 321, zoom: 0.8 }
  const viewport = viewportFor(camera, area)

  // The camera's point lands on the middle of the uncovered area.
  assert.ok(Math.abs(camera.x * viewport.zoom + viewport.x - (area.x + area.width / 2)) < 1e-9)
  assert.ok(Math.abs(camera.y * viewport.zoom + viewport.y - (area.y + area.height / 2)) < 1e-9)
  const back = cameraFor(viewport, area)
  assert.ok(Math.abs(back.x - camera.x) < 1e-9 && Math.abs(back.y - camera.y) < 1e-9 && back.zoom === camera.zoom)
})
