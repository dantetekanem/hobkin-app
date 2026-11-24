import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { Type } from 'typebox'
import { defineIntegration } from '#shared/integration/manifest.ts'
import type { HostMessage } from '#shared/protocol/messages.ts'
import type { WindowPart } from '../src/integration/contract.ts'
import { loadWindowParts } from '../src/integration/load-parts.ts'
import { setWindowParts, windowParts } from '../src/integration/registry.ts'
import { sliceOf } from '../src/integration/slice.ts'
import { applyHostMessage, initialHostState } from '../src/lib/host/state.ts'

const manifest = defineIntegration({
  id: 'sketch',
  name: 'Sketch',
  line: 'A test integration',
  commands: { 'sketch.draw': { description: 'Draw.', runs: 'host', args: Type.Object({ lines: Type.Integer() }, { additionalProperties: false }) } },
  screens: [{ id: 'sketch', label: 'Sketch', line: 'A page of its own', keywords: ['draw'] }],
})

interface Sketch { lines: number }
const part: WindowPart<Sketch> = { manifest, unknown: { lines: -1 }, sample: (now) => ({ lines: now > 0 ? 3 : 0 }) }

afterEach(() => setWindowParts([]))

const state = (extra: Partial<typeof initialHostState> = {}) => ({ ...initialHostState, ...extra })
const message = (extra: object): HostMessage => ({ type: 'state', rev: 1, ...extra }) as HostMessage

test('a state message carries each integration slice by its id, and a reset without one drops it', () => {
  const sent = applyHostMessage(initialHostState, message({ reset: true, slices: { sketch: { lines: 5 } } }))
  assert.deepEqual(sent.slices, { sketch: { lines: 5 } })

  const kept = applyHostMessage(sent, message({ set: { busy: false } }))
  assert.deepEqual(kept.slices, { sketch: { lines: 5 } }, 'a message without slices changes none')

  const changed = applyHostMessage(kept, message({ slices: { sketch: { lines: 6 }, other: 1 } }))
  assert.deepEqual(changed.slices, { sketch: { lines: 6 }, other: 1 })

  const reset = applyHostMessage(changed, message({ reset: true, slices: { other: 2 } }))
  assert.deepEqual(reset.slices, { other: 2 }, 'a reset without the id means the host does not run it')
})

test('with no host a part shows its sample, made once; with a host its slice, else its unknown', () => {
  setWindowParts([part])
  const first = sliceOf<Sketch>('sketch', state(), false)
  assert.deepEqual(first, { lines: 3 })
  assert.equal(sliceOf('sketch', state(), false), first, 'the sample is made once per window')
  assert.deepEqual(sliceOf('sketch', state({ slices: { sketch: { lines: 9 } } }), true), { lines: 9 })
  assert.deepEqual(sliceOf('sketch', state(), true), { lines: -1 })
})

test('a folder that fails to load is left out and the others stay', async () => {
  const logged: string[] = []
  const loaded = await loadWindowParts(
    { '../b/window.tsx': async () => ({ default: part }), '../a/window.tsx': async () => { throw new Error('broken') }, '../c/window.tsx': async () => ({}) },
    (line) => logged.push(line),
  )
  assert.deepEqual(loaded.map((one) => one.manifest.id), ['sketch'])
  assert.deepEqual(windowParts().map((one) => one.manifest.id), ['sketch'])
  assert.equal(logged.length, 2)
})
