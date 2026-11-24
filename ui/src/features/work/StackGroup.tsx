import { ArrowDown, ChevronDown, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useStill } from '@/app/still.ts'
import { finishedReviewId } from '@/features/review/entry.ts'
import { rowLayout, type Leaving } from '@/features/reports/list-motion.ts'
import { cn } from '@/lib/utils.ts'
import { gradeBlockOf } from './change-list.ts'
import { Grades } from './Grades.tsx'
import { ReviewBadge } from './parts.tsx'
import { RowMenu } from './RowMenu.tsx'
import { useChangeActions } from './row-actions.ts'
import { clickPressesRow } from './row-press.ts'
import { sampleAssessmentOf } from './sample-reviews.ts'
import { headingOf, layerLine, placeOf, wholeLayerOf, type Entry, type Placed } from './stacks.ts'
import { underWay } from './review-follow.ts'
import { useChangeReview } from './use-change-review.ts'

/**
 * A stack on Work (_specs/060-make-it-a-stack): one group under one quiet line, its layers bottom first. The lowest
 * layer here is the whole card. Each layer above is one line that a press opens to its whole card, under the line, and
 * presses closed again. The card is drawn by the caller, so it keeps every choice the runtime gave that layer.
 */

type StackEntry = Extract<Entry, { kind: 'stack' }>

/** Draws one layer's whole card, marked with its place. */
export type DrawCard = (layer: Placed, place: string, whole: boolean) => ReactNode

interface Props {
  entry: StackEntry
  live: boolean
  variants: Variants
  order: number
  leaving: Leaving
  onRowsLeft: () => void
  /** The user's lowest rate, which colors a layer's rate. */
  lowest: number
  onLeaving: (leaving: Leaving) => void
  drawCard: DrawCard
  /** Layers open when it first draws, by their key. */
  initiallyOpen?: readonly string[]
}

export function StackGroup({ entry, live, variants, order, leaving, onRowsLeft, lowest, onLeaving, drawCard, initiallyOpen = [] }: Props) {
  const still = useStill()
  // Opening a layer closes nothing else, and it stays open until it is pressed again.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initiallyOpen))
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <motion.li layout={still ? false : 'position'} variants={variants} custom={order} initial="enter" animate="center" exit="gone" transition={rowLayout} className="relative">
      {/* One stack, one frame, quieter than the layers in it: the layer that lands first, then each one over it, an arrow between each and the next. */}
      <div role="group" aria-label={headingOf(entry)} className="flex flex-col gap-1.5 rounded-[28px] bg-foreground/[0.025] p-1.5 pt-3">
        <p className="px-5 text-[12.5px] leading-snug font-medium text-muted-foreground">{headingOf(entry)}</p>
        <ul className="relative flex flex-col">
          <AnimatePresence mode="popLayout" custom={leaving} onExitComplete={onRowsLeft}>
            {entry.layers.flatMap((layer, index) => {
              const place = placeOf(layer.change.stack!)
              const drawn = layer === wholeLayerOf(entry) ? (
                drawCard(layer, place, true)
              ) : (
                <LayerRow key={layer.change.key} layer={layer} live={live} lowest={lowest} onLeaving={onLeaving} opened={open.has(layer.change.key)} onToggle={() => toggle(layer.change.key)} variants={variants} drawCard={() => drawCard(layer, place, false)} />
              )
              if (index === 0) return [drawn]
              return [<LandsThen key={`then:${layer.change.key}`} />, drawn]
            })}
          </AnimatePresence>
        </ul>
      </div>
    </motion.li>
  )
}

/** The arrow from one layer to the one that lands after it. */
function LandsThen() {
  return (
    <li aria-hidden="true" className="flex h-5 items-center pl-[30px] text-muted-foreground/70">
      <ArrowDown className="size-3.5" />
    </li>
  )
}

interface RowProps {
  layer: Placed
  live: boolean
  lowest: number
  onLeaving: (leaving: Leaving) => void
  opened: boolean
  onToggle: () => void
  variants: Variants
  /** The layer's whole card, drawn once the line is open. */
  drawCard: () => ReactNode
}

function LayerRow({ layer, live, lowest, onLeaving, opened, onToggle, variants, drawCard }: RowProps) {
  const still = useStill()
  const { change } = layer
  const line = layerLine({ stack: change.stack!, title: change.title })
  const reviewId = finishedReviewId(change, live)
  const followed = useChangeReview(live ? reviewId : null, change.head)
  const assessment = live ? followed.assessment : sampleAssessmentOf(change)
  const actions = useChangeActions({ change, live, onLeaving, again: followed.again })
  const block = gradeBlockOf(change, assessment?.state)
  const Chevron = opened ? ChevronDown : ChevronRight

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.key !== 'Enter') return
    event.preventDefault()
    onToggle()
  }
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (clickPressesRow(event)) onToggle()
  }

  return (
    <motion.li layout={still ? false : 'position'} variants={variants} custom={-1} initial="enter" animate="center" exit="gone" transition={rowLayout} className="relative">
      <div
        data-work-item=""
        data-work-main=""
        data-stop=""
        data-layer={change.key}
        tabIndex={-1}
        role="button"
        aria-expanded={opened}
        aria-label={`${line.place}: ${line.title}, ${line.lands}. ${opened ? 'Enter closes it.' : 'Enter opens it.'}`}
        onKeyDown={onKeyDown}
        onClick={onClick}
        className={cn('pressable flex min-h-11 scroll-mt-[124px] scroll-mb-6 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-background/60 px-4 py-2 outline-offset-[-2px] transition-colors duration-[160ms] ease-[ease] focus-visible:bg-tone-2')}
      >
        <Grades block={block} lowest={lowest} />
        <span className="w-9 shrink-0 text-[12px] font-medium text-muted-foreground tabular-nums">{line.place}</span>
        <span className="min-w-0 flex-1 basis-40 truncate text-[13.5px] leading-snug font-medium">{line.title}</span>
        <ReviewBadge status={assessment} />
        <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:inline">{line.lands}</span>
        <RowMenu change={change} live={live} actions={actions} reviewing={underWay(assessment)} />
        <Chevron aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </div>
      <ul className="mt-2 empty:mt-0">
        <AnimatePresence initial={false} custom={'filtered' satisfies Leaving}>
          {opened ? drawCard() : null}
        </AnimatePresence>
      </ul>
    </motion.li>
  )
}
