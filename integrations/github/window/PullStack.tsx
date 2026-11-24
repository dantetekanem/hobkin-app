import { ArrowDown, ChevronDown, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useState } from 'react'
import { rowLayout } from '@/features/reports/list-motion.ts'
import { useStill } from '@/features/reports/still.ts'
import { stackHeading, type Layer, type PullUnit } from './page-order.ts'
import { CHECKS, Chip, LayerBadge, PullCard } from './rows.tsx'

/**
 * A stack of pull requests on the GitHub page, drawn as Work draws one (`ui/src/features/work/StackGroup.tsx`): one
 * frame under one quiet line, quieter than the layers in it, bottom first. The lowest layer here is the whole card.
 * Each layer over it is one line that a press opens to its whole card, under the line, and presses closed again. With
 * Movement set to Still nothing slides, and a card only fades. Spec: 024-github.
 */

type StackUnit = Extract<PullUnit, { kind: 'stack' }>

interface Shared {
  /** The user's own pull requests, whose cards say where their review stands. */
  mine: boolean
  live: boolean
  now: number
  variants: Variants
}

export function PullStack({ unit, order, initiallyOpen = [], ...shared }: Shared & { unit: StackUnit; order: number; /** Layers open when it first draws, by address. */ initiallyOpen?: readonly string[] }) {
  const still = useStill()
  // Opening a layer closes nothing else, and it stays open until it is pressed again.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initiallyOpen))
  const toggle = (url: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  const heading = stackHeading(unit)

  return (
    <motion.li layout={still ? false : 'position'} variants={shared.variants} custom={order} initial="enter" animate="center" exit="gone" transition={rowLayout} className="relative">
      <div role="group" aria-label={heading} className="flex flex-col gap-1.5 rounded-[28px] bg-foreground/[0.025] p-1.5 pt-3">
        <p className="px-5 text-[12.5px] leading-snug font-medium text-muted-foreground">{heading}</p>
        <ul className="relative flex flex-col">
          <AnimatePresence mode="popLayout">
            {unit.layers.flatMap((layer, index) => {
              const url = layer.entry.pull!.url
              if (index === 0) return [<PullCard key={url} entry={layer.entry} place={layer.place} {...shared} order={-1} />]
              return [<LandsThen key={`then:${url}`} />, <LayerLine key={url} layer={layer} opened={open.has(url)} onToggle={() => toggle(url)} {...shared} />]
            })}
          </AnimatePresence>
        </ul>
      </div>
    </motion.li>
  )
}

/** The arrow from one layer to the one over it, which lands after it. */
function LandsThen() {
  return (
    <li aria-hidden="true" className="flex h-5 items-center pl-[30px] text-muted-foreground/70">
      <ArrowDown className="size-3.5" />
    </li>
  )
}

/** A layer over the bottom: its place, title, number, checks and the layer it sits on, in one line that opens to its card. */
function LayerLine({ layer, opened, onToggle, ...shared }: Shared & { layer: Layer; opened: boolean; onToggle: () => void }) {
  const still = useStill()
  const { entry, place, under } = layer
  const Chevron = opened ? ChevronDown : ChevronRight
  const sitsOn = under === null ? null : `on layer ${under}`

  return (
    <motion.li layout={still ? false : 'position'} variants={shared.variants} custom={-1} initial="enter" animate="center" exit="gone" transition={rowLayout} className="relative">
      <button
        type="button"
        data-stop=""
        aria-expanded={opened}
        aria-label={`Layer ${place.layer} of ${place.of}: ${entry.title}${sitsOn ? `, ${sitsOn}` : ''}. ${opened ? 'Enter closes it.' : 'Enter opens it.'}`}
        onClick={onToggle}
        className="pressable flex min-h-11 w-full scroll-mt-[124px] scroll-mb-6 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-background/60 px-4 py-2 text-left outline-offset-[-2px] transition-colors duration-[160ms] ease-[ease] hover:bg-background focus-visible:bg-tone-2"
      >
        <LayerBadge place={place} />
        <span className="min-w-0 flex-1 basis-40 truncate text-[13.5px] leading-snug font-medium">{entry.title}</span>
        {entry.number !== null ? <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">#{entry.number}</span> : null}
        {entry.pull ? (
          <span className="hidden shrink-0 sm:inline-flex">
            <Chip {...CHECKS[entry.pull.checks]} />
          </span>
        ) : null}
        {sitsOn ? <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:inline">{sitsOn}</span> : null}
        <Chevron aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <ul className="mt-2 empty:mt-0">
        <AnimatePresence initial={false}>{opened ? <PullCard key="open" entry={entry} place={place} {...shared} order={-1} /> : null}</AnimatePresence>
      </ul>
    </motion.li>
  )
}
