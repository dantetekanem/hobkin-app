import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { createStore } from 'zustand/vanilla'
import type { HostState } from '../src/lib/host/state.ts'

// No browser, host connection or app startup: the real theme code against a tiny DOM and a host that records commands.
test('choosing Custom after a built-in theme puts the last kept theme back on, through the host', async () => {
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
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
    },
  }
  const saved = new Map<string, string>()
  const ran: [string, unknown][] = []
  const hostStore = createStore<Pick<HostState, 'link' | 'home' | 'epoch' | 'appearance' | 'themes'>>()(() => ({ link: 'open', home: '/fake/kept', epoch: 1, appearance: null, themes: null }))
  Object.assign(globalThis, {
    window: globalThis,
    document: { documentElement: root },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
    },
    __keptHost: hostStore,
    __keptRan: ran,
  })
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '@/lib/host/client.ts') {
        return { url: 'data:text/javascript,export const hostStore = globalThis.__keptHost; export async function runCommand(name, args) { globalThis.__keptRan.push([name, args]); return { ok: true } }', shortCircuit: true }
      }
      if (specifier.startsWith('@/')) return next(new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, context)
      return next(specifier, context)
    },
  })
  try {
    const { setThemeChoice } = await import('../src/app/theme.ts')
    const burger = { background: '#fff0d3', surface: '#fffaed', text: '#482b1b', muted: '#785b43', accent: '#b93224' }
    const dracula = { background: '#282a36', surface: '#343746', text: '#f8f8f2', muted: '#b5b9d6', accent: '#bd93f9' }
    const kept = [
      { id: '0000000b', name: 'Burger Joint', asked: null, palette: burger, at: '2026-11-13T22:51:51.303Z' },
      { id: '0000000a', name: 'Dracula', asked: 'dracula!', palette: dracula, at: '2026-11-13T03:30:11.423Z' },
    ]
    hostStore.setState({ appearance: { id: 1, name: 'Burger Joint', palette: burger }, themes: { themes: kept, worn: '0000000b', showing: true } })
    assert.equal(properties.get('--hb-custom-bg'), burger.background)

    setThemeChoice('light')
    assert.equal(properties.has('--hb-custom-bg'), false)
    assert.deepEqual(ran.at(-1), ['appearance.use', { theme: 'light' }])
    hostStore.setState({ appearance: { id: 2, name: null, palette: burger, use: 'light' }, themes: { themes: kept, worn: '0000000b', showing: false } })

    ran.length = 0
    setThemeChoice('custom')
    assert.deepEqual(ran, [['appearance.pick', { id: '0000000b' }]], 'the host is asked for the theme shown last')
    assert.equal(properties.has('--hb-custom-bg'), false, 'no plain colors stand in while the host answers')
    hostStore.setState({ appearance: { id: 3, name: 'Burger Joint', palette: burger }, themes: { themes: kept, worn: '0000000b', showing: true } })
    assert.equal(properties.get('--hb-custom-bg'), burger.background, 'the kept theme is back')

    // With nothing kept, Custom starts from the colors showing, as before.
    setThemeChoice('dark')
    hostStore.setState({ themes: { themes: [], worn: null, showing: false } })
    ran.length = 0
    setThemeChoice('custom')
    assert.deepEqual(ran, [])
    assert.ok(properties.has('--hb-custom-bg'))
  } finally {
    hooks.deregister()
  }
})
