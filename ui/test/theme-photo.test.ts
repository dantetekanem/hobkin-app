import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { createStore } from 'zustand/vanilla'
import type { HostState } from '../src/lib/host/state.ts'

// No browser, host connection, native bridge or app startup: exercise the real theme subscriber against a tiny DOM.
test('photo CSS clears on off, every built-in choice and root changes, and restores on a canonical receipt', async () => {
  const properties = new Map<string, string>()
  const classes = new Set(['dark'])
  const root = {
    dataset: { motion: 'still' } as Record<string, string>,
    style: {
      setProperty: (key: string, value: string) => properties.set(key, value),
      removeProperty: (key: string) => properties.delete(key),
    },
    classList: {
      contains: (name: string) => classes.has(name),
      toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name),
    },
  }
  const saved = new Map<string, string>()
  const hostStore = createStore<Pick<HostState, 'link' | 'home' | 'epoch' | 'appearance'>>()(() => ({ link: 'open', home: '/fake/photo/a', epoch: 1, appearance: null }))
  Object.assign(globalThis, {
    window: globalThis,
    document: { documentElement: root },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
    },
    __photoHost: hostStore,
  })
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '@/lib/host/client.ts') {
        return { url: 'data:text/javascript,export const hostStore = globalThis.__photoHost; export async function runCommand() { return {ok:true} }', shortCircuit: true }
      }
      if (specifier.startsWith('@/')) return next(new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, context)
      return next(specifier, context)
    },
  })
  try {
    const { setThemeChoice } = await import('../src/app/theme.ts')
    const palette = { background: '#080c1b', surface: '#151b30', text: '#f1f3ff', muted: '#b2bbd5', accent: '#b89af5' }
    const receipt = { id: 1, name: 'Milky Way', palette, background: { kind: 'photo', id: 'milky-way' } as const }
    hostStore.setState({ appearance: receipt })
    assert.equal(root.dataset.photo, 'milky-way')
    assert.match(properties.get('--hb-bg-image')!, /milky-way.jpg/)

    hostStore.setState({ appearance: { ...receipt, id: 2, background: undefined } })
    assert.equal(properties.has('--hb-bg-image'), false)
    assert.equal(root.dataset.photo, undefined)

    let id = 3
    for (const theme of ['light', 'dark', 'system'] as const) {
      hostStore.setState({ appearance: { ...receipt, id: id++ } })
      setThemeChoice(theme)
      assert.equal(properties.has('--hb-bg-image'), false)
      assert.equal(root.dataset.photo, undefined)
    }
    hostStore.setState({ appearance: { ...receipt, id: id++ } })
    hostStore.setState({ home: '/fake/photo/b', epoch: 2, appearance: null })
    assert.equal(properties.has('--hb-bg-image'), false)
    assert.equal(root.dataset.photo, undefined)
    hostStore.setState({ appearance: receipt })
    assert.equal(root.dataset.photo, 'milky-way')
    hostStore.setState({ appearance: { ...receipt, id: 2, use: 'system' } })
    assert.equal(properties.has('--hb-bg-image'), false)
    assert.equal(root.dataset.photo, undefined)
  } finally {
    hooks.deregister()
  }
})
