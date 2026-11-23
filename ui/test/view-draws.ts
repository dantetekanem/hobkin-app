import { readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const { transformSync } = (await import(createRequire(import.meta.resolve('vite')).resolve('rolldown/experimental'))) as {
  transformSync: (file: string, source: string, options: object) => { code: string }
}

/**
 * Lets a test import the app's views: `@/` points at ui/src, as Vite resolves it, TSX is read once Vite's own
 * transformer has turned it into JavaScript, and style sheets are nothing. Call it before importing the app.
 */
export function readViews(): void {
  registerHooks({
    resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context),
    load: (url, context, next) => {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }
      if (!url.endsWith('.tsx')) return next(url, context)
      const file = fileURLToPath(url)
      return { format: 'module', source: transformSync(file, readFileSync(file, 'utf8'), { jsx: { runtime: 'automatic' } }).code, shortCircuit: true }
    },
  })
}
