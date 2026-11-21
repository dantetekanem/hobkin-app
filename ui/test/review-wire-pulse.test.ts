import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pulseLap } from '../src/features/review/graph/pulse-lap.ts'
import { wireCurve } from '../src/features/review/graph/wire-path.ts'

const shares = (times: number[]) => times.map((time) => Math.round(time * 1e6) / 1e6)

test('the pulse runs a wire at one speed: each point is reached at its share of the wire', () => {
  // A wire whose points crowd at its start, as a curve's do where it bends.
  const lap = pulseLap((t) => ({ x: 100 * t * t, y: 0 }), 5)
  assert.deepEqual(lap.transforms, ['translate(0px, 0px)', 'translate(6.25px, 0px)', 'translate(25px, 0px)', 'translate(56.25px, 0px)', 'translate(100px, 0px)'])
  assert.deepEqual(shares(lap.times), [0, 0.0625, 0.25, 0.5625, 1])
})

test('a lap of a real wire starts on its source pin, ends on its target pin and only moves forward', () => {
  const curve = wireCurve({ x: 40, y: 10 }, { x: 300, y: 180 })
  const lap = pulseLap(curve.pointAt)
  assert.equal(lap.transforms[0], 'translate(40px, 10px)')
  assert.equal(lap.transforms.at(-1), 'translate(300px, 180px)')
  assert.equal(lap.times[0], 0)
  assert.equal(lap.times.at(-1), 1)
  assert.ok(lap.times.every((time, index) => index === 0 || time > lap.times[index - 1]!))
})

test('a wire with no length still gives a lap the browser takes', () => {
  const lap = pulseLap(() => ({ x: 12, y: 12 }), 3)
  assert.deepEqual(lap.times, [0, 0.5, 1])
  assert.deepEqual(lap.transforms, ['translate(12px, 12px)', 'translate(12px, 12px)', 'translate(12px, 12px)'])
})
