import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { createElement } from 'react'
import type { SpotlightTarget } from '../src/app/spotlight-entries.ts'
import { setWindowParts } from '../src/integration/registry.ts'
import { mountCounting } from './render-count.ts'

registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier.startsWith('@/') ? nextResolve(new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, context) : nextResolve(specifier, context)
} })
const timers = ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)!] as const)
for (const [key] of timers) Object.defineProperty(globalThis, key, { configurable: true, value: () => 0 })
const { useSpotlightTargets } = await import('../src/app/spotlight-entries.ts')
for (const [key, descriptor] of timers) Object.defineProperty(globalThis, key, descriptor)

test("the spotlight finds what a part says at once when the part's own state changes, such as a pull request the user ignored", async () => {
  let ignored = false
  const heard = new Set<() => void>()
  const pull: SpotlightTarget = { id: 'forge:1', kind: 'pull', title: 'PR 1', detail: 'acme/app #1', keywords: [], mark: { icon: (() => null) as never }, go: () => {} }
  setWindowParts([{
    manifest: { id: 'forge', name: 'Forge', line: '', commands: {}, screens: [] },
    unknown: null,
    sample: () => null,
    spotlight: () => (ignored ? [] : [pull]),
    subscribe(onChange) {
      heard.add(onChange)
      return () => heard.delete(onChange)
    },
  }])
  let targets: SpotlightTarget[] = []
  const Capture = () => {
    targets = useSpotlightTargets()
    return null
  }
  const mounted = await mountCounting(() => createElement(Capture))
  assert.ok(targets.some(({ id }) => id === 'forge:1'))
  await mounted.change(() => {
    ignored = true
    for (const onChange of heard) onChange()
  })
  assert.ok(!targets.some(({ id }) => id === 'forge:1'), 'the spotlight reads the part again without being opened again')
  await mounted.unmount()
  assert.equal(heard.size, 0, 'the spotlight stops hearing the part once it closes')
  setWindowParts([])
})
