import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ActivityEntry } from '#shared/protocol/activity.ts'

// Settings are kept in the window's storage, which is empty here. Nothing listens to the window: nothing here is drawn on a page.
const storage = { getItem: () => null, setItem() {}, removeItem() {} }
const ignore = () => {}
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage, addEventListener: ignore, removeEventListener: ignore } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })

// The agent's page reads the review's diffs and its code's colors through modules counted here: each diff, each set of
// rows and each ask for colors. `@/` points at ui/src as Vite resolves it. Components are TSX, which Node reads once
// Vite's own transformer has turned it into JavaScript, and style sheets are nothing.
const { transformSync } = (await import(createRequire(import.meta.resolve('vite')).resolve('rolldown/experimental'))) as {
  transformSync: (file: string, source: string, options: object) => { code: string }
}
const DIFF_ROWS = new URL('../src/features/review/code/diff-rows.ts', import.meta.url).href
const COLORS = new URL('../src/features/agent-activity/use-colors.ts', import.meta.url).href
const counted = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`
const COUNTED_ROWS = counted(`
  import * as real from ${JSON.stringify(DIFF_ROWS)}
  export * from ${JSON.stringify(DIFF_ROWS)}
  export const calls = { diffOf: 0, unifiedRows: 0, colors: 0 }
  export function diffOf(...args) { calls.diffOf += 1; return real.diffOf(...args) }
  export function unifiedRows(...args) { calls.unifiedRows += 1; return real.unifiedRows(...args) }
`)
const COUNTED_COLORS = counted(`
  import * as real from ${JSON.stringify(COLORS)}
  import { calls } from ${JSON.stringify(COUNTED_ROWS)}
  export * from ${JSON.stringify(COLORS)}
  export function useColors(...args) { calls.colors += 1; return real.useColors(...args) }
`)
// A draw on the server reads a store's first state, so the blocks read Settings as each test says them.
const SETTINGS = new URL('../src/features/settings/store.ts', import.meta.url).href
const SAID_SETTINGS = counted(`
  import { useSettings as real } from ${JSON.stringify(SETTINGS)}
  export * from ${JSON.stringify(SETTINGS)}
  export const said = { openByDefault: {} }
  export const useSettings = (select) => select({ ...real.getState(), ...said })
`)
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === '@/features/review/code/diff-rows.ts') return { url: COUNTED_ROWS, shortCircuit: true }
    if (specifier === './use-colors.ts' && context.parentURL?.includes('/features/agent-activity/')) return { url: COUNTED_COLORS, shortCircuit: true }
    if (specifier === '../settings/store.ts' && context.parentURL?.endsWith('/features/agent-activity/blocks.ts')) return { url: SAID_SETTINGS, shortCircuit: true }
    return next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context)
  },
  load: (url, context, next) => {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }
    if (!url.endsWith('.tsx')) return next(url, context)
    const file = fileURLToPath(url)
    return { format: 'module', source: transformSync(file, readFileSync(file, 'utf8'), { jsx: { runtime: 'automatic' } }).code, shortCircuit: true }
  },
})
const { calls } = (await import(COUNTED_ROWS)) as { calls: { diffOf: number; unifiedRows: number; colors: number } }
const { stepsOf } = await import('../src/features/agent-activity/steps.ts')
const { StepItem } = await import('../src/features/agent-activity/StepView.tsx')
const { said } = (await import(SAID_SETTINGS)) as { said: { openByDefault: Record<string, boolean> } }

const edit = (id: string, oldText: string, newText: string): ActivityEntry => ({ id: `tool:${id}`, kind: 'tool', name: 'edit', state: 'completed', input: JSON.stringify({ path: 'src/a.ts', edits: [{ oldText, newText }] }) })
const [step] = stepsOf([edit('1', 'const a = 1\nconst b = 2', 'const a = 3\nconst b = 2\nconst c = 4'), edit('2', 'return x', 'return y')])

/** Draws the change as the agent's page does, arriving open or closed, and says what it asked of diffs and colors. */
function drawn(open: boolean) {
  said.openByDefault = { change: open, shell: false, looks: false, other: false }
  Object.assign(calls, { diffOf: 0, unifiedRows: 0, colors: 0 })
  const html = renderToStaticMarkup(createElement(StepItem, { step: step!, timeOf: () => undefined, ended: false }))
  return { html, ...calls }
}

test('a closed change is one row that says what changed, and builds no diff, no rows and no colors', () => {
  const closed = drawn(false)
  assert.match(closed.html, /Edited/)
  assert.match(closed.html, /\+4/)
  assert.match(closed.html, /−3/)
  assert.match(closed.html, /2 edits/)
  assert.doesNotMatch(closed.html, /aa-diff/)
  assert.deepEqual({ diffOf: closed.diffOf, unifiedRows: closed.unifiedRows, colors: closed.colors }, { diffOf: 0, unifiedRows: 0, colors: 0 })
})

test('an open change builds each place once and colors what it draws, with the same counts', () => {
  const open = drawn(true)
  assert.match(open.html, /aa-diff/)
  assert.match(open.html, /\+4/)
  assert.deepEqual({ diffOf: open.diffOf, unifiedRows: open.unifiedRows }, { diffOf: 2, unifiedRows: 2 })
  assert.ok(open.colors > 0)
})
