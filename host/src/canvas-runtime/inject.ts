import { readFileSync } from 'node:fs'

/**
 * The kit's stylesheet and the canvas runtime's script, which the host puts into every drawing it serves
 * (_specs/040-canvas-board). Both are plain files beside this module, named with literal `new URL` paths so the
 * package stage finds and stages them.
 */
export interface CanvasRuntime {
  /** `kit.css`: the kit's classes, and the app's light and dark colors as variables. */
  css: string
  /** `runtime.js`: a classic script that runs inside the sandboxed drawing and speaks with the window. */
  js: string
}

/** Reads both files now. Throws when either cannot be read. */
export function readCanvasRuntime(): CanvasRuntime {
  return {
    css: readFileSync(new URL('./kit.css', import.meta.url), 'utf8'),
    js: readFileSync(new URL('./runtime.js', import.meta.url), 'utf8'),
  }
}

let kept: CanvasRuntime | null = null

/** Both files, read the first time a drawing is served and kept after that. A read that fails is tried again next time. */
export function canvasRuntime(): CanvasRuntime {
  kept ??= readCanvasRuntime()
  return kept
}

const BYTE_ORDER_MARK = '\xEF\xBB\xBF'
// White space and comments may come before a doctype. A comment ends at its first `-->`, so nothing here backtracks far.
const DOCTYPE = /^(?:[\t\n\f\r ]|<!--(?:(?!-->)[\s\S])*-->)*<!doctype[^>]*>/i

/**
 * The drawing with the kit and the runtime put in right after its doctype, matched in any case after a byte order
 * mark, white space or comments, or first when it has none (after a byte order mark, which is not content). Both are
 * marked `data-hb-runtime`, so the runtime can tell them from the drawing. The drawing's own bytes stay as they are:
 * it is read as Latin-1, one character for each byte, so an index in the text is an index in the bytes.
 */
export function withRuntime(drawing: Buffer, runtime: CanvasRuntime): Buffer {
  const text = drawing.toString('latin1')
  const mark = text.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK.length : 0
  const at = mark + (DOCTYPE.exec(text.slice(mark))?.[0].length ?? 0)
  const parts = Buffer.from(`<style data-hb-runtime>${runtime.css}</style><script data-hb-runtime>${runtime.js}</script>`, 'utf8')
  return Buffer.concat([drawing.subarray(0, at), parts, drawing.subarray(at)])
}
