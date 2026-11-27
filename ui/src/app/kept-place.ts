import { useLayoutEffect, useRef, type RefObject } from 'react'
import { PAGE_SCROLLER } from './screen-layout.ts'
import type { ScreenId } from './screens.ts'
import type { Keep } from './trail.ts'

/**
 * What a page keeps of itself on the trail (053): read as the user leaves it, and given back when a way back along the
 * trail returns to it. A part the page needs before it draws, as Work's tab, is given back at once (`give`). The page
 * takes the rest, the row in focus and how far it was scrolled, as it arrives (`useKeptPlace`).
 */

/** One part of what a page keeps: how it is read, and how it is given back before the page draws again. */
export interface KeptPart {
  read: () => Keep
  give?: (keep: Keep) => void
}

// The parts live on globalThis, as the numbers' store does (`use-work-metrics.ts`): a hot update that runs this file
// again finds the parts the pages added instead of forgetting them. Vite 8 has no `decline`.
const holder = globalThis as { __hobkinKeptParts?: Map<ScreenId, Map<string, KeptPart>> }
const parts = (holder.__hobkinKeptParts ??= new Map())
let arrival: { screen: ScreenId; keep: Keep } | null = null

/** Adds a part of what `screen` keeps, by its name. The function it returns takes it away again. */
export function keepPart(screen: ScreenId, name: string, part: KeptPart): () => void {
  const named = parts.get(screen) ?? new Map<string, KeptPart>()
  parts.set(screen, named)
  named.set(name, part)
  return () => {
    if (named.get(name) === part) named.delete(name)
  }
}

/** What `screen` keeps of itself right now, or undefined when it keeps nothing. A part that fails to read keeps nothing. */
export function readKeep(screen: ScreenId): Keep | undefined {
  const keep: Keep = {}
  for (const part of parts.get(screen)?.values() ?? []) {
    try {
      Object.assign(keep, part.read())
    } catch (error) {
      console.error('[trail]', error)
    }
  }
  return Object.keys(keep).length ? keep : undefined
}

/** The view moved to `screen`. A way back with what the page kept gives it back; any other move forgets the last one. */
export function arrive(screen: ScreenId, keep?: Keep): void {
  arrival = keep ? { screen, keep } : null
  if (!keep) return
  for (const part of parts.get(screen)?.values() ?? []) part.give?.(keep)
}

/** What the page arriving now was given back, once. */
export function takeArrival(screen: ScreenId): Keep | null {
  if (arrival?.screen !== screen) return null
  const { keep } = arrival
  arrival = null
  return keep
}

/** The marks that name a row by what it is, looked for from the piece that had the keyboard up to its row. */
const ROW_KEYS = ['data-review-id', 'data-change', 'data-queue-row', 'data-merging', 'data-world-project', 'data-agent-node', 'data-opens', 'id'] as const

const quoted = (value: string) => value.replace(/["\\]/g, '\\$&')

/** A selector for the row `element` is in, by the mark that names it, or undefined for a piece of no named row. */
export function rowKeyOf(element: Element | null, root: Element): string | undefined {
  for (let at = element; at && at !== root; at = at.parentElement) {
    for (const name of ROW_KEYS) {
      const value = at.getAttribute(name)
      if (value) return `[${name}="${quoted(value)}"]`
    }
  }
  return undefined
}

/**
 * What a page with a scroller keeps: the row last pressed or focused in it (a click on a row gives it no keyboard on a
 * Mac), or else the one with the keyboard, and how far it was scrolled.
 */
export function pageKeep(root: Element & { scrollTop: number }, last: Element | null): Keep {
  const held = document.activeElement
  const heldInside = held && held !== root && root.contains(held) ? held : null
  const from = last && root.contains(last) ? last : heldInside
  const focus = rowKeyOf(from, root)
  const scroll = Math.round(root.scrollTop)
  return { ...(focus ? { focus } : {}), ...(scroll > 0 ? { scroll } : {}) }
}

/** How long a page waits for what it kept to be drawn again, as AI Reviews' list that is asked anew: about a second. */
const MOST_FRAMES = 60
/** What the user does that makes the kept place theirs to leave. */
const INTENT = ['pointerdown', 'keydown', 'wheel'] as const

/**
 * Puts a page back as it was kept: the scroll once the page is tall enough for it, and the keyboard on the row once
 * the row is drawn. The row takes the keyboard as the page arrives, ahead of the page's first stop, or later while the
 * keyboard is still where the arrival put it. A handoff that goes first (an item opened on the page from elsewhere),
 * anything the user does, or a second without the row ends it. The function it returns ends it too.
 */
export function restorePage(root: HTMLElement, keep: Keep): () => void {
  const section = root.closest<HTMLElement>('[data-canvas-screen]')
  let scroll = keep.scroll !== undefined && keep.scroll > 0 ? keep.scroll : undefined
  let focus = keep.focus
  let arrived = document.activeElement === section
  let frames = MOST_FRAMES
  let frame: number | undefined
  let over = false

  const row = () => (focus ? root.querySelector<HTMLElement>(focus) : null)
  /** The keyboard is where the arrival left it: on nothing, the page's section or its first stop. */
  const unchosen = () => {
    const held = document.activeElement
    return held == null || held === document.body || held === section || held === root.querySelector('[data-stop]')
  }
  const scrollWhenTall = () => {
    if (scroll === undefined || root.scrollHeight - root.clientHeight < scroll) return
    root.scrollTop = scroll
    scroll = undefined
  }
  const end = () => {
    if (over) return
    over = true
    if (frame !== undefined) cancelAnimationFrame(frame)
    section?.removeEventListener('focus', onArrive)
    INTENT.forEach((name) => document.removeEventListener(name, end, true))
  }
  const onArrive = (event: Event) => {
    if (over || event.target !== section) return
    arrived = true
    const found = row()
    if (!found) return
    focus = undefined
    // The page's own first stop would take the keyboard next.
    event.stopImmediatePropagation()
    found.focus({ preventScroll: true })
  }
  const step = () => {
    frame = undefined
    if (over) return
    scrollWhenTall()
    const found = row()
    if (found && arrived) {
      if (unchosen()) found.focus({ preventScroll: true })
      focus = undefined
    }
    if ((scroll === undefined && focus === undefined) || --frames <= 0) end()
    else frame = requestAnimationFrame(step)
  }

  scrollWhenTall()
  if (scroll === undefined && focus === undefined) return () => {}
  section?.addEventListener('focus', onArrive)
  INTENT.forEach((name) => document.addEventListener(name, end, true))
  frame = requestAnimationFrame(step)
  return end
}

/**
 * A page's own part of its place, for a page with a scroller: it keeps the row last pressed or focused in it and how
 * far it was scrolled, and gets both back as it arrives along the trail. Call it after the page's other handoffs of the
 * keyboard, such as an item opened on it from another screen, so they go first.
 */
export function useKeptPlace(screen: ScreenId, content: RefObject<HTMLElement | null>): void {
  // Kept for the page's life, so a second run of the effect (StrictMode) still has what the arrival gave.
  const given = useRef<Keep | null | undefined>(undefined)
  useLayoutEffect(() => {
    const root = content.current?.querySelector<HTMLElement>(`.${PAGE_SCROLLER}`)
    if (!root) return
    let last: Element | null = null
    const touch = (event: Event) => {
      last = event.target as Element | null
    }
    root.addEventListener('pointerdown', touch, true)
    root.addEventListener('focusin', touch)
    const release = keepPart(screen, 'page', { read: () => pageKeep(root, last) })
    if (given.current === undefined) given.current = takeArrival(screen)
    const stop = given.current ? restorePage(root, given.current) : undefined
    return () => {
      release()
      stop?.()
      root.removeEventListener('pointerdown', touch, true)
      root.removeEventListener('focusin', touch)
    }
  }, [screen, content])
}
