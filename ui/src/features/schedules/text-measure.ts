import { useLayoutEffect, useMemo, useState, type RefObject } from 'react'

/** About how wide a character of 12px text is, where no canvas can measure it (a still render, before the first paint). */
const CHARACTER = 6.6

// One canvas for all the measuring. It keeps nothing between calls but the font each one sets.
const measuring = globalThis as { __hobkinScheduleCanvas?: CanvasRenderingContext2D | null }

/** Measures text in `font`, or estimates it with no font or no canvas. */
export function measurerFor(font: string | null): (text: string) => number {
  const context = font && typeof document !== 'undefined' ? (measuring.__hobkinScheduleCanvas ??= document.createElement('canvas').getContext('2d')) : null
  if (!font || !context) return (text: string) => text.length * CHARACTER
  return (text: string) => {
    context.font = font
    return context.measureText(text).width
  }
}

/**
 * Measures text in the font family `element` draws in, at `weight` and `size` (its own size when none is given), read
 * once the element is drawn. Before that, an estimate.
 */
export function useTextMeasure(element: RefObject<HTMLElement | null>, weight: number, size?: string): (text: string) => number {
  const [font, setFont] = useState<string | null>(null)
  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const style = getComputedStyle(node)
    setFont(`${weight} ${size ?? style.fontSize} ${style.fontFamily}`)
  }, [element, weight, size])
  return useMemo(() => measurerFor(font), [font])
}
