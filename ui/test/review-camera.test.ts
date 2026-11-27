import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { layoutZones, NODE_SIZE, nodeRect, ZONE_FRAME, zoneRects, type Rect, type ZoneNode } from '#shared/review/layout.ts'
import { stressReview } from '#shared/review/stress.ts'
import type { Review } from '#shared/review/types.ts'
import { BESIDE_GAP, cameraFor, composeShot, FRAME, entryCamera, storyDock, frameStep, framingOf, headingsOf, placeCard, revealNode, toScreen, uncoveredArea, viewportFor, type Size } from '../src/features/review/story/camera.ts'
import { arrange } from '../src/features/review/graph/arrange.ts'
import { pullReview } from '../src/features/review/sample/pull.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const idOf = (title: string) => sample.nodes.find((node) => node.title === title)!.id
/** The sample pull request as the canvas draws it: tests folded, the flow laid out. */
const pull = pullReview('pr:hobkin-sample/storefront/482')
const arranged = { ...pull, ...arrange(pull) } as Review
/** The width the step's card is drawn at. */
const CARD = 380

const inside = (inner: Rect, outer: Rect, slack = 0.5) =>
  inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack
/** Two boxes overlap by more than a hair, a pixel each way. */
const overlap = (a: Rect, b: Rect) => a.x + 1 < b.x + b.width && b.x + 1 < a.x + a.width && a.y + 1 < b.y + b.height && b.y + 1 < a.y + a.height

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
/** Room for a node and its card beside it at a reading size, with the margins around them. */
const roomy = (area: Rect) => area.width >= 2 * FRAME.margin + 288 * FRAME.reading + BESIDE_GAP + CARD && area.height >= 2 * FRAME.margin + 420

function rectsOf(review: Review, ids: readonly string[]): Rect[] {
  return ids.map((id) => {
    const node = review.nodes.find((entry) => entry.id === id)!
    return nodeRect(node.kind, node.position)
  })
}

test('frames a step inside the uncovered area, its card beside its node', async () => {
  let shots = 0
  for (const review of [sample, await stressReview(), arranged]) {
    for (const step of review.story.filter((entry) => entry.focus.length > 0)) {
      const focus = rectsOf(review, step.focus)
      const others = review.nodes.filter((node) => !step.focus.includes(node.id)).map((node) => nodeRect(node.kind, node.position))
      for (const canvas of canvases) {
        for (const cover of covers(canvas)) {
          const area = uncoveredArea(canvas, cover)
          for (const height of [null, 180, 420]) {
            const shot = frameStep({ focus, others, area, card: height ? { width: CARD, height } : null })
            const where = `${review.id} ${step.id} in ${canvas.width}x${canvas.height} under ${cover.bottom}, card ${height}`
            // The node the card is beside is always in the frame, and so is the card.
            const told = focus[shot.card?.anchor ?? 0]!
            assert.ok(inside(toScreen(told, shot.camera, area), area), `${where}: ${JSON.stringify(toScreen(told, shot.camera, area))} not in ${JSON.stringify(area)}`)
            if (height) assert.ok(shot.card && inside(shot.card, area), `${where}: its card is in the frame too`)
            // The card is beside its node, never on a node of the focus.
            if (shot.card) for (const rect of focus) assert.equal(overlap(shot.card, toScreen(rect, shot.camera, area)), false, `${where}: the card lies on the focus`)
            if (shot.whole) for (const rect of focus) assert.ok(inside(toScreen(rect, shot.camera, area), area), `${where}: every focus node is in the frame`)
            assert.ok(shot.camera.zoom > 0 && shot.camera.zoom <= FRAME.maxZoom, 'it never zooms past a little over full size to fill the room')
            // The cards are never shown smaller than they read, however the focus is wired or spread.
            if (roomy(area)) assert.ok(shot.camera.zoom >= FRAME.reading - 1e-9, `${where}: framed at ${shot.camera.zoom}`)
            shots += 1
          }
        }
      }
    }
  }
  assert.ok(shots > 5000)
})

test('the card goes right of its node, or left when the right has no room, and covers as little as it can', () => {
  const area = { x: 300, y: 76, width: 1000, height: 700 }
  const node = { x: 420, y: 200, width: 288, height: 136 }
  const card = { width: CARD, height: 260 }
  const right = placeCard({ node, card, area })
  assert.deepEqual([right.side, right.x, right.y], ['right', node.x + node.width + BESIDE_GAP, node.y], 'on the right, level with the top of its node')

  // Near the right edge of what is uncovered, there is no room on the right: it goes left.
  const edge = { ...node, x: area.x + area.width - node.width - 40 }
  const left = placeCard({ node: edge, card, area })
  assert.deepEqual([left.side, left.x], ['left', edge.x - BESIDE_GAP - CARD])
  // And never under the steps panel: no room on the left inside the area either, so it goes under or over.
  const narrow = { x: 300, y: 76, width: 560, height: 700 }
  assert.ok(['below', 'above'].includes(placeCard({ node: { ...node, x: 420 }, card, area: narrow }).side))

  // A card never lies on what it must leave in view: with a neighbor beside it on the right, it goes left.
  const middle = { ...node, x: 760 }
  const neighbor = { x: middle.x + middle.width + 60, y: middle.y - 20, width: 288, height: 136 }
  assert.equal(placeCard({ node: middle, card, area, keep: [neighbor] }).side, 'left')
  // It covers as little of the other nodes as it can: it slides along its side, clear of a node in its way.
  const wide = { ...area, width: 1400 }
  const lower = { ...neighbor, y: middle.y + 180 }
  const slid = placeCard({ node: middle, card, area: wide, others: [lower] })
  assert.deepEqual([slid.side, overlap(slid, lower)], ['right', false])
  // A right side full of cards is no room.
  const column = [0, 164, 328, 492].map((y) => ({ ...neighbor, y }))
  assert.notEqual(placeCard({ node: middle, card, area: wide, others: column }).side, 'right')
})

test('in the sample pull request the card beside each unit covers no other card', () => {
  // A window of 1100 by 880, and one of 1432 by 840 with the chat beside the canvas, the steps panel open in both.
  for (const [canvas, left] of [[{ width: 1100, height: 860 }, 340], [{ width: 980, height: 820 }, 294]] as const) {
    const area = uncoveredArea(canvas, { top: TOP, bottom: RAIL, left })
    for (const step of arranged.story.filter((entry) => entry.unit)) {
      const focus = rectsOf(arranged, step.focus)
      const others = arranged.nodes.filter((node) => !step.focus.includes(node.id))
      // The card as it first shows: its TL;DR, "Read more" closed, and Open code.
      const shot = frameStep({ focus, others: others.map((node) => nodeRect(node.kind, node.position)), area, card: { width: CARD, height: 260 } })
      const where = `${step.title} in ${canvas.width}x${canvas.height}`
      for (const node of others) assert.equal(overlap(shot.card!, toScreen(nodeRect(node.kind, node.position), shot.camera, area)), false, `${where}: its card covers ${node.title}`)
      assert.ok(inside(shot.card!, area) && inside(toScreen(focus[0]!, shot.camera, area), area), `${where}: framed clear of the steps panel`)
    }
  }
})

test('the camera never pulls back for what the focus is wired to', () => {
  // With room to spare a node is shown at its closest. A node wired to twenty others is framed exactly the same.
  const area = uncoveredArea({ width: 1000, height: 840 }, { top: TOP, bottom: RAIL })
  const one = rectsOf(sample, [idOf('doingAfter')])
  const alone = frameStep({ focus: one, area })
  assert.equal(alone.camera.zoom, FRAME.maxZoom)
  const onScreen = toScreen(one[0]!, alone.camera, area)
  assert.ok(Math.abs(onScreen.x + onScreen.width / 2 - (area.x + area.width / 2)) < 1)
  assert.ok(Math.abs(onScreen.y + onScreen.height / 2 - (area.y + area.height / 2)) < 1)
  const crowd = Array.from({ length: 20 }, (_, index) => ({ x: one[0]!.x + 420, y: one[0]!.y + (index - 10) * 160, width: 288, height: 120 }))
  assert.equal(frameStep({ focus: one, others: crowd, area }).camera.zoom, alone.camera.zoom)

  // Opening the code panel shrinks the area from below, and a step framed then sits above it.
  const open = uncoveredArea({ width: 1000, height: 840 }, { top: TOP, bottom: RAIL + 258 })
  const raised = toScreen(one[0]!, frameStep({ focus: one, area: open }).camera, open)
  assert.ok(raised.y < onScreen.y)
  assert.ok(raised.y + raised.height <= open.y + open.height)

  // G frames the whole graph, every node of it, as far back as that takes.
  const all = sample.nodes.map((node) => nodeRect(node.kind, node.position))
  const whole = composeShot({ focus: all, area, card: null, others: [] })
  for (const rect of all) assert.ok(inside(toScreen(rect, whole.camera, area), area))
  assert.ok(whole.camera.zoom < 1)
  // Framed closer, around the same middle, when asked to.
  const closer = composeShot({ focus: all, area, card: null, others: [], closer: FRAME.closer })
  assert.ok(Math.abs(closer.camera.zoom - whole.camera.zoom * FRAME.closer) < 1e-9)
})

test("the frame takes in the focus's caller and its card of tests only when they fit at a reading size", () => {
  const area = uncoveredArea({ width: 1400, height: 900 }, { top: TOP, bottom: RAIL, left: 300 })
  const node = { x: 840, y: 0, width: 288, height: 136 }
  const caller = { x: 420, y: 0, width: 288, height: 120 }
  const tests = { x: 476, y: 276, width: 288, height: 136 }
  const card = { width: CARD, height: 260 }
  const today = frameStep({ focus: [node], others: [caller, tests], area, card })
  assert.equal(inside(toScreen(caller, today.camera, area), area), false, 'framed alone, the caller is out of the frame')

  const shot = frameStep({ focus: [node], along: [caller, tests], others: [caller, tests], area, card })
  assert.ok(shot.camera.zoom >= FRAME.reading - 1e-9, `framed at ${shot.camera.zoom}`)
  for (const rect of [node, caller, tests]) {
    const onScreen = toScreen(rect, shot.camera, area)
    assert.ok(inside(onScreen, area), 'the node, its caller and its tests are in the frame')
    assert.equal(overlap(shot.card!, onScreen), false, 'and the card covers none of them')
  }
  assert.ok(inside(shot.card!, area))

  // Too far to take in at a reading size: framed as it always was. Of two, the one that fits comes in.
  const far = { ...caller, x: -2400 }
  assert.deepEqual(frameStep({ focus: [node], along: [far], others: [far, tests], area, card }), frameStep({ focus: [node], others: [far, tests], area, card }))
  const one = frameStep({ focus: [node], along: [far, tests], others: [far, tests], area, card })
  assert.ok(inside(toScreen(tests, one.camera, area), area) && !inside(toScreen(far, one.camera, area), area))
  assert.ok(one.camera.zoom >= FRAME.reading - 1e-9)
})

test('a focus spread too far to read keeps its card, its node and the nearest of the rest', () => {
  // The steps panel open on a canvas of a common size: 692 by 704 points are left.
  const area = uncoveredArea({ width: 988, height: 840 }, { top: TOP, bottom: RAIL, left: 296 })
  const first = { x: 0, y: 0, width: 288, height: 136 }
  const next = { x: 0, y: 164, width: 288, height: 136 }
  const far = { x: 2100, y: 1400, width: 288, height: 120 }
  const shot = frameStep({ focus: [first, far, next], area, card: { width: CARD, height: 200 } })

  assert.equal(shot.whole, false)
  assert.ok(shot.camera.zoom >= FRAME.reading - 1e-9, 'the camera does not pull back to take in the far one')
  const told = [first, far, next][shot.card!.anchor]!
  assert.notEqual(told, far)
  for (const rect of [first, next]) assert.ok(inside(toScreen(rect, shot.camera, area), area), 'the card\'s node and its neighbor in the same column')
  assert.ok(inside(shot.card!, area))
  assert.equal(inside(toScreen(far, shot.camera, area), area), false)

  // The same focus without the far node fits, and is shown whole.
  assert.equal(frameStep({ focus: [first, next], area, card: { width: CARD, height: 200 } }).whole, true)
})

test('looking at a node in view moves nothing, and one out of view comes in by the least pan', () => {
  const area = uncoveredArea({ width: 1200, height: 860 }, { top: TOP, bottom: RAIL, left: 340 })
  const camera = { x: 600, y: 300, zoom: 1 }
  const card = { width: CARD, height: 240 }
  const viewport = viewportFor(camera, area)
  const graphAt = (screenX: number, screenY: number) => ({ x: (screenX - viewport.x) / viewport.zoom, y: (screenY - viewport.y) / viewport.zoom, width: 288, height: 136 })

  // A node just clicked is in view, with room beside it: the camera stays where the reviewer has it.
  assert.equal(revealNode({ node: graphAt(area.x + 60, area.y + 60), camera, area, card }), null)
  // Half under the steps panel: the least pan to the right brings it in, at the same zoom.
  const hidden = graphAt(area.x - 150, area.y + 100)
  const moved = revealNode({ node: hidden, camera, area, card })!
  assert.equal(moved.zoom, camera.zoom)
  assert.ok(inside(toScreen(hidden, moved, area), area))
  assert.equal(moved.y, camera.y, 'only across, the way it was out')
  // Pulled back too far to read, a node found by name comes in at a reading size.
  const far = revealNode({ node: { x: 5000, y: 4000, width: 288, height: 136 }, camera: { ...camera, zoom: 0.3 }, area, card })!
  assert.equal(far.zoom, FRAME.reading)
  assert.ok(inside(toScreen({ x: 5000, y: 4000, width: 288, height: 136 }, far, area), area))
})

test('the left panel is covered area too, tucked or open', async () => {
  const canvas = { width: 1500, height: 1000 }
  const stress = await stressReview()
  for (const left of [64, 320]) {
    for (const bottom of [RAIL, RAIL + 300]) {
      const area = uncoveredArea(canvas, { top: TOP, bottom, left })
      assert.deepEqual([area.x, area.width], [left, canvas.width - left], 'the uncovered area starts where the panel ends')
      for (const review of [sample, stress, arranged]) {
        for (const step of review.story.filter((entry) => entry.focus.length > 0)) {
          const focus = rectsOf(review, step.focus)
          const shot = frameStep({ focus, area, card: { width: CARD, height: 260 } })
          const framed = [focus[shot.card!.anchor]!, ...(shot.whole ? focus : [])].map((rect) => toScreen(rect, shot.camera, area))
          for (const rect of [...framed, shot.card!]) {
            assert.ok(rect.x >= left - 0.5, `${review.id} ${step.id}: nothing of the step is framed under a panel ${left} wide`)
            assert.ok(inside(rect, area))
          }
        }
      }
    }
  }
})

test('the explicit whole-graph view still fits the graph', async () => {
  const review = await stressReview()
  const all = review.nodes.map((node) => nodeRect(node.kind, node.position))
  const area = uncoveredArea({ width: 1200, height: 800 }, { top: 112, bottom: 68, left: 300 })
  const { camera } = composeShot({ focus: all, area })
  for (const rect of all) assert.ok(inside(toScreen(rect, camera, area), area))
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

test('only a step frames the camera: a node looked at is told where it is', () => {
  // Going to a step, jumping to one, hobkin's cursor and G frame what is in focus, or the whole graph with nothing in it.
  for (const kind of ['step', 'jump', 'whole', 'open'] as const) assert.equal(framingOf({ first: false, kind, focus: 2 }), 'step', kind)
  assert.equal(framingOf({ first: false, kind: 'whole', focus: 0 }), 'whole')
  // A node clicked, walked to with the arrows or found by name is shown only if it is out of view (revealNode).
  assert.equal(framingOf({ first: false, kind: 'detour', focus: 1 }), 'reveal')
  // The first look frames, whatever brought it.
  assert.equal(framingOf({ first: true, kind: 'detour', focus: 1 }), 'step')
})

test('the opening and first walk keep the entry node centered beside the dock throughout the zoom', () => {
  const area = { x: 300, y: 112, width: 850, height: 640 }
  const graph = storyDock(area).graph
  const entry = { x: 7000, y: -900, width: 280, height: 120 }
  const nodes = new Map([['helper', { ...entry, x: -2000 }], ['handler', entry]])
  const story = [{ focus: [] }, { focus: ['handler', 'helper'] }, { focus: ['helper'] }]
  const opening = entryCamera(story, 0, nodes, area)!
  const firstWalk = entryCamera(story, 1, nodes, area)!

  assert.equal(opening.zoom, 0.5)
  assert.ok(firstWalk.zoom > opening.zoom)
  assert.deepEqual({ ...firstWalk, zoom: opening.zoom }, opening, 'only zoom changes')
  for (const zoom of [opening.zoom, 0.8, firstWalk.zoom]) {
    const box = toScreen(entry, { ...opening, zoom }, area)
    assert.ok(Math.abs(box.x + box.width / 2 - (graph.x + graph.width / 2)) < 1e-8)
    assert.ok(Math.abs(box.y + box.height / 2 - (graph.y + graph.height / 2)) < 1e-8)
  }
  assert.equal(entryCamera(story, 2, nodes, area), null, 'later steps use normal framing')
})

test('the step dock reserves a strip on the right; opening code changes its height, not its anchor', () => {
  const area = { x: 300, y: 112, width: 850, height: 640 }
  const { card, graph } = storyDock(area)
  assert.equal(card.x + card.width, area.x + area.width - FRAME.margin)
  assert.equal(card.y, area.y + FRAME.margin)
  assert.ok(graph.width > 0 && graph.x + graph.width < card.x)
  const shorter = storyDock({ ...area, height: 360 }).card
  assert.deepEqual(shorter, { ...card, height: card.height - 280 })
})

/** The user's picture (2026-11-26): the zone of a test left of the zone of the code it covers, as the graph lays them out. */
function besideZones() {
  const zones = [
    { id: 'settings', layer: 'model' },
    { id: 'settings-tests', layer: 'test:model' },
  ]
  const nodes: ZoneNode[] = [
    { id: 'stores', kind: 'code', zone: 'settings', change: 'modified' },
    { id: 'rejects', kind: 'test', zone: 'settings-tests', change: 'added' },
  ]
  const positions = layoutZones(nodes, [{ from: 'rejects', to: 'stores' }], zones)
  return { cards: nodes.map((node) => nodeRect(node.kind, positions[node.id]!)), regions: [...zoneRects(nodes, positions).values()] }
}

test("a step's card keeps off a zone's heading as it keeps off a node", () => {
  // Each heading is the room its region keeps over its nodes.
  const { regions } = besideZones()
  assert.deepEqual(headingsOf(regions), regions.map((region) => ({ x: region.x, y: region.y, width: region.width, height: ZONE_FRAME.head })))
  // The focus with a zone on its right whose first card stands lower: the card on the right would sit on that heading.
  const focus = { x: 0, y: 300, ...NODE_SIZE.code }
  const lower = { x: 408, y: 400, ...NODE_SIZE.code }
  const region = { x: 380, y: 304, width: 344, height: 260 }
  const area = { x: 0, y: 0, width: 1400, height: 900 }
  const shot = frameStep({ focus: [focus], others: [lower, ...headingsOf([region])], area, card: { width: 400, height: 100 } })
  const heading = toScreen(headingsOf([region])[0]!, shot.camera, area)
  assert.ok(shot.card)
  assert.equal(overlap(shot.card, heading), false, 'the card is clear of the heading')
  assert.equal(overlap(shot.card, toScreen(lower, shot.camera, area)), false, 'and of the card under it')
})
