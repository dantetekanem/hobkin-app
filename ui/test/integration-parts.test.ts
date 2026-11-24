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

test('loading the parts again, as a hot update of the window does, adds their commands and screens again without a clash', async () => {
  const { isCommand, isScreen } = await import('#shared/commands/registry.ts')
  const logged: string[] = []
  const folders = { '../sketch/window.tsx': async () => ({ default: part }) }
  await loadWindowParts(folders, (line) => logged.push(line))
  // A part whose manifest module was loaded again brings commands that are new objects with the same names.
  const again: WindowPart<Sketch> = { ...part, manifest: { ...manifest, commands: { 'sketch.draw': { ...manifest.commands['sketch.draw'] } } } }
  await loadWindowParts({ '../sketch/window.tsx': async () => ({ default: again }) }, (line) => logged.push(line))
  assert.deepEqual(logged, [])
  assert.ok(isCommand('sketch.draw') && isScreen('sketch'))
})

test("a part's screen is in the menu walk after Work, and opened and closed while out of the menu it goes back to where it was opened from", async () => {
  const { GitPullRequest } = await import('lucide-react')
  const { walkScreens, inMenu, screenIndex } = await import('../src/app/screens.ts')
  const drawn: WindowPart<Sketch> = { ...part, screens: [{ id: 'sketch', icon: GitPullRequest, component: () => null }] }
  setWindowParts([drawn])
  const MAIN = ['home', 'reports', 'routines', 'actions', 'work']

  assert.deepEqual(walkScreens({ screen: 'home', reviewOpen: false }), [...MAIN, 'sketch'])
  assert.ok(screenIndex('sketch') > screenIndex('work') && screenIndex('sketch') < screenIndex('world'), 'after Work and before the contextual screens')
  assert.deepEqual(walkScreens({ screen: 'home', reviewOpen: false, outOfMenu: ['sketch'] }), MAIN, 'taken out of the menu')
  assert.deepEqual(walkScreens({ screen: 'sketch', reviewOpen: false, outOfMenu: ['sketch'] }), [...MAIN, 'sketch'], 'in the walk while open')
  assert.equal(inMenu('sketch', ['sketch']), false)

  const { useView } = await import('../src/app/view-store.ts')
  useView.setState({ screen: 'reports', trail: [], screenReturn: null })
  useView.getState().openPartScreen('sketch')
  assert.deepEqual([useView.getState().screen, useView.getState().screenReturn], ['sketch', 'reports'])
  useView.getState().closePartScreen()
  assert.equal(useView.getState().screen, 'reports')
})

test('with no part for a screen, the window has no such screen', async () => {
  const { screenIndex, walkScreens } = await import('../src/app/screens.ts')
  assert.equal(screenIndex('sketch'), -1)
  assert.deepEqual(walkScreens({ screen: 'home', reviewOpen: false }), ['home', 'reports', 'routines', 'actions', 'work'])
})
