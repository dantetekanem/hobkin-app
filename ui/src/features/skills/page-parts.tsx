import type { Variants } from 'motion/react'
import { useEffect, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { isArrowKey, walk, type Box } from '@/features/integrations/walk.ts'
import { stagger, staggerDelay } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'

/**
 * What the Skills and Pi extensions pages share with Integrations, whose layout and keys they follow
 * (039-skills-and-extensions): the headings, a part's header, the notices, and the arrows that walk the controls by
 * where they sit (019-keyboard).
 */

/** The page's own pieces land one after another, once the page has arrived. */
export const pieces: Variants = {
  enter: {},
  center: { transition: { staggerChildren: stagger, delayChildren: staggerDelay } },
}

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The controls the keyboard can reach in a layer (the list, or the open detail), as they are now. */
export function stopsIn(layer: HTMLElement): HTMLElement[] {
  return [...layer.querySelectorAll<HTMLElement>('[data-key-stop]')].filter((stop) => !stop.matches(':disabled') && stop.getClientRects().length > 0)
}

function boxOf(element: HTMLElement): Box {
  const { left, top, width, height } = element.getBoundingClientRect()
  return { left, top, width, height }
}

/** An arrow moves the keyboard to the control that sits that way. Left and Right in a text field move its caret instead. */
export function walkWithArrows(event: KeyboardEvent<HTMLElement>, layer: HTMLElement | null | undefined, still: boolean): void {
  const modified = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
  if (event.defaultPrevented || modified || !layer || !isArrowKey(event.key)) return
  const movesCaret = event.target instanceof HTMLInputElement && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
  if (movesCaret) return

  event.preventDefault()
  const stops = stopsIn(layer)
  const next = stops[walk(stops.map(boxOf), stops.indexOf(document.activeElement as HTMLElement), event.key)]
  if (!next || next === document.activeElement) return
  next.focus({ preventScroll: true })
  next.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
}

/**
 * When the frame hands the keyboard to the page, it lands on the first control. The page may still be reading when
 * the keyboard arrives: then it lands as the controls are drawn.
 */
export function useLanding(root: RefObject<HTMLDivElement | null>, scroller: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const screen = root.current?.closest<HTMLElement>('[data-canvas-screen]')
    if (!screen) return
    const land = () => {
      const first = scroller.current ? stopsIn(scroller.current)[0] : undefined
      first?.focus({ preventScroll: true })
    }
    if (document.activeElement === screen) land()
    const onFocus = (event: FocusEvent) => {
      if (event.target === screen) land()
    }
    screen.addEventListener('focus', onFocus)
    return () => screen.removeEventListener('focus', onFocus)
  }, [root, scroller])
}

/** The page's heading, as each kind of integration has one. */
export function PageHeading({ title, line }: { title: string; line: ReactNode }) {
  return (
    <header>
      <h2 className="font-heading text-[26px] leading-tight font-semibold tracking-[-0.025em]">{title}</h2>
      <p className="mt-1 max-w-[72ch] text-[13px] text-muted-foreground">{line}</p>
    </header>
  )
}

/** One part of a page: a label, a line that sums it up, and what it holds. */
export function Part({ label, title, line, aside, children }: { label: string; title: string; line: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-4 @max-[640px]:flex-col @max-[640px]:items-start">
        <div className="min-w-0">
          <h3 className="eyebrow">{label}</h3>
          <p className="mt-1 font-heading text-[20px] leading-tight font-semibold tracking-[-0.022em]">{title}</p>
          <p className="mt-1 text-[13px] break-words text-muted-foreground">{line}</p>
        </div>
        {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
      </header>
      {children}
    </section>
  )
}

/** What did not go as asked, and what Pi could not read, each in its own words. */
export function Notices({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((text) => (
        <li key={text} className="rounded-2xl bg-warn/15 px-4 py-2.5 text-[13px] break-words text-warn-fg">
          {text}
        </li>
      ))}
    </ul>
  )
}

/** Says a part has nothing, in the place its tiles would be. */
export function Empty({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('col-span-full rounded-[22px] border border-dashed border-border-strong/40 px-4 py-5 text-[13px] text-muted-foreground', className)}>{children}</p>
}

/** "2026-11-13T22:40:00Z" as "10:40 PM", for a line that says when something was read. */
export const timeOf = (at: string) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** Ends a sentence once, even when it ends on a time some languages write as "10:40 p.m.". */
export const sentence = (text: string) => (text.endsWith('.') ? text : `${text}.`)
