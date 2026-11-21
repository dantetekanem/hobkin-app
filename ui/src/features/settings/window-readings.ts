import { useEffect, useState } from 'react'

/**
 * Readings of the window itself for Nerd stats, each taken only while the panel is open. Pure where it can be, so the
 * rules are tested without a window.
 */

type AddedNode = { nodeName: string; rel?: string }

const LOADS_STYLE_SHEET = /(^|\s)stylesheet(\s|$)/i

/** A style element (an SVG's names itself in lower case), or a link that loads a style sheet. */
function isStyleSheet({ nodeName, rel }: AddedNode): boolean {
  const name = nodeName.toUpperCase()
  if (name === 'STYLE') return true
  return name === 'LINK' && LOADS_STYLE_SHEET.test(rel ?? '')
}

/** How many of the added nodes are style sheets. */
export function addedStyleSheets(records: Iterable<{ addedNodes: ArrayLike<AddedNode> }>): number {
  let count = 0
  for (const { addedNodes } of records) {
    for (let index = 0; index < addedNodes.length; index++) {
      if (isStyleSheet(addedNodes[index]!)) count += 1
    }
  }
  return count
}

/**
 * Counts the style sheets added to the head and the body from now on, and tells each new count. A sheet added to the
 * page makes WebKit restyle all of it, so this count holding still while agents work is the check of spec 052, A8.
 * Returns the stop.
 */
export function watchStyleSheets(
  page: Pick<Document, 'head' | 'body'>,
  onCount: (count: number) => void,
  Observer: typeof MutationObserver = MutationObserver,
): () => void {
  let count = 0
  const observer = new Observer((records) => {
    const more = addedStyleSheets(records)
    if (!more) return

    count += more
    onCount(count)
  })

  for (const target of [page.head, page.body]) observer.observe(target, { childList: true, subtree: true })
  return () => observer.disconnect()
}

/** The style sheets added to the page since the component mounted. */
export function useStyleSheetsAdded(): number {
  const [count, setCount] = useState(0)
  useEffect(() => watchStyleSheets(document, setCount), [])
  return count
}

/**
 * The graphics card the window draws with, as the browser names it. The drawing context is let go at once: one kept
 * holds a graphics thread awake in the GPU process for the life of the page.
 */
export function graphicsCard(makeCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): string {
  try {
    const gl = makeCanvas().getContext('webgl')
    if (!gl) return '—'
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '—'
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return name
  } catch {
    return '—'
  }
}
