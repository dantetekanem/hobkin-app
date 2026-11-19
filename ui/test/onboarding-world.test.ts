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

// The character's art, as shares of its square around its middle (avatar/pets.ts: the body, its feet, its tallest part, and the eyes).
const tipOf = (seat: Seat) => seat.y - FACE * seat.scale * ((100 - 28) / 256)
const eyesBottomOf = (seat: Seat) => seat.y + FACE * seat.scale * (0.148 + 8 / 256)
const footOf = (seat: Seat) => seat.y + footBelow(seat.scale)
const bodyHalf = (seat: Seat) => FACE * seat.scale * (66 / 256)
const footHalf = (seat: Seat) => FACE * seat.scale * ((126 + 14.5 - 100) / 256)

const across = (x: number, half: number) => [-1, -0.5, 0, 0.5, 1].map((share) => x + share * half)
const layerOf = (shape: Shape) => (shape === 'hill' ? LAYER.hill : LAYER.ridges[shape])

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

test('it hides behind the last ridge of mountains, on the right, then peeks until its eyes are over the crest', () => {
  for (const viewport of VIEWPORTS) {
    const { hidden, hiddenLayer, peek } = arrivalFor(viewport)
    const behind = RIDGES.find((ridge) => LAYER.ridges[ridge] > hiddenLayer)!
    const name = `${viewport.width}x${viewport.height}`

    assert.equal(behind, 3, 'it hides behind the nearest mountains, so its first hop takes it to the ground')
    assert.ok(hiddenLayer > LAYER.ridges[2], 'and in front of the ones farther away')
    assert.ok(hidden.x / viewport.width >= 0.68 && hidden.x / viewport.width <= 0.8, `on the right in ${name}`)
    assert.ok(hidden.scale >= 0.4 && hidden.scale <= 0.6, 'smaller than it will be, because it is still far')
    for (const x of across(hidden.x, bodyHalf(hidden))) assert.ok(tipOf(hidden) > crestY(behind, x, viewport), `the whole pet is below the crest at ${x.toFixed(1)} in ${name}`)

    const crest = crestY(behind, peek.x, viewport)
    assert.equal(peek.x, hidden.x)
    assert.equal(peek.scale, hidden.scale)
    assert.ok(crest - eyesBottomOf(peek) >= 0.5 && crest - eyesBottomOf(peek) <= 6, `the eyes are just over the crest in ${name}: ${crest - eyesBottomOf(peek)}`)
    assert.ok(footOf(peek) > crest, 'its foot is still below the crest')
    assert.ok(crestY('hill', peek.x, viewport) > eyesBottomOf(peek), `the hill does not cover the eyes in ${name}`)
  }
})

test('it comes over the mountains and hops along the ground to the middle, never landing on a mountain', () => {
  for (const viewport of VIEWPORTS) {
    const { hiddenLayer, peek, hops, stage } = arrivalFor(viewport)
    const name = `${viewport.width}x${viewport.height}`
    const [overTheRidge, ...alongTheHill] = hops

    assert.equal(hops.length, viewport.width >= 1100 ? 5 : 4, `hops in ${name}`)
    assert.deepEqual(stage, stageFor(viewport))
    assert.deepEqual(hops.at(-1)!.to, stage, 'the last hop lands on the stage')
    assert.equal(hops.at(-1)!.to.scale, 1)
    assert.ok(hops[0]!.lift < hops.at(-1)!.lift, 'a far, small hop rises less than the last big one')

    // The first hop takes it over the ridge and down behind the hill, which hides its foot and not its eyes.
    const hillThere = crestY('hill', overTheRidge!.to.x, viewport)
    assert.ok(overTheRidge!.layer > LAYER.ridges[3] && overTheRidge!.layer < LAYER.hill, `the first hop lands between the mountains and the hill in ${name}`)
    assert.ok(footOf(overTheRidge!.to) > hillThere, `the hill hides its foot in ${name}`)
    assert.ok(eyesBottomOf(overTheRidge!.to) < hillThere, `its eyes show over the hill in ${name}`)

    // Every hop after it lands on the hill itself, which is the ground, in front of everything.
    for (const [index, hop] of alongTheHill.entries()) {
      const foot = footOf(hop.to)
      const ground = crestY('hill', hop.to.x, viewport)
      assert.equal(hop.layer, LAYER.front, `hop ${index + 2} in ${name} is in front of everything`)
      assert.ok(foot - ground >= -0.5 && foot - ground <= 4, `hop ${index + 2} in ${name} lands on the ground: ${foot - ground}`)
    }

    let from: Seat = peek
    let layer = hiddenLayer
    let lift = 0
    for (const [index, hop] of hops.entries()) {
      const label = `hop ${index + 1} in ${name}`

      assert.ok(hop.to.x < from.x && hop.to.x >= viewport.width / 2, `${label} moves toward the middle`)
      assert.ok(hop.to.scale >= from.scale, `${label} does not shrink`)
      assert.ok(hop.layer >= layer, `${label} does not go back a layer`)
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
