import type { Backdrop, BackdropShell } from '@/lib/native.ts'

/**
 * What the Mac window shows behind the page follows the page's own background (_specs/052-ten-times-lighter, A20).
 * While that background is solid (opacity 1, the default, and every photo theme) the window is opaque in the same
 * color with nothing blurred behind it, so WindowServer stops blending and blurring it and the windows behind it count
 * as covered. Below 1 it is transparent with the desktop blurred behind, as the window opens.
 */

const NUMBER = String.raw`(-?[\d.]+(?:e[+-]?\d+)?)`
const ALPHA = String.raw`(?:\s*[,/]\s*([\d.]+%?))?`
const RGB = new RegExp(String.raw`^rgba?\(\s*${NUMBER}[\s,]+${NUMBER}[\s,]+${NUMBER}${ALPHA}\s*\)$`, 'i')
const SRGB = new RegExp(String.raw`^color\(srgb\s+${NUMBER}\s+${NUMBER}\s+${NUMBER}${ALPHA}\s*\)$`, 'i')

/** A channel written out of `full` (255 in `rgb()`, 1 in `color(srgb ...)`), as a whole number from 0 to 255. */
function channelOf(text: string | undefined, full: number): number {
  const value = (Number(text) / full) * 255
  return Math.round(Math.min(255, Math.max(0, value)))
}

/** An alpha as a number or a percentage, from 0 to 1 in hundredths. None written means solid. */
function alphaOf(text: string | undefined): number {
  if (text === undefined) return 1
  const value = text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text)
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
}

function backdropFrom(match: RegExpExecArray, full: number): Backdrop {
  return {
    opacity: alphaOf(match[4]),
    color: [channelOf(match[1], full), channelOf(match[2], full), channelOf(match[3], full)],
  }
}

/**
 * The page's background as the browser computes it, `rgb()`, `rgba()` or `color(srgb ...)`, read as how much of it
 * shows and its color. Null for any other form, and then the shell is told nothing.
 */
export function backdropOf(css: string): Backdrop | null {
  const text = css.trim()
  const rgb = RGB.exec(text)
  if (rgb) return backdropFrom(rgb, 255)
  const srgb = SRGB.exec(text)
  if (srgb) return backdropFrom(srgb, 1)
  return null
}

/** Where the page's background is read, and what tells when it may have changed. */
export interface BackdropPage {
  read(): string
  watch(changed: () => void): () => void
}

/** The window's own page: its root's background, which changes with the theme, the opacity and a photo theme. */
const PAGE: BackdropPage = {
  read: () => getComputedStyle(document.documentElement).backgroundColor,
  watch(changed) {
    const observer = new MutationObserver(changed)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-photo', 'data-theme-fade', 'data-theme-reveal'] })
    return () => observer.disconnect()
  },
}

/** Tells the backdrop now, and again each time the page's background changes. Returns what stops it. */
export function followBackdrop(page: BackdropPage, tell: (backdrop: Backdrop) => void): () => void {
  let told: string | null = null
  const check = () => {
    const css = page.read()
    if (css === told) return
    const backdrop = backdropOf(css)
    if (!backdrop) return
    told = css
    tell(backdrop)
  }
  check()
  return page.watch(check)
}

/** Follows the page's background once the shell says it has the command. A shell from before it is never asked. */
export function startWindowBackdrop(shell: () => Promise<{ backdrop: BackdropShell | null }>, page: BackdropPage = PAGE): () => void {
  let stop: (() => void) | null = null
  let stopped = false
  void shell().then(({ backdrop }) => {
    if (!backdrop || stopped) return
    // A refusal leaves the window as it is, which is how it opened.
    stop = followBackdrop(page, (next) => void backdrop.set(next).catch(() => {}))
  })
  return () => {
    stopped = true
    stop?.()
  }
}
