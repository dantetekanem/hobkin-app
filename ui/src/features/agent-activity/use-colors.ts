import { useEffect, useState, type RefObject } from 'react'
import { requestHighlight, type HighlightedText } from '@/features/review/code/use-highlighted.ts'
import { colorsFitting, colorsNow, keptColors } from './colors.ts'

/** The window's kept colors, for every agent's page. Colored off the page's thread, by the review's own worker. */
const COLORS = keptColors(requestHighlight)

const PLAIN: HighlightedText = { lines: [], styles: [], done: false }

/**
 * Code's colors for both themes (colors.ts): the ones kept for it on the first paint, or plain until they arrive. It
 * asks for them only while `near` is true. Null code has no colors.
 */
export function useColors(code: string | null, language: string | null, near: boolean): HighlightedText {
  const { now, asks } = colorsNow(COLORS, code, language, near)
  const [arrived, setArrived] = useState<{ code: string; language: string | null; colors: HighlightedText } | null>(null)
  useEffect(() => {
    if (!asks || code === null) return
    return COLORS.color(code, language, (colors) => setArrived({ code, language, colors }))
  }, [asks, code, language])
  if (now || code === null) return now ?? PLAIN
  // Colors that belong to other code are never shown on this code. Those of its first lines are, until its own arrive.
  return colorsFitting(arrived, code, language) ?? PLAIN
}

/** How far around the view a box counts as near it: one height of the view above it and one below. */
const NEAR = '100% 0px'

const scrolls = (element: Element) => ['auto', 'scroll', 'overlay'].includes(getComputedStyle(element).overflowY)

/**
 * True once the box has come in or near the view of the transcript that scrolls around it, and from then on. The step
 * that holds it is watched rather than the box, as a step far from view is not laid out (content-visibility).
 */
export function useNear(box: RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const element = box.current
    if (near || !element) return
    const watched = element.closest('[data-step]') ?? element
    let root = watched.parentElement
    while (root && !scrolls(root)) root = root.parentElement
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true)
    }, { root, rootMargin: NEAR })
    watcher.observe(watched)
    return () => watcher.disconnect()
  }, [box, near])
  return near
}
