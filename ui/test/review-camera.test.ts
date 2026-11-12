import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { boundsOf, nodeRect, type Rect } from '#shared/review/layout.ts'
import { stressReview } from '#shared/review/stress.ts'
import type { Review } from '#shared/review/types.ts'
import { cameraFor, composeShot, FRAME, frameFocus, hangText, toScreen, uncoveredArea, viewportFor, type Size } from '../src/features/review/story/camera.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const idOf = (title: string) => sample.nodes.find((node) => node.title === title)!.id

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
/** Room for a card and the least of its text at a reading size, with the margins around them. */
const roomy = (area: Rect) => area.width >= 340 && area.height >= 300

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
      for (const canvas of canvases) {
        for (const cover of covers(canvas)) {
          const area = uncoveredArea(canvas, cover)
          for (const text of [null, 150, 380]) {
            const shot = frameFocus({ focus, area, text })
            const where = `${review.id} ${step.id} in ${canvas.width}x${canvas.height} under ${cover.bottom}, text ${text}`
            // The node the step is told on is always in the frame, with its text.
            const told = focus[shot.text?.anchor ?? 0]!
            assert.ok(inside(toScreen(told, shot.camera, area), area), `${where}: ${JSON.stringify(toScreen(told, shot.camera, area))} not in ${JSON.stringify(area)}`)
            if (text) assert.ok(shot.text && inside(toScreen(shot.text, shot.camera, area), area), `${where}: its text is in the frame too`)
            if (shot.whole) for (const rect of focus) assert.ok(inside(toScreen(rect, shot.camera, area), area), `${where}: every focus node is in the frame`)
            assert.ok(shot.camera.zoom > 0 && shot.camera.zoom <= FRAME.maxZoom, 'it never zooms past a little over full size to fill the room')

            // The cards are never shown smaller than they read, whatever the focus is wired to or how far it is spread.
            if (roomy(area)) assert.ok(shot.camera.zoom >= FRAME.reading - 1e-9, `${where}: framed at ${shot.camera.zoom}`)
            // And a focus that fits at that size is shown whole.
            const least = text ? [hangText(focus, Math.min(text, FRAME.leastText))!] : []
            const all = boundsOf([...focus, ...least])
            if (all.width * FRAME.reading <= area.width - 2 * FRAME.margin && all.height * FRAME.reading <= area.height - 2 * FRAME.margin) assert.ok(shot.whole, `${where}: it fits whole`)
            shots += 1
          }
        }
      }
    }
  }
  assert.ok(shots > 5000)

  // With room to spare a node is shown at its closest, in the middle of what is uncovered. A node wired to twenty
  // others is framed exactly the same: the camera never pulls back to take in what the focus connects to.
  const area = uncoveredArea({ width: 1000, height: 840 }, { top: TOP, bottom: RAIL })
  const one = rectsOf(sample, [idOf('doingAfter')])
  const alone = frameFocus({ focus: one, area })
  assert.equal(alone.camera.zoom, FRAME.maxZoom)
  const onScreen = toScreen(one[0]!, alone.camera, area)
  assert.ok(Math.abs(onScreen.x + onScreen.width / 2 - (area.x + area.width / 2)) < 1)
  assert.ok(Math.abs(onScreen.y + onScreen.height / 2 - (area.y + area.height / 2)) < 1)

  // Opening the code panel shrinks the area from below, and the same focus moves up to stay inside it.
  const open = uncoveredArea({ width: 1000, height: 840 }, { top: TOP, bottom: RAIL + 258 })
  const raised = toScreen(one[0]!, frameFocus({ focus: one, area: open }).camera, open)
  assert.ok(raised.y < onScreen.y)
  assert.ok(raised.y + raised.height <= open.y + open.height)

  // G frames the whole graph, every node of it, as far back as that takes.
  const all = sample.nodes.map((node) => nodeRect(node.kind, node.position))
  const whole = composeShot({ focus: all, area, card: null, others: [] })
  for (const rect of all) assert.ok(inside(toScreen(rect, whole.camera, area), area))
  assert.ok(whole.camera.zoom < 1)

  // As a story opens on the whole graph it is framed closer, around the same middle. G frames all of it, as above.
  const opening = composeShot({ focus: all, area, card: null, others: [], closer: FRAME.closer })
  assert.ok(Math.abs(opening.camera.zoom - whole.camera.zoom * FRAME.closer) < 1e-9)
  assert.ok(Math.abs(opening.camera.x - whole.camera.x) < 1e-6 && Math.abs(opening.camera.y - whole.camera.y) < 1e-6)
})

test('hangs the step text under its node, never on another focus node', async () => {
  // One node: its text hangs right under it, as wide as it, and both are framed as close as they read best.
  const node = rectsOf(sample, [idOf('doingAfter')])
  const area = uncoveredArea({ width: 980, height: 840 }, { top: TOP, bottom: RAIL })
  const shot = frameFocus({ focus: node, area, text: 220 })
  assert.deepEqual(shot.text, { anchor: 0, x: node[0]!.x, y: node[0]!.y + node[0]!.height + FRAME.hang, width: node[0]!.width, height: 220 })
  assert.deepEqual([shot.camera.zoom, shot.whole], [FRAME.maxZoom, true])

  // Three promises stacked in their column: the text goes under the last, so it covers none of them.
  assert.equal(hangText(rectsOf(sample, ['A1', 'A2', 'A3']), 220)!.anchor, 2)
  // With nothing of the focus under it, the step's first node keeps the text.
  assert.equal(hangText(rectsOf(sample, [idOf('workingRow'), idOf('elapsed')]), 220)!.anchor, 0)

  // Over every step, at every height, the text hangs right under one of its nodes and lies on none of them.
  for (const review of [sample, await stressReview()]) {
    for (const step of review.story.filter((entry) => entry.focus.length > 0)) {
      const focus = rectsOf(review, step.focus)
      for (const height of [120, 240, 400]) {
        const hung = hangText(focus, height)!
        const under = focus[hung.anchor]!
        assert.deepEqual([hung.x, hung.y, hung.width, hung.height], [under.x, under.y + under.height + FRAME.hang, under.width, height])
        for (const rect of focus) assert.equal(overlap(hung, rect), false, `${review.id} ${step.id}: the text is never on a focus node`)
      }
    }
  }

  // A long text in a short room gives up height before the cards give up size. It scrolls, and keeps at least its least.
  const short = uncoveredArea({ width: 980, height: 620 }, { top: TOP, bottom: RAIL + 200 })
  const long = frameFocus({ focus: node, area: short, text: 400 })
  assert.ok(long.text!.height < 400 && long.text!.height >= FRAME.leastText, `${long.text!.height}`)
  assert.ok(long.camera.zoom >= FRAME.reading - 1e-9)
  assert.ok(inside(toScreen(long.text!, long.camera, short), short))
})

test('a focus spread too far to read keeps its text, its node and the nearest of the rest', () => {
  // The steps panel open on a canvas of a common size: 692 by 704 points are left.
  const area = uncoveredArea({ width: 988, height: 840 }, { top: TOP, bottom: RAIL, left: 296 })
  const first = { x: 0, y: 0, width: 288, height: 136 }
  const next = { x: 420, y: 26, width: 288, height: 136 }
  const far = { x: 2100, y: 1400, width: 288, height: 120 }
  const shot = frameFocus({ focus: [first, far, next], area, text: 200 })

  assert.equal(shot.whole, false)
  assert.ok(shot.camera.zoom >= FRAME.reading - 1e-9, 'the camera does not pull back to take in the far one')
  assert.equal(shot.text!.anchor, 0)
  for (const rect of [first, next, shot.text!]) assert.ok(inside(toScreen(rect, shot.camera, area), area), 'the step, its text and its neighbor in the next column')
  assert.equal(inside(toScreen(far, shot.camera, area), area), false)

  // The same focus without the far node fits, and is shown whole.
  assert.equal(frameFocus({ focus: [first, next], area, text: 200 }).whole, true)
})

test('tells the opening and the closing beside the whole graph', async () => {
  for (const review of [sample, await stressReview()]) {
    const all = review.nodes.map((node) => nodeRect(node.kind, node.position))
    for (const canvas of canvases) {
      for (const cover of covers(canvas)) {
        const area = uncoveredArea(canvas, cover)
        for (const height of [120, 240, 400]) {
          const shot = composeShot({ focus: all, area, card: { width: 320, height }, others: [], closer: FRAME.closer })
          const where = `${review.id} in ${canvas.width}x${canvas.height} under ${cover.bottom}, card ${height}`
          if (!shot.card) {
            // The text is left out only when the uncovered area cannot hold a readable card.
            assert.ok(area.height < 330 || area.width < 360, where)
            continue
          }
          assert.ok(inside(shot.card, area), `${where}: the text stays inside the uncovered area`)
          assert.ok(shot.card.height >= Math.min(height, FRAME.minCardHeight), `${where}: enough of the text shows`)
        }
      }
    }
  }
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
          const shot = frameFocus({ focus, area, text: 260 })
          const framed = [focus[shot.text!.anchor]!, shot.text!, ...(shot.whole ? focus : [])]
          for (const rect of framed) {
            const onScreen = toScreen(rect, shot.camera, area)
            assert.ok(onScreen.x >= left - 0.5, `${review.id} ${step.id}: nothing of the focus is framed under a panel ${left} wide`)
            assert.ok(inside(onScreen, area))
          }
        }
      }
    }
  }
  // A canvas the panel has nearly filled still frames the focus in what is left.
  const tight = uncoveredArea({ width: 620, height: 800 }, { top: TOP, bottom: RAIL, left: 300 })
  const node = rectsOf(sample, [sample.nodes[0]!.id])
  const shot = frameFocus({ focus: node, area: tight, text: 260 })
  assert.ok(inside(toScreen(node[0]!, shot.camera, tight), tight) && inside(toScreen(shot.text!, shot.camera, tight), tight))
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
