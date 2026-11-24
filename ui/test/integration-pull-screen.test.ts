import assert from 'node:assert/strict'
import test from 'node:test'
import type { IntegrationScreen } from '../../shared/integration/manifest.ts'
import type { WindowPart } from '../src/integration/contract.ts'
import { pullScreen } from '../src/integration/pull-screen.ts'
import { setWindowParts } from '../src/integration/registry.ts'

const screen = (id: string): IntegrationScreen => ({ id, label: id.toUpperCase(), line: '', keywords: [] })
const part = (id: string, { pulls, screens }: { pulls?: boolean; screens?: boolean }): WindowPart => ({
  manifest: { id, name: id, line: '', commands: {}, screens: [screen(id)] },
  unknown: null,
  sample: () => null,
  ...(pulls ? { pulls: () => [] } : {}),
  ...(screens ? { screens: [{ id, icon: (() => null) as never, component: () => null }] } : {}),
})

test('the screen the pull requests row points to is the first integration with pull requests that has one', () => {
  setWindowParts([])
  assert.equal(pullScreen(), undefined)
  setWindowParts([part('chat', { screens: true }), part('forge', { pulls: true })])
  assert.equal(pullScreen(), undefined, 'a part with pull requests and no screen has nowhere to go')
  setWindowParts([part('chat', { screens: true }), part('forge', { pulls: true, screens: true })])
  assert.equal(pullScreen()?.label, 'FORGE')
  setWindowParts([])
})
