import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The app's `@/` imports point at ui/src, as Vite resolves them. Components are TSX, which Node reads once Vite's own
// transformer has turned it into JavaScript. Style sheets are nothing here, and the theme is light: the window's theme
// module reads the page as it loads.
const { transformSync } = (await import(createRequire(import.meta.resolve('vite')).resolve('rolldown/experimental'))) as {
  transformSync: (file: string, source: string, options: object) => { code: string }
}
const THEME = 'data:text/javascript,export const useTheme = () => "light"'
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === '@/app/theme.ts') return { url: THEME, shortCircuit: true }
    return next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context)
  },
  load: (url, context, next) => {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }
    if (!url.endsWith('.tsx')) return next(url, context)
    const file = fileURLToPath(url)
    return { format: 'module', source: transformSync(file, readFileSync(file, 'utf8'), { jsx: { runtime: 'automatic' } }).code, shortCircuit: true }
  },
})
const { ProofPanel } = await import('../src/features/proofs/ProofPanel.tsx')

const ignore = () => {}
const SIBLINGS = ['sample-holds', 'sample-proofFails', 'sample-proved']
const panel = (more: Record<string, unknown>) => renderToStaticMarkup(createElement(ProofPanel, { run: 'sample-proofFails', siblings: SIBLINGS, onClose: ignore, onExpand: ignore, ...more }))

test('a closed panel mounts nothing', () => {
  assert.equal(panel({ open: false }), '')
})

test("an open panel's heading names the model, how it stands and which of how many, with its expand and close buttons", () => {
  const html = panel({ layout: 'tabs' })
  assert.match(html, /data-proof-panel/)
  assert.match(html, />WorkItem</)
  assert.match(html, /Found a counterexample/)
  assert.match(html, /Model 2 of 3/)
  assert.match(html, /Breaks at step 6 · 1 of 17 steps fails/)
  assert.match(html, /aria-label="Open the full page"/)
  assert.match(html, /aria-label="Close the proof"/)
})

test('a panel narrower than 1,100 pixels shows tabs, and a wider one shows what the run found over the check and the proof', () => {
  const tabs = panel({ layout: 'tabs' })
  assert.match(tabs, /role="tablist"/)
  assert.match(tabs, /id="proof-panel-tab-run"/)

  const side = panel({ layout: 'side' })
  assert.doesNotMatch(side, /role="tablist"/)
  assert.match(side, /aria-label="Result"/)
  assert.match(side, /data-proof-zone="graph"/)
  assert.match(side, /aria-label="The proof"/)
})
