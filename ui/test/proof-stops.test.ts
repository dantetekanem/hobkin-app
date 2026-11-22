import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SAMPLE_RUNS } from '../src/features/proofs/sample.ts'

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
const { MathView } = await import('../src/features/proofs/math/MathView.tsx')
const { GraphView } = await import('../src/features/proofs/graph/GraphView.tsx')

/** The controls Up and Down walk, in reading order: what `app/stops.ts` and a panel's walk find by `data-stop`. */
const stopsOf = (html: string) => [...html.matchAll(/<[^>]*\sdata-stop(?:="")?[\s>][^>]*>?/g)].map((match) => match[0])

test('Up and Down reach each math block and each proof step the tree shows, in reading order', () => {
  const run = SAMPLE_RUNS.proofFails
  const stops = stopsOf(renderToStaticMarkup(createElement(MathView, { run })))
  const blocks = stops.filter((stop) => stop.includes('data-block='))
  const steps = stops.filter((stop) => stop.includes('data-proof-step='))
  assert.equal(blocks.length, run.definitions.length, 'every block of the spec')
  assert.equal(steps.length, 12, 'every step of the folded tree')
  assert.deepEqual(steps.map((stop) => Number(/data-proof-step="(\d+)"/.exec(stop)![1])), [0, 1, 2, 3, 5, 8, 11, 12, 13, 14, 15, 16])
})

test('Up and Down reach the state graph, where Left and Right then step through the counterexample', () => {
  const stops = stopsOf(renderToStaticMarkup(createElement(GraphView, { run: SAMPLE_RUNS.broken })))
  const canvas = stops.find((stop) => stop.includes('data-proof-part="graph"'))
  assert.ok(canvas, 'the graph is a stop')
  assert.match(canvas, /Left and Right step through the counterexample/)
})
