import { Search } from 'lucide-react'
import { AnimatePresence, motion, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReviewNode } from '#shared/review/types.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { dur, ease, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useRig, useSession, useSessionStore } from '../state/context.tsx'
import { findNodes, type FinderHit } from './finder.ts'
import { KIND } from './kinds.tsx'

/**
 * The finder: `/` opens it, typing filters every node by name, path, acceptance id or kind, the arrows move
 * through what it found, and Enter focuses it. The node under the keyboard lights up in the graph as it is
 * chosen, so the reviewer sees where it is before going there.
 *
 * It opens on a key many times in a review, so it appears fast and quietly (160ms), and the travel to the
 * node it finds is the movement that explains.
 */
export function Finder() {
  const open = useSession((session) => session.finder)
  return <AnimatePresence>{open ? <FinderBox key="finder" /> : null}</AnimatePresence>
}

function FinderBox() {
  const store = useSessionStore()
  const rig = useRig()
  const nodes = useSession((session) => session.view.nodes)
  const nodeOf = useSession((session) => session.nodeOf)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => findNodes(nodes, query, 8), [nodes, query])
  const chosen = hits[Math.min(active, hits.length - 1)]
  // It stays in the middle of what the steps panel leaves uncovered, under the frame's menu.
  const place = useTransform(() => `translateX(${rig.side.get() / 2}px)`)

  useLayoutEffect(() => field.current?.focus({ preventScroll: true }), [])
  // The node the keyboard is on lights up in the graph, with its wires and neighbors.
  useEffect(() => store.getState().hoverOn(chosen?.id ?? null), [chosen?.id, store])
  useEffect(() => setActive(0), [query])

  const close = () => {
    store.getState().closeFinder()
    field.current?.closest<HTMLElement>('[data-rv-root]')?.focus({ preventScroll: true })
  }
  const go = (hit: FinderHit | undefined) => {
    if (!hit) return
    const root = field.current?.closest<HTMLElement>('[data-rv-root]')
    store.getState().closeFinder()
    store.getState().focusOn(hit.id)
    root?.focus({ preventScroll: true })
  }

  return (
    <motion.div className="pointer-events-none absolute inset-x-0 top-[104px] z-30 flex justify-center px-4" style={{ transform: place }}>
      <motion.div
        role="dialog"
        aria-label="Find a node"
        className="rv-float pointer-events-auto flex w-full max-w-[440px] flex-col overflow-hidden rounded-[20px]"
        initial={{ opacity: 0, transform: 'translateY(-8px) scale(0.98)' }}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { duration: dur.fast, ease: ease.out } }}
        exit={{ opacity: 0, transform: 'translateY(-4px) scale(0.99)', transition: tween.exit }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) store.getState().closeFinder()
        }}
      >
        <label className="flex h-12 items-center gap-2.5 px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={field}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a node by name, path or kind"
            aria-label="Find a node by name, path or kind"
            aria-controls="rv-finder-list"
            aria-activedescendant={chosen ? `rv-find-${chosen.id}` : undefined}
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(event) => {
              // The words belong to the field: no key typed here walks the story.
              event.stopPropagation()
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((at) => Math.max(0, Math.min(hits.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1))))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                go(chosen)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                close()
              }
            }}
            className="min-w-0 flex-1 bg-transparent font-sans text-[15px] outline-none placeholder:text-muted-foreground"
          />
          <Kbd>esc</Kbd>
        </label>
        <ul id="rv-finder-list" role="listbox" aria-label="Nodes" className="rv-scroll max-h-[min(380px,50vh)] overflow-y-auto border-t border-border p-1.5">
          {hits.length === 0 ? <li className="px-3 py-3 text-[13px] text-muted-foreground">No node matches.</li> : null}
          {hits.map((hit, index) => {
            const node = nodeOf.get(hit.id)
            return node ? <Row key={hit.id} hit={hit} node={node} active={hit === chosen} onPoint={() => setActive(index)} onChoose={() => go(hit)} /> : null
          })}
        </ul>
        <p className="flex items-center gap-3 border-t border-border px-4 py-2 text-[12.5px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            choose
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            go there
          </span>
          <span className="flex items-center gap-1">
            <Kbd>,</Kbd>
            back after
          </span>
        </p>
      </motion.div>
    </motion.div>
  )
}

function Row({ hit, node, active, onPoint, onChoose }: { hit: FinderHit; node: ReviewNode; active: boolean; onPoint: () => void; onChoose: () => void }) {
  const { icon: Icon, label } = KIND[node.kind]
  const row = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (active) row.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <li
      ref={row}
      id={`rv-find-${hit.id}`}
      role="option"
      aria-selected={active}
      onPointerMove={onPoint}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onChoose}
      className={cn('flex cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2', active && 'bg-secondary')}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-heading text-[13.5px] font-medium tracking-[-0.01em]">
          <Marked text={node.title} marks={hit.marks} />
        </span>
        {node.subtitle ? <span className="block truncate font-mono text-[12px] text-muted-foreground">{node.subtitle}</span> : null}
      </span>
      <span className="mt-0.5 shrink-0 font-heading text-[11.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{label}</span>
    </li>
  )
}

/** The title with the letters that matched in bold. */
function Marked({ text, marks }: { text: string; marks: readonly [number, number][] }) {
  if (marks.length === 0) return <>{text}</>
  const sorted = [...marks].sort((a, b) => a[0] - b[0])
  const parts: React.ReactNode[] = []
  let at = 0
  sorted.forEach(([start, end], index) => {
    if (start < at) return
    if (start > at) parts.push(text.slice(at, start))
    parts.push(
      <b key={index} className="font-semibold text-foreground underline decoration-primary decoration-2 underline-offset-[3px]">
        {text.slice(start, end)}
      </b>,
    )
    at = end
  })
  parts.push(text.slice(at))
  return <>{parts}</>
}
