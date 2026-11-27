import { ChevronLeft, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { play } from '@/features/sound/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { changeCard, dropCard, keepCard, keptLine, type CardPicks, type GoalCards } from './cards.ts'
import { CARD_BUTTONS, RoutineCard, type CardButton } from './RoutineCard.tsx'
import './story.css'

/** The part of the window the cards may take, in window pixels: beside hobkin, never over it. */
export interface CardsArea {
  left: number
  top: number
  width: number
  height: number
}

interface CardsScreenProps {
  /** The goal shown and its cards. One goal at a time. */
  group: GoalCards
  /** What was kept and dropped across every goal, and the changes. */
  picks: CardPicks
  onPicks: (picks: CardPicks) => void
  /** On a work computer a private card says it reads the person's own accounts. */
  work: boolean
  area: CardsArea
  /** At least 1100 wide: the cards side by side. Narrower, one at a time with the next one's edge showing. */
  wide: boolean
  /** Done: this goal's cards are done, whatever was kept. */
  onDone: () => void
  /** Escape with no card in Change: back to the goal's question. */
  onBack: () => void
  still: boolean
}

/** The bar under the cards: the arrows, More, how many are kept, and Done. */
const BAR = 56
const GAP = 16
const CARD = { wide: 308, narrowMin: 300, narrowMax: 420, peek: 120, minHeight: 360, maxHeight: 440 }
/** A sideways swipe this long, in pixels, moves one card, and the next waits this long, in milliseconds. */
const SWIPE = { distance: 60, rest: 380 }

/** Each card's size: side by side at one width, or one at a time, as wide as leaves the next one's edge in view. */
function cardSize(area: CardsArea, wide: boolean): { width: number; height: number } {
  const width = wide ? CARD.wide : Math.max(CARD.narrowMin, Math.min(CARD.narrowMax, area.width - CARD.peek))
  const height = Math.max(CARD.minHeight, Math.min(CARD.maxHeight, area.height - BAR))
  return { width, height }
}

const typingIn = (target: EventTarget) => target instanceof HTMLElement && target.matches('input, textarea')

/**
 * One goal's routine cards, over the hill beside hobkin. Keep, Change and Drop on each card, More for this goal, and
 * Done with the count beside it. As many cards as fit stand side by side, and the next one's edge shows after them.
 * Left and Right move between cards and keep the same button, Tab moves through a card's buttons, and Enter presses
 * one. The arrows, a click on the card at the edge, or a sideways swipe move them by mouse. Escape puts a card in
 * Change back, and otherwise goes back to the goal's question. With Movement still, nothing travels: the cards fade.
 * Nothing is written here: the story sends what was kept once the cards are done. See _specs/044-goal-first-setup.
 */
export function CardsScreen({ group, picks, onPicks, work, area, wide, onDone, onBack, still }: CardsScreenProps) {
  const row = useRef<HTMLDivElement | null>(null)
  const swipe = useRef({ sum: 0, until: 0 })
  const [moreShown, setMoreShown] = useState(false)
  const [changing, setChanging] = useState<string | null>(null)
  // The card whose Keep was refused, because five were kept, until the next press.
  const [full, setFull] = useState<string | null>(null)
  // The first card in view.
  const [first, setFirst] = useState(0)
  const cards = moreShown ? [...group.starters, ...group.more] : group.starters
  const size = cardSize(area, wide)
  const step = size.width + GAP
  // How many stand side by side. The one after them shows its edge.
  const fit = wide ? Math.max(1, Math.floor((area.width + GAP) / step)) : 1
  const start = Math.max(0, Math.min(first, cards.length - fit))
  const moves = cards.length > fit

  const buttonOf = (index: number, button: CardButton) => row.current?.querySelector<HTMLElement>(`[data-card="${index}"] [data-card-button="${button}"]`)

  // The first card's Keep takes the keyboard as the cards come up.
  useEffect(() => {
    buttonOf(0, 'keep')?.focus({ preventScroll: true })
  }, [group.goal])

  /** Brings a card into view, moving the row as little as it takes. */
  const show = (index: number) => setFirst(index < start ? index : index >= start + fit ? index - fit + 1 : start)

  const keep = (id: string) => {
    const { picks: next, full: refused } = keepCard(picks, id)
    setFull(refused ? id : null)
    if (refused) return
    play('pick')
    onPicks(next)
  }
  const drop = (id: string) => {
    setFull(null)
    onPicks(dropCard(picks, id))
  }

  /** Left and Right: the same button of the card before or after, brought into view. */
  const move = (from: HTMLElement, by: -1 | 1): boolean => {
    const card = from.closest<HTMLElement>('[data-card]')
    if (!card) return false
    const next = Number(card.dataset.card) + by
    if (next < 0 || next >= cards.length) return true
    const button = (from.closest<HTMLElement>('[data-card-button]')?.dataset.cardButton ?? 'keep') as CardButton
    show(next)
    ;(buttonOf(next, button) ?? buttonOf(next, CARD_BUTTONS[0]))?.focus({ preventScroll: true })
    return true
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return
    const target = event.target as HTMLElement
    if (event.key === 'Escape') {
      event.preventDefault()
      if (changing) setChanging(null)
      else onBack()
    } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.shiftKey && !typingIn(target)) {
      if (move(target, event.key === 'ArrowLeft' ? -1 : 1)) event.preventDefault()
    }
  }

  /** A card not wholly in view is brought into view by a click, before any of its buttons can be pressed. */
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const index = Number((event.target as HTMLElement).closest<HTMLElement>('[data-card]')?.dataset.card ?? NaN)
    if (Number.isNaN(index) || (index >= start && index < start + fit)) return
    event.preventDefault()
    event.stopPropagation()
    show(index)
  }

  /** A sideways swipe on a trackpad moves one card. */
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!moves || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
    const now = Date.now()
    if (now < swipe.current.until) return
    swipe.current.sum += event.deltaX
    if (Math.abs(swipe.current.sum) < SWIPE.distance) return
    setFirst(Math.max(0, Math.min(cards.length - fit, start + Math.sign(swipe.current.sum))))
    swipe.current = { sum: 0, until: now + SWIPE.rest }
  }

  const openMore = () => {
    setMoreShown(true)
    const index = group.starters.length
    show(index)
    // The first of the more takes the keyboard, once it is drawn.
    requestAnimationFrame(() => buttonOf(index, 'keep')?.focus({ preventScroll: true }))
  }

  const landed = 'translateY(0px) scale(1)'

  return (
    <motion.div
      role="group"
      aria-label="Routine cards"
      onKeyDown={onKeyDown}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: tween.enter }}
      exit={{ opacity: 0, transition: tween.exit }}
      className="absolute z-[80] flex flex-col justify-center"
      style={{ left: area.left, top: area.top, width: area.width, height: area.height }}
    >
      {/* Not a scrolling box: one would cut the glass's blur and shadows. The row moves, and the window ends it. */}
      <motion.div
        ref={row}
        onClickCapture={onClickCapture}
        onWheel={onWheel}
        className="flex"
        style={{ gap: GAP, height: size.height }}
        initial={false}
        animate={{ transform: `translateX(${-start * step}px)` }}
        transition={still ? { duration: 0 } : spring.push}
      >
        <AnimatePresence initial>
          {cards.map((card, index) => {
            // Cards before the first in view step out of the way, so nothing stands over hobkin.
            const before = index < start
            // The cards come up over the hill one after another. Held still, they only fade in.
            const wait = (index >= group.starters.length ? index - group.starters.length : index) * 0.06
            return (
              <motion.div
                key={card.id}
                className={cn('shrink-0', before && 'pointer-events-none')}
                inert={before}
                aria-hidden={before || undefined}
                data-before={before || undefined}
                onFocusCapture={() => show(index)}
                initial={{ opacity: 0, transform: still ? landed : 'translateY(40px) scale(0.96)' }}
                animate={{
                  opacity: before ? 0 : 1,
                  transform: landed,
                  // Gone once faded, so a card that stepped out of the way is never drawn over hobkin.
                  ...(before ? { transitionEnd: { visibility: 'hidden' as const } } : { visibility: 'visible' as const }),
                  transition: { transform: { ...spring.rise, delay: wait }, opacity: before ? tween.exit : { ...tween.enter, delay: wait } },
                }}
                exit={{ opacity: 0, transition: tween.exit }}
              >
                <RoutineCard
                  card={card}
                  index={index}
                  mark={picks.marks[card.id] ?? null}
                  changes={picks.changes[card.id] ?? {}}
                  work={work}
                  full={full === card.id}
                  changing={changing === card.id}
                  onKeep={() => keep(card.id)}
                  onChange={() => {
                    setFull(null)
                    setChanging(card.id)
                  }}
                  onDrop={() => drop(card.id)}
                  onSave={(edits) => {
                    onPicks(changeCard(picks, card, edits))
                    setChanging(null)
                  }}
                  onCancel={() => setChanging(null)}
                  width={size.width}
                  height={size.height}
                  still={still}
                />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </motion.div>

      {/* As wide as the cards that fit side by side, whatever this goal has, so Done never moves. */}
      <div className="mt-4 flex shrink-0 items-center gap-2" style={{ height: BAR - 16, width: wide ? Math.min(area.width, fit * step - GAP) : area.width }}>
        {/* The arrows keep their place, and show only while there are more cards than fit. */}
        <div className={cn('flex items-center gap-1', !moves && 'invisible')}>
          <Button size="icon-lg" variant="outline" aria-label="Cards before" disabled={!moves || start === 0} tabIndex={-1} onClick={() => setFirst(start - 1)} className="bg-card/60">
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button size="icon-lg" variant="outline" aria-label="Cards after" disabled={!moves || start >= cards.length - fit} tabIndex={-1} onClick={() => setFirst(start + 1)} className="bg-card/60">
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        {group.more.length && !moreShown ? (
          <Button size="lg" variant="ghost" onClick={openMore} className="text-[13.5px]">
            More for this goal
          </Button>
        ) : null}
        {wide ? (
          <span className="ml-auto flex items-center gap-1 text-[12px] whitespace-nowrap text-muted-foreground" aria-hidden="true">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
            <span className="ml-0.5">between cards</span>
          </span>
        ) : null}
        <span role="status" className={cn('rounded-full bg-card/70 px-3 py-1 font-heading text-[13px] font-medium whitespace-nowrap text-foreground tabular-nums', wide ? 'ml-3' : 'ml-auto')}>
          {keptLine(picks)}
        </span>
        <Button size="lg" className="min-w-[96px] px-4 text-[14px]" onClick={onDone}>
          Done
        </Button>
      </div>
    </motion.div>
  )
}
