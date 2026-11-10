import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { NODE_SIZE } from '#shared/review/layout.ts'
import type { Review } from '#shared/review/types.ts'
import { applyMemory, createReviewMemory } from '../src/features/review/state/memory.ts'
import { pickTravel, rideOffset, wireEnds } from '../src/features/review/story/travel.ts'
import { wireCurve } from '../src/features/review/graph/wire-path.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const idOf = (title: string) => sample.nodes.find((node) => node.title === title)!.id
const focusOf = (title: string) => sample.story.find((step) => step.title === title)!.focus
const [doingAfter, toolDoing, searchingTool] = [idOf('doingAfter'), idOf('toolDoing'), idOf('searchingTool')]

test('picks the connecting wire, or a straight glide when there is none', () => {
  const word = focusOf('doingAfter: from an event to a word')
  const helpers = focusOf('Two helpers, one for each kind of event')
  const context = focusOf('A rule that was already there')
  const runtime = focusOf('The runtime keeps the word for one turn')

  // Forward along the story: the wire that joins the old focus to the new one, ridden in its own direction.
  assert.deepEqual(pickTravel(sample.edges, word, helpers), { wire: `calls:${doingAfter}>${toolDoing}`, reversed: false })
  assert.deepEqual(pickTravel(sample.edges, helpers, context), { wire: `calls:${toolDoing}>${searchingTool}`, reversed: false })
  // Back along the story: the same wire, ridden the other way.
  assert.deepEqual(pickTravel(sample.edges, helpers, word), { wire: `calls:${doingAfter}>${toolDoing}`, reversed: true })
  // Nothing joins the context to the runtime, so the camera glides straight.
  assert.equal(pickTravel(sample.edges, context, runtime), null)
  // From or to the whole graph there is no wire to ride.
  assert.equal(pickTravel(sample.edges, [], word), null)
  assert.equal(pickTravel(sample.edges, word, []), null)
  // Staying on the same node is no travel at all.
  assert.equal(pickTravel(sample.edges, word, word), null)

  // Every step of the sample agrees with the wire the review file names for it.
  for (let index = 1; index < sample.story.length; index += 1) {
    const step = sample.story[index]!
    const picked = pickTravel(sample.edges, sample.story[index - 1]!.focus, step.focus, step.travel)
    assert.equal(picked?.wire, step.travel, step.title)
  }

  // A jump across the story, as from the rail, still rides a wire when one joins the two places.
  assert.deepEqual(pickTravel(sample.edges, focusOf('Three promises about one word'), word), { wire: `implements:A3>${doingAfter}`, reversed: false })

  // A wire the reviewer removed is not there to ride.
  const memory = createReviewMemory()
  memory.getState().decideWire(sample, `calls:${toolDoing}>${searchingTool}`, 'removed')
  const view = applyMemory(sample, memory.getState().of(sample))
  assert.equal(pickTravel(view.edges, helpers, context), null)
})

test('the camera leans the way the wire bends, and lands exactly where it was sent', () => {
  const edge = sample.edges.find((entry) => entry.id === `calls:${doingAfter}>${toolDoing}`)!
  const ends = wireEnds(edge, sample.nodes)
  const from = sample.nodes.find((node) => node.id === doingAfter)!
  assert.deepEqual(ends.source, { x: from.position.x + NODE_SIZE.code.width, y: from.position.y + NODE_SIZE.code.height / 2 }, 'a wire leaves the middle of the right edge')

  const curve = wireCurve(ends.source, ends.target)
  for (const reversed of [false, true]) {
    // At both ends the offset is nothing, so the camera starts and stops where the framing says.
    assert.deepEqual(rideOffset(curve, reversed, 0), { x: 0, y: 0 })
    assert.deepEqual(rideOffset(curve, reversed, 1), { x: 0, y: 0 })
    // Along the way it is the gap between the wire and the straight line between its ends.
    const at = reversed ? 0.75 : 0.25
    const point = curve.pointAt(at)
    const straight = { x: ends.source.x + (ends.target.x - ends.source.x) * at, y: ends.source.y + (ends.target.y - ends.source.y) * at }
    const offset = rideOffset(curve, reversed, 0.25)
    assert.ok(Math.abs(offset.x - (point.x - straight.x)) < 1e-9 && Math.abs(offset.y - (point.y - straight.y)) < 1e-9)
  }
  // The wire bends, so the lean is real.
  assert.ok(Math.abs(rideOffset(curve, false, 0.25).y) > 1)
  // A glide has no wire and no lean.
  assert.deepEqual(rideOffset(null, false, 0.4), { x: 0, y: 0 })
})

test('a wire is a smooth curve with level ends, forward or back', () => {
  for (const [source, target] of [
    [{ x: 0, y: 0 }, { x: 300, y: 120 }],
    [{ x: 300, y: 0 }, { x: 0, y: 200 }],
    [{ x: 0, y: 0 }, { x: 40, y: 0 }],
  ] as const) {
    const curve = wireCurve(source, target)
    assert.deepEqual(curve.pointAt(0), source)
    assert.deepEqual(curve.pointAt(1), target)
    // Level ends: just after the start and just before the end, the wire has barely left its pin's height.
    assert.ok(Math.abs(curve.pointAt(0.02).y - source.y) < Math.abs(target.y - source.y) * 0.02 + 0.5)
    assert.ok(Math.abs(curve.pointAt(0.98).y - target.y) < Math.abs(target.y - source.y) * 0.02 + 0.5)
    assert.ok(curve.pointAt(0.02).x > source.x, 'it leaves to the right')
    assert.ok(curve.pointAt(0.98).x < target.x, 'and arrives from the left')
    assert.match(curve.d, /^M[-\d.]+ [-\d.]+C/)
  }
})
