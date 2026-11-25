import { useEffect, type RefObject } from 'react'
import { faceMovement } from './face-motion.ts'

/**
 * The faces' blinks (2026-11-23, the user: "Blinks can stay as a rare single blink"). A face blinks once every 6 to 10
 * seconds, each at its own moment, as one short play on its eyes' box. Every face in the window waits on one timer, set
 * for the next face due. No timer is set while the window is hidden or away (app/away.ts marks `<html data-away>`),
 * under Still or reduced motion, or for a face off screen. Hob.tsx and Crab.tsx watch only faces of 40 px or more,
 * moving, in a mood that blinks.
 */

/** How long a face waits between blinks, at random between these, in milliseconds. */
export const BLINK_EVERY_MS = { least: 6000, most: 10_000 } as const

/** Faces due this soon blink with the one due now, so the timer is not set again for a few milliseconds. */
const TOGETHER_MS = 50
/** A blink later than this, as when the window comes back, is skipped and the face waits again, so faces never blink in a crowd. */
const LATE_MS = 1000

/** The eyes' box of a mood that blinks, by its class, and how long its blink takes: the last 8% of the loop it had. */
const BLINK_MS: Readonly<Record<string, number>> = { 'hob-b-on': 320, 'hob-b-slow': 480, 'hob-cb-on': 424 }
const EYES = Object.keys(BLINK_MS)
  .map((name) => `.${name}`)
  .join(', ')

/** The blink of that loop: the eyes close in three eighths of it and open in the rest, eased as it was. */
const BLINK: Keyframe[] = [
  { transform: 'scaleY(1)', easing: 'ease' },
  { transform: 'scaleY(0.1)', offset: 0.375, easing: 'ease' },
  { transform: 'scaleY(1)' },
]

interface Face {
  dueAt: number
  onScreen: boolean
}

interface Blinks {
  faces: Map<Element, Face>
  timer: ReturnType<typeof setTimeout> | null
  /** When the timer is set for. */
  at: number
  screen: IntersectionObserver | null
}

// On globalThis, so a hot update that runs this file again keeps the one timer and the faces waiting on it instead of
// starting a second set. The page's listeners are added once, by the first copy.
const holder = globalThis as { __hobkinBlinks?: Blinks }
const first = holder.__hobkinBlinks === undefined
const blinks = (holder.__hobkinBlinks ??= { faces: new Map(), timer: null, at: Infinity, screen: null })

const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null

/** The window is hidden or away, or movement holds still: no face blinks. */
function quiet(): boolean {
  if (typeof document === 'undefined' || document.visibilityState === 'hidden') return true
  const root = document.documentElement
  if (root.hasAttribute('data-away')) return true
  return faceMovement(root.getAttribute('data-motion'), Boolean(reduce?.matches)) === 'still'
}

function waitBetweenBlinks(): number {
  const spread = BLINK_EVERY_MS.most - BLINK_EVERY_MS.least
  return Math.round(BLINK_EVERY_MS.least + Math.random() * spread)
}

/** When the next face on screen is due to blink, or never while the page is quiet or no face is on screen. */
function nextDue(): number {
  if (quiet()) return Infinity

  let next = Infinity
  for (const face of blinks.faces.values()) {
    if (face.onScreen) next = Math.min(next, face.dueAt)
  }
  return next
}

/** Sets the one timer for the next face due, or clears it when none is. */
function arm(): void {
  const next = nextDue()
  if (blinks.timer !== null && next === blinks.at) return

  if (blinks.timer !== null) clearTimeout(blinks.timer)
  blinks.timer = null
  blinks.at = next
  if (next === Infinity) return

  blinks.timer = setTimeout(fire, Math.max(0, next - Date.now()))
}

/** Blinks every face on screen that is due now, sets when each blinks next, and sets the timer again. */
function fire(): void {
  blinks.timer = null
  blinks.at = Infinity
  const now = Date.now()
  const awake = !quiet()

  for (const [element, face] of blinks.faces) {
    const due = face.onScreen && face.dueAt - now <= TOGETHER_MS
    if (!due) continue

    const onTime = now - face.dueAt <= LATE_MS
    if (awake && onTime) blink(element)
    face.dueAt = now + waitBetweenBlinks()
  }
  arm()
}

/** How long these eyes' blink takes, by the class that marks them. */
function blinkLength(eyes: Element): number | undefined {
  for (const [name, ms] of Object.entries(BLINK_MS)) {
    if (eyes.classList.contains(name)) return ms
  }
  return undefined
}

/** One blink of the face's eyes, unless something around it holds it still. */
function blink(face: Element): void {
  const eyes = face.querySelector<HTMLElement>(EYES)
  if (!eyes || eyes.closest('[data-still], [data-held]')) return

  eyes.animate?.(BLINK, { duration: blinkLength(eyes) })
}

/** One watcher for every face's place on screen, made with the first face. Null where the page has none. */
function screen(): IntersectionObserver | null {
  if (blinks.screen || typeof IntersectionObserver !== 'function') return blinks.screen
  blinks.screen = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      const face = blinks.faces.get(target)
      if (face) face.onScreen = isIntersecting
    }
    arm()
  })
  return blinks.screen
}

/** Lets the face drawn in `face` blink now and then, from now until the returned function is called. */
export function watchBlinks(face: Element): () => void {
  const observer = screen()
  blinks.faces.set(face, { dueAt: Date.now() + waitBetweenBlinks(), onScreen: observer === null })
  observer?.observe(face)
  arm()
  return () => {
    blinks.faces.delete(face)
    observer?.unobserve(face)
    arm()
  }
}

/** Lets the face drawn in `root` blink while `on`. */
export function useBlinks(root: RefObject<Element | null>, on: boolean): void {
  useEffect(() => {
    const face = root.current
    if (!on || !face) return
    return watchBlinks(face)
  }, [root, on])
}

if (first && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => arm())
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => arm()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-away', 'data-motion'] })
  }
  reduce?.addEventListener('change', () => arm())
}
