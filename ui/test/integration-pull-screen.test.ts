import assert from 'node:assert/strict'
import test from 'node:test'
import type { IntegrationScreen } from '../../shared/integration/manifest.ts'
import type { WindowPart } from '../src/integration/contract.ts'
import { pullScreens } from '../src/integration/pull-screen.ts'
import { setWindowParts } from '../src/integration/registry.ts'

const screen = (id: string): IntegrationScreen => ({ id, label: id.toUpperCase(), line: '', keywords: [] })
const part = (id: string, { pulls, screens }: { pulls?: boolean; screens?: boolean }): WindowPart => ({
  manifest: { id, name: id, line: '', commands: {}, screens: [screen(id)] },
  unknown: null,
  sample: () => null,
  ...(pulls ? { pulls: () => [] } : {}),
  ...(screens ? { screens: [{ id, icon: (() => null) as never, component: () => null }] } : {}),
})

test('the screens the pull requests row points to are those of every integration with pull requests that has one, in folder order', () => {
  setWindowParts([])
  assert.deepEqual(pullScreens(), [])
  setWindowParts([part('chat', { screens: true }), part('forge', { pulls: true })])
  assert.deepEqual(pullScreens(), [], 'a part with pull requests and no screen has nowhere to go')
  setWindowParts([part('github', { pulls: true, screens: true }), part('chat', { screens: true }), part('forge', { pulls: true, screens: true })])
  assert.deepEqual(pullScreens().map(({ label }) => label), ['FORGE', 'GITHUB'], 'two code hosts are both offered, neither in place of the other')
  setWindowParts([])
})
