import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, ChevronDown, ChevronRight, Circle, ListTree, Search, X } from 'lucide-react'
import { animate, motion, useMotionValueEvent, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Kbd } from '@/components/ui/kbd.tsx'
import { OpenArrow } from '@/components/ui/open-arrow.tsx'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useReduced, useRig, useSession, useSessionStore } from '../state/context.tsx'
import { drawnAs } from '../state/session.ts'
import { filterOutline, outlineItems, outlineOf, type OutlineItem, type OutlineRow, type OutlineSection } from './outline.ts'

/** How wide the outline is, and the room it takes beside the steps panel with its margins. */
export const OUTLINE = { width: 272, gap: 10 } as const
export const OUTLINE_ROOM = OUTLINE.width + OUTLINE.gap * 2
/** The height of each line of the list: rows are drawn only while they are in view, at these heights. */
const LINE = { heading: 34, group: 32, row: 30 } as const

const count = (value: number) => value.toLocaleString('en-US')

/**
 * The outline (spec 053), opened and closed with L: a list at the left, beside the steps panel, of every unit and file of
 * the review under Needs you, Worth a look and Safe, in rank order, the safe ones in the groups the graph folds them
 * into, each row with its lines and whether it is seen. Typing filters it, the arrows choose, and Enter moves the graph
 * to the row, opening its group when the graph folded it. Its rows are drawn only while they are in view, as the code is.
 * The room it takes counts as covered, so the camera never frames anything under it.
 *
 * Purpose of the motion: spatial consistency. It slides out from under the steps panel on the spring the panel moves on,
 * and goes back the same way.
 */
export function Outline({ panelHeight }: { panelHeight: number }) {
  const store = useSessionStore()
  const rig = useRig()
  const reduced = useReduced()
  const open = useSession((session) => session.outline)
  const [onScreen, setOnScreen] = useState(open)

  // A review that opens with the outline open has it in place at once: only L slides it.
  const mounted = useRef(false)
  useEffect(() => {
    const room = open ? OUTLINE_ROOM : 0
    const first = !mounted.current
    mounted.current = true
    if (reduced || first) {
      rig.outline.jump(room)
      return
    }
    const playing = animate(rig.outline, room, spring.screen)
    return () => playing.stop()
  }, [open, reduced, rig])
  useMotionValueEvent(rig.outline, 'change', (value) => {
    const visible = value > 0.5
    if (visible !== onScreen) setOnScreen(visible)
  })
  const place = useTransform(() => `translateX(${rig.side.get() + rig.outline.get() - OUTLINE_ROOM + OUTLINE.gap}px)`)

  return (
    <motion.aside
      aria-label="Outline"
      aria-hidden={!open}
      inert={!open}
      data-rv-outline
      className="rv-float rv-outline absolute top-3 left-0 z-[14] flex flex-col overflow-hidden rounded-[18px]"
      style={{ width: OUTLINE.width, bottom: OUTLINE.gap + panelHeight, transform: place, visibility: open || onScreen ? 'visible' : 'hidden' }}
    >
      {open || onScreen ? <OutlineBody onClose={() => store.getState().toggleOutline()} /> : null}
    </motion.aside>
  )
}

function OutlineBody({ onClose }: { onClose: () => void }) {
  const store = useSessionStore()
  const review = useSession((session) => session.review)
  const view = useSession((session) => session.view)
  const seen = useSession((session) => session.seen)
  const focus = useSession((session) => session.focus)
  const opened = useSession((session) => session.outline)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [active, setActive] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const sections = useMemo(() => outlineOf(review, view), [review, view])
  const shown = useMemo(() => filterOutline(sections, query), [query, sections])
  const items = useMemo(() => outlineItems(shown, expanded, query.trim() !== ''), [expanded, query, shown])
  const choosable = useMemo(() => items.flatMap((item, index) => (item.kind === 'heading' ? [] : [index])), [items])
  const chosen = choosable[Math.min(active, choosable.length - 1)]
  const current = useMemo(() => new Set(focus), [focus])

  // Before it is measured, the list is taken to be a screen tall, so its first rows are there on the first paint.
  const virtual = useVirtualizer({ count: items.length, getScrollElement: () => scroller.current, estimateSize: (index) => LINE[items[index]!.kind], overscan: 8, initialRect: { width: OUTLINE.width, height: 720 } })
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    if (chosen != null) virtual.scrollToIndex(chosen, { align: 'auto' })
  }, [chosen, virtual])
  // Opened with L, the keyboard goes to the filter, so typing filters at once.
  const wasOpen = useRef(opened)
  useLayoutEffect(() => {
    if (opened && !wasOpen.current) field.current?.focus({ preventScroll: true })
    wasOpen.current = opened
  }, [opened])

  const back = () => field.current?.closest<HTMLElement>('[data-rv-root]')?.focus({ preventScroll: true })
  const toggle = (id: string) =>
    setExpanded((before) => {
      const next = new Set(before)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const choose = (item: OutlineItem | undefined) => {
    if (!item || item.kind === 'heading') return
    if (item.kind === 'group') return toggle(item.group.id)
    store.getState().reach(item.row.id)
  }

  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-2 pr-1.5 pl-4">
        <ListTree className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate font-heading text-[14px] font-semibold">Outline</h2>
        <Kbd>L</Kbd>
        <button type="button" aria-label="Close the outline" onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-[background-color,color] duration-[160ms] hover:bg-secondary hover:text-foreground [&_svg]:size-4">
          <X />
        </button>
      </header>
      <label className="mx-2.5 mb-2 flex h-9 shrink-0 items-center gap-2 rounded-xl bg-secondary px-3">
        <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={field}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name or path"
          aria-label="Filter the outline by name or path"
          spellCheck={false}
          autoComplete="off"
          onKeyDown={(event) => {
            // The words belong to the field: no key typed here walks the story.
            event.stopPropagation()
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((at) => Math.max(0, Math.min(choosable.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1))))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              choose(chosen == null ? undefined : items[chosen])
            } else if (event.key === 'Escape') {
              // The keyboard goes back to the review, and the outline stays open with its words.
              event.preventDefault()
              back()
            }
          }}
          className="min-w-0 flex-1 bg-transparent font-sans text-[13.5px] outline-none placeholder:text-muted-foreground"
        />
      </label>
      <div ref={scroller} className="rv-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" role="list" aria-label="Every unit and file">
        {items.length === 0 ? <p className="px-3 py-3 text-[13px] text-muted-foreground">Nothing matches.</p> : null}
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((line) => {
            const item = items[line.index]!
            return (
              <div key={line.key} role="listitem" className="absolute inset-x-0 top-0" style={{ height: line.size, transform: `translateY(${line.start}px)` }}>
                {item.kind === 'heading' ? (
                  <Heading section={item.section} seen={seen} />
                ) : item.kind === 'group' ? (
                  <GroupLine name={item.group.label} rows={item.group.rows} open={item.open} seen={seen} active={line.index === chosen} onChoose={() => toggle(item.group.id)} />
                ) : (
                  <RowLine row={item.row} nested={item.group != null} seen={seen.has(item.row.id)} current={current.has(drawnAs(view, item.row.id))} active={line.index === chosen} onChoose={() => store.getState().reach(item.row.id)} />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

/** A heading with how much under it is seen: "Needs you · 2 of 7 seen", "Safe · 186 in 5 groups". */
function Heading({ section, seen }: { section: OutlineSection; seen: ReadonlySet<string> }) {
  const rows = [...section.rows, ...section.groups.flatMap((group) => group.rows)]
  const done = rows.filter((row) => seen.has(row.id)).length
  const said = section.id === 'safe' && section.groups.length > 0 ? `${count(rows.length)} in ${section.groups.length} ${section.groups.length === 1 ? 'group' : 'groups'}` : `${count(done)} of ${count(rows.length)} seen`
  return (
    <h3 className="flex h-full items-end gap-2 px-2.5 pb-1.5">
      <span className="font-heading text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{section.title}</span>
      <span className="font-heading text-[12px] font-medium text-muted-foreground tabular-nums" data-rv-seen-count={section.id}>
        {said}
      </span>
    </h3>
  )
}

const LINE_CLASS = 'pressable flex h-full w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-left'

function GroupLine({ name, rows, open, seen, active, onChoose }: { name: string; rows: readonly OutlineRow[]; open: boolean; seen: ReadonlySet<string>; active: boolean; onChoose: () => void }) {
  const done = rows.filter((row) => seen.has(row.id)).length
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <button type="button" aria-expanded={open} onMouseDown={(event) => event.preventDefault()} onClick={onChoose} className={cn(LINE_CLASS, active && 'bg-secondary')}>
      <Chevron className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-heading text-[13px] font-semibold">{name}</span>
      <span className="shrink-0 font-heading text-[12px] text-muted-foreground tabular-nums">
        {done > 0 ? `${count(done)} of ` : ''}
        {count(rows.length)}
      </span>
    </button>
  )
}

function RowLine({ row, nested, seen, current, active, onChoose }: { row: OutlineRow; nested: boolean; seen: boolean; current: boolean; active: boolean; onChoose: () => void }) {
  return (
    <button
      type="button"
      title={row.path ? `${row.title}\n${row.path}` : row.title}
      data-current={current}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onChoose}
      className={cn(LINE_CLASS, nested && 'pl-7', active && 'bg-secondary', current && 'font-semibold')}
    >
      {seen ? <Check className="size-3.5 shrink-0 text-ok-fg" aria-label="Seen" /> : <Circle className="size-3 shrink-0 text-muted-foreground/60" aria-label="Not seen yet" />}
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{row.title}</span>
      <span className="shrink-0 font-mono text-[11.5px] tabular-nums">
        <span className="text-ok-fg">+{count(row.additions)}</span> <span className="text-bad-fg">−{count(row.deletions)}</span>
      </span>
      <OpenArrow className="size-3.5" />
    </button>
  )
}
