import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { cn } from '@/lib/utils.ts'
import { cutParts, fitPath, type Measure } from './file-path.ts'

/**
 * How much wider than its box a fitted path may measure. The canvas and the page draw the same font a hair apart, and
 * a path that fits must not lose a folder to that. At most this much of the last letter's empty side is clipped.
 */
const SLACK = 0.5

/** One path on the page whose box is watched. */
interface Watch {
  path: string
  /** Its box's last measured width. 0 before the first. */
  width: number
  /** What it shows, once fitted. */
  shown: string | null
  show: (shown: string) => void
}

/**
 * Every path on the page shares one ResizeObserver. It lives on globalThis, so a hot update that runs this file
 * again keeps it and the paths it watches. It calls whatever the newest copy of this file put in `onSizes`.
 */
interface Widths {
  observer: ResizeObserver | null
  watched: Map<Element, Watch>
  onSizes: (entries: readonly ResizeObserverEntry[]) => void
  onFonts: () => void
  fontsHeard: boolean
}

const holder = globalThis as { __hobkinPathWidths?: Widths }
const widths = (holder.__hobkinPathWidths ??= { observer: null, watched: new Map(), onSizes: () => {}, onFonts: () => {}, fontsHeard: false })

let canvas: CanvasRenderingContext2D | null | undefined

/** How text draws in `element`: its font on a canvas, and its tracking after each letter. Null with no canvas. */
function measureIn(element: Element): Measure | null {
  canvas ??= document.createElement('canvas').getContext('2d')
  if (!canvas) return null
  const context = canvas
  const style = getComputedStyle(element)
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const tracking = Number.parseFloat(style.letterSpacing) || 0
  return (text) => context.measureText(text).width + tracking * [...text].length
}

/** What a watched path shows at its width now, as a change to make, or null when it shows that already. */
function fitted(element: Element, watch: Watch): (() => void) | null {
  const measure = watch.width > 0 ? measureIn(element) : null
  const shown = measure ? fitPath(watch.path, watch.width + SLACK, measure) : watch.path
  if (shown === watch.shown) return null
  watch.shown = shown
  return () => watch.show(shown)
}

/**
 * Fits the paths given, measuring all of them before any changes, and draws the changes at once, before the window
 * paints, so a path never shows a frame of the wrong cut.
 */
function refit(paths: Iterable<readonly [Element, Watch]>): void {
  const changes = [...paths].flatMap(([element, watch]) => fitted(element, watch) ?? [])
  if (changes.length) flushSync(() => changes.forEach((change) => change()))
}

widths.onSizes = (entries) =>
  refit(
    entries.flatMap((entry) => {
      const watch = widths.watched.get(entry.target)
      if (!watch) return []
      watch.width = entry.contentRect.width
      return [[entry.target, watch] as const]
    }),
  )
// A font that arrives late draws the text at a new width inside the same box.
widths.onFonts = () => refit(widths.watched)

/** Watches `element`'s width and calls `show` with `path` fitted to it, until the returned function is called. */
function watchWidth(element: Element, path: string, show: (shown: string) => void): () => void {
  if (!widths.fontsHeard && document.fonts) {
    widths.fontsHeard = true
    document.fonts.addEventListener('loadingdone', () => widths.onFonts())
  }
  widths.observer ??= new ResizeObserver((entries) => widths.onSizes(entries))
  widths.watched.set(element, { path, width: 0, shown: null, show })
  widths.observer.observe(element)
  return () => {
    widths.watched.delete(element)
    widths.observer?.unobserve(element)
  }
}

/**
 * A file path in a row, cut from its front to the room the row leaves it (file-path.ts): `…/models/change.rb`. It
 * follows its box as the window or the split is resized. It takes the row's leftover room and no more, so what stands
 * before and after it keeps its place: the box is as wide as the whole path would be, kept so by the whole path drawn
 * unseen beneath what shows. The whole path is its title, and the front it leaves out is in the row unseen, so a
 * copy of the row takes the whole path. Until it is measured it shows whole, cut at its end.
 */
export function FilePath({ path, className }: { path: string; className?: string }) {
  const box = useRef<HTMLElement>(null)
  const [fit, setFit] = useState<{ path: string; shown: string } | null>(null)
  useLayoutEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    return watchWidth(element, path, (shown) => setFit({ path, shown }))
  }, [path])

  const shown = fit?.path === path ? fit.shown : null
  const parts = shown === null ? null : cutParts(path, shown)
  if (!parts?.hidden) {
    return (
      <code ref={box} title={path} className={cn('min-w-0 overflow-hidden whitespace-nowrap', shown === null && 'text-ellipsis', className)}>
        {path}
      </code>
    )
  }
  return (
    <code ref={box} title={path} className={cn('grid min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden whitespace-nowrap', className)}>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1">
        {path}
      </span>
      {/* The mark is drawn by the style sheet, so a copy does not take it. */}
      <span className={cn('col-start-1 row-start-1', parts.mark && "before:content-['…']")}>
        <span className="sr-only">{parts.hidden}</span>
        {parts.kept}
      </span>
    </code>
  )
}
