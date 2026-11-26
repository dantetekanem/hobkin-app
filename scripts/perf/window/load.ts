/**
 * Lets Node load the window's own modules as Vite serves them: `@/` points at ui/src, an import without an extension
 * finds its `.tsx` or `.ts`, TSX is turned into JavaScript by Vite's own transformer (with React's development JSX
 * unless NODE_ENV=production, as `pnpm tauri dev` serves it), and style sheets and pictures are nothing. `swap` puts a
 * module of the caller's in place of a window module wherever it is imported from, so a benchmark can time what that
 * module's functions do; the caller's module reaches the real one by its URL with `?real` after it.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const SOURCE = new URL('../../../ui/src/', import.meta.url).href
const VITE = realpathSync(fileURLToPath(new URL('../../../node_modules/vite/package.json', import.meta.url)))
const { transformSync } = (await import(createRequire(VITE).resolve('rolldown/experimental'))) as {
  transformSync: (file: string, source: string, options: object) => { code: string; errors?: unknown[] }
}

const ASSET = /\.(css|svg|png|jpe?g|gif|webp|woff2?|mp3|wav)(\?.*)?$/

/** `swap` maps a window module's URL (`ui/src/...`, as `new URL(..., import.meta.url).href` gives it) to the module that stands in for it. */
export function loadWindowModules({ swap = {} }: { swap?: Record<string, string> } = {}): void {
  const development = process.env.NODE_ENV !== 'production'
  registerHooks({
    resolve: (specifier, context, next) => {
      const wanted = specifier.startsWith('@/') ? SOURCE + specifier.slice(2) : specifier
      let resolved
      try {
        resolved = next(wanted, context)
      } catch (error) {
        if ((error as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND' || /\.[a-z]+$/.test(wanted)) throw error
        resolved = (() => {
          try {
            return next(`${wanted}.tsx`, context)
          } catch {
            return next(`${wanted}.ts`, context)
          }
        })()
      }
      const real = resolved.url.endsWith('?real')
      const stand = real ? undefined : swap[resolved.url]
      if (real) return { ...resolved, url: resolved.url.slice(0, -'?real'.length), shortCircuit: true }
      return stand && context.parentURL !== stand ? { url: stand, format: 'module', shortCircuit: true } : resolved
    },
    load: (url, context, next) => {
      if (ASSET.test(url)) return { format: 'module', source: 'export default ""', shortCircuit: true }
      const path = url.split('?')[0]!
      if (!path.endsWith('.tsx')) return next(url, context)
      const file = fileURLToPath(path)
      const { code } = transformSync(file, readFileSync(file, 'utf8'), { jsx: { runtime: 'automatic', development } })
      return { format: 'module', source: code, shortCircuit: true }
    },
  })
}
