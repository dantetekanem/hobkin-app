import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FACE, footBelow, type Seat, type Viewport } from '../src/features/onboarding/face-size.ts'
import { LAYER, arrivalFor, boxOf, crestY, pathOf, stageFor, type Shape, type Hop } from '../src/features/onboarding/world-geometry.ts'

const VIEWPORTS: Viewport[] = [
  { width: 900, height: 600 },
  { width: 1280, height: 800 },
  { width: 1728, height: 1117 },
  { width: 2560, height: 1440 },
]
const SHAPES: Shape[] = [0, 1, 2, 3, 'hill']
const RIDGES = [0, 1, 2, 3] as const

// The character's art, as shares of its square around its middle (avatar/moods.tsx, HOOD_PATH and the eyes).
const tipOf = (seat: Seat) => seat.y - FACE * seat.scale * 0.305
const eyesBottomOf = (seat: Seat) => seat.y + FACE * seat.scale * (0.148 + 8 / 256)
const footOf = (seat: Seat) => seat.y + footBelow(seat.scale)
const hoodHalf = (seat: Seat) => FACE * seat.scale * (60 / 256)
const footHalf = (seat: Seat) => FACE * seat.scale * (52 / 256)

const across = (x: number, half: number) => [-1, -0.5, 0, 0.5, 1].map((share) => x + share * half)
const layerOf = (shape: Shape) => (shape === 'hill' ? LAYER.hill : LAYER.ridges[shape])
const nearerThan = (shape: Shape): Shape[] => (shape === 'hill' ? [] : [...RIDGES.filter((ridge) => ridge > shape), 'hill'])

/** The shape a layer stands in front of: the nearest one under it. */
function standsOn(layer: number): Shape {
  const under = SHAPES.filter((shape) => layerOf(shape) < layer)
  assert.ok(under.length > 0, `layer ${layer} is behind everything`)
  return under.at(-1)!
}

/** The quadratic curves of a drawn path, in its own 1000 by 1000 box. */
function curvesOf(path: string): { from: [number, number]; control: [number, number]; to: [number, number] }[] {
  const commands = [...path.matchAll(/([MQLVHZ])([^MQLVHZ]*)/g)].map(([, name, args]) => ({ name, values: args!.trim().split(/[\s,]+/).filter(Boolean).map(Number) }))
  assert.equal(commands[0]?.name, 'M', 'the path starts with a move')
  let at: [number, number] = [commands[0]!.values[0]!, commands[0]!.values[1]!]
  const curves = []
  for (const { name, values } of commands.slice(1)) {
    if (name !== 'Q') break
    for (let index = 0; index < values.length; index += 4) {
      const control: [number, number] = [values[index]!, values[index + 1]!]
      const to: [number, number] = [values[index + 2]!, values[index + 3]!]
      curves.push({ from: at, control, to })
      at = to
    }
  }
  return curves
}

/** Where a point of a shape's box lands in the window: the same placement World gives the box (top from boxOf, down to the bottom, full width). */
function inWindow(shape: Shape, [u, v]: [number, number], { width, height }: Viewport): [number, number] {
  const { share, offset } = boxOf(shape)
  const top = share * height + offset
  return [(u / 1000) * width, top + (v / 1000) * (height - top)]
}

test('crestY follows the outline each shape is drawn with', () => {
  for (const viewport of VIEWPORTS) {
    for (const shape of SHAPES) {
      const curves = curvesOf(pathOf(shape))
      assert.ok(curves.length >= 2, `shape ${shape} is drawn with curves`)
      assert.ok(curves[0]!.from[0] <= 0 && curves.at(-1)!.to[0] >= 1000, `shape ${shape} spans the window`)

      for (const { from, control, to } of curves) {
        for (let step = 0; step <= 10; step += 1) {
          const t = step / 10
          const along = (axis: 0 | 1) => (1 - t) ** 2 * from[axis] + 2 * (1 - t) * t * control[axis] + t ** 2 * to[axis]
          const [x, y] = inWindow(shape, [along(0), along(1)], viewport)
          if (x < 0 || x > viewport.width) continue

          const crest = crestY(shape, x, viewport)
          assert.ok(Math.abs(crest - y) < 0.05, `shape ${shape} at x ${x.toFixed(1)} in ${viewport.width}x${viewport.height}: ${crest} vs drawn ${y}`)
        }
      }
    }
  }
})

test('the far ridges are the tallest, and the hill is highest in the middle of the window', () => {
  for (const viewport of VIEWPORTS) {
    const xs = Array.from({ length: 201 }, (_, index) => (index / 200) * viewport.width)
    const highest = (shape: Shape) => Math.min(...xs.map((x) => crestY(shape, x, viewport)))
    for (const ridge of [1, 2, 3] as const) assert.ok(highest(RIDGES[ridge - 1]!) < highest(ridge), `ridge ${ridge - 1} rises above ridge ${ridge}`)

    const middle = crestY('hill', viewport.width / 2, viewport)
    for (const x of xs) assert.ok(crestY('hill', x, viewport) >= middle - 0.01, `the hill is no higher at ${x} than in the middle`)
  }
})

test('the layers stack far to near, with room between them', () => {
  const order = [...LAYER.ridges, LAYER.hill, LAYER.front]
  for (let index = 1; index < order.length; index += 1) assert.ok(order[index]! - order[index - 1]! >= 2, 'each layer leaves a gap above the last')
})

test('the stage is the middle of the window, standing on the crest of the hill', () => {
  for (const viewport of VIEWPORTS) {
    const stage = stageFor(viewport)

    assert.equal(stage.x, viewport.width / 2)
    assert.equal(stage.scale, 1)
    assert.ok(Math.abs(footOf(stage) - crestY('hill', stage.x, viewport)) <= 2, `the foot is on the hill in ${viewport.width}x${viewport.height}`)
    assert.ok(Math.abs(stage.y / viewport.height - 0.44) <= 0.02, `the stage is near 44% down in ${viewport.width}x${viewport.height}`)
  }
})

test('it hides small behind a middle ridge at about 72% across, then peeks until its eyes are over the crest', () => {
  for (const viewport of VIEWPORTS) {
    const { hidden, hiddenLayer, peek } = arrivalFor(viewport)
    const behind = RIDGES.find((ridge) => LAYER.ridges[ridge] > hiddenLayer)!
    const name = `${viewport.width}x${viewport.height}`

    assert.ok(behind === 1 || behind === 2, `it hides behind a middle ridge, not ${behind}`)
    assert.ok(hiddenLayer > LAYER.ridges[behind - 1]!, 'and in front of the ones farther away')
    assert.ok(Math.abs(hidden.x / viewport.width - 0.72) <= 0.03, `about 72% across in ${name}`)
    assert.ok(hidden.scale >= 0.3 && hidden.scale <= 0.4, 'small, because it is far away')
    for (const x of across(hidden.x, hoodHalf(hidden))) assert.ok(tipOf(hidden) > crestY(behind, x, viewport), `the whole hood is below the crest at ${x.toFixed(1)} in ${name}`)

    const crest = crestY(behind, peek.x, viewport)
    assert.equal(peek.x, hidden.x)
    assert.equal(peek.scale, hidden.scale)
    assert.ok(crest - eyesBottomOf(peek) >= 0.5 && crest - eyesBottomOf(peek) <= 6, `the eyes are just over the crest in ${name}: ${crest - eyesBottomOf(peek)}`)
    assert.ok(footOf(peek) > crest, 'its foot is still below the crest')
    for (const nearer of nearerThan(behind)) assert.ok(crestY(nearer, peek.x, viewport) > eyesBottomOf(peek), `nothing nearer covers the eyes in ${name}`)
  }
})

test('it hops toward the middle, landing on each nearer ridge and growing, and the last hop is the stage', () => {
  for (const viewport of VIEWPORTS) {
    const { hiddenLayer, peek, hops, stage } = arrivalFor(viewport)
    const name = `${viewport.width}x${viewport.height}`

    assert.equal(hops.length, viewport.width >= 1100 ? 5 : 4, `hops in ${name}`)
    assert.deepEqual(stage, stageFor(viewport))
    assert.deepEqual(hops.at(-1)!.to, stage, 'the last hop lands on the stage')
    assert.equal(hops.at(-1)!.layer, LAYER.front)
    assert.equal(hops.at(-1)!.to.scale, 1)
    assert.ok(hops[0]!.lift < hops.at(-1)!.lift, 'a far, small hop rises less than the last big one')

    let from: Seat = peek
    let layer = hiddenLayer
    let lift = 0
    for (const [index, hop] of hops.entries()) {
      const label = `hop ${index + 1} in ${name}`
      const shape = standsOn(hop.layer)
      const foot = footOf(hop.to)
      const crest = crestY(shape, hop.to.x, viewport)

      assert.ok(hop.to.x < from.x && hop.to.x >= viewport.width / 2, `${label} moves toward the middle`)
      assert.ok(hop.to.scale >= from.scale, `${label} does not shrink`)
      assert.ok(hop.layer >= layer, `${label} does not go back a layer`)
      assert.ok(foot - crest >= -0.5 && foot - crest <= 4, `${label} lands on the crest of ${shape}: ${foot - crest}`)
      for (const nearer of nearerThan(shape)) {
        assert.ok(hop.layer < layerOf(nearer), `${label} stays behind ${nearer}`)
        for (const x of across(hop.to.x, footHalf(hop.to))) assert.ok(crestY(nearer, x, viewport) >= foot - 0.5, `${label} is in plain view over ${nearer}`)
      }
      assert.ok(hop.lift >= lift && hop.lift > 0, `${label} rises at least as high as the one before`)
      assert.ok(hop.time >= 0.4 && hop.time <= 0.65, `${label} takes ${hop.time}s`)
      assertClears(hop, from, layer, viewport, label)

      from = hop.to
      layer = hop.layer
      lift = hop.lift
    }
  }
})

/** At the top of a hop, halfway along, the character is over every shape it changes sides with, so the change is never seen. */
function assertClears(hop: Hop, from: Seat, layer: number, viewport: Viewport, label: string) {
  const top: Seat = { x: (from.x + hop.to.x) / 2, y: Math.min(from.y, hop.to.y) - hop.lift, scale: Math.max(from.scale, hop.to.scale) }
  const crossed = SHAPES.filter((shape) => layerOf(shape) > layer && layerOf(shape) < hop.layer)
  for (const shape of crossed) {
    for (const x of across(top.x, footHalf(top))) assert.ok(footOf(top) < crestY(shape, x, viewport), `${label} clears ${shape} at the top`)
  }
}
