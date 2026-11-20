import { useEffect, useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { Hob } from '@/avatar/Hob.tsx'
import { usePetChoice } from '@/avatar/use-pet.ts'
import { AgentHood } from '@/components/Mark.tsx'
import { Button } from '@/components/ui/button.tsx'
import { runCommand } from '@/lib/host/index.ts'
import { tween, spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useStill } from '@/features/reports/still.ts'
import { clockTime } from '../reports/time.ts'
import { openTarget } from './navigate.ts'
import { DOT, leaves, TEXT, ToneDot } from './parts.tsx'
import { cardText } from './scene.ts'
import { MANUAL_HOLD_MS, visibleCardId, type StackSelection } from './stack-selection.ts'
import type { HomeModel, HomeRow, HomeTarget, HomeTone, StackCard } from './types.ts'
import './home.css'

function greeting(now: number): string {
  const hour = new Date(now).getHours()
  if (hour < 5) return 'Up late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

const today = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

/** Where the stars sit at night, as a share of the width and pixels from the top. */
const STARS = [[8, 14], [16, 40], [24, 22], [33, 52], [41, 12], [52, 34], [60, 18], [68, 46], [76, 10], [84, 30], [91, 54], [96, 20]] as const

/** The sky behind everything: the sun crossing it by the hour (the moon in the dark theme), stars at night, three hills. */
function Sky({ now }: { now: number }) {
  const time = new Date(now)
  const arc = Math.max(0, Math.min(1, (time.getHours() + time.getMinutes() / 60 - 6) / 16))
  const left = `calc(100% - ${Math.round(250 - arc * 170)}px)`
  const lift = Math.sin(arc * Math.PI)
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="hidden dark:block">
        {STARS.map(([x, y], index) => (
          <span key={`${x}:${y}`} className="home-twinkle absolute size-[3px] rounded-full bg-mark" style={{ left: `${x}%`, top: y, animationDelay: `${index * 0.37}s` }} />
        ))}
      </div>
      <span className="home-sun absolute size-16 rounded-full dark:hidden @max-[760px]:hidden" style={{ left, top: 80 - lift * 52 }} />
      <span className="home-moon absolute hidden size-16 rounded-full dark:block @max-[760px]:dark:hidden" style={{ left, top: 60 - lift * 36 }} />
      <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-[190px] w-full">
        <path d="M0 110 C160 70 300 96 460 80 C620 64 800 92 1000 70 L1000 200 L0 200 Z" fill="var(--hb-ridge-0)" />
        <path d="M0 145 C200 112 380 136 560 120 C720 106 860 132 1000 116 L1000 200 L0 200 Z" fill="var(--hb-ridge-1)" />
        <path d="M0 172 C250 156 500 170 750 158 C850 154 940 162 1000 156 L1000 200 L0 200 Z" fill="var(--hb-ridge-2)" />
      </svg>
    </div>
  )
}

type Way = 1 | -1

/** A card slides in from the side it was paged toward. It moves only inside the card's fixed text box. */
const slide: Variants = {
  from: (way: Way) => ({ opacity: 0, x: 24 * way }),
  shown: { opacity: 1, x: 0, transition: { x: spring.follow, opacity: tween.enter } },
  gone: (way: Way) => ({ opacity: 0, x: -16 * way, transition: tween.exit }),
}

/** Under Still a card only fades. */
const fade: Variants = {
  from: { opacity: 0 },
  shown: { opacity: 1, transition: tween.fade },
  gone: { opacity: 0, transition: tween.exit },
}

interface Words {
  tone: HomeTone
  label: string
  title: string
  detail: string | null
  chips: string[]
}

const WAITING_WORDS: Words = {
  tone: 'quiet',
  label: 'Waiting for hobkin',
  title: 'Home fills in once hobkin says what it knows',
  detail: null,
  chips: [],
}

const CALM_WORDS: Words = {
  tone: 'ok',
  label: 'All clear',
  title: 'Nothing is waiting for you',
  detail: 'When something needs you, it shows here first.',
  chips: [],
}

/** The card's words in its fixed box: what it is, its title and detail clamped, its facts pinned to the bottom. */
function CardWords({ tone, label, title, detail, chips }: Words) {
  return (
    <>
      <p className={cn('flex min-w-0 items-center gap-2 text-[13px] font-semibold', TEXT[tone])}>
        <ToneDot tone={tone} />
        <span className="truncate">{label}</span>
      </p>
      <p className="line-clamp-2 font-heading text-[19px] leading-[1.25] font-semibold break-words">{title}</p>
      {detail ? <p className="line-clamp-2 text-sm leading-[1.45] break-words text-muted-foreground">{detail}</p> : null}
      {chips.length ? (
        <ul className="mt-auto flex min-w-0 flex-nowrap gap-1.5 overflow-hidden">
          {chips.map(chip => (
            <li key={chip} className="shrink-0 rounded-full border border-border bg-tone-1 px-2 py-[3px] font-mono text-[11.5px] whitespace-nowrap">{chip}</li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

const PAGE = 'grid size-11 place-items-center rounded-xl border border-border text-foreground transition-colors hover:bg-tone-1 [&_svg]:size-4'

/** The action slots, left to right. The first two keep one width whatever their words, so nothing after them moves. */
const FIRST_SLOT = 'h-11 w-44 rounded-xl text-sm font-semibold'
const SECOND_SLOT = 'h-11 w-20 rounded-xl text-sm'
const LAST_SLOT = 'h-11 min-w-0 shrink rounded-xl text-sm'

type ReminderStatus = 'done' | 'dismissed'

/**
 * What the user can do with the card on top. A reminder is marked done or dismissed here; any other card opens where
 * it is handled, or waits for later. With no card, a calm Home points to Action Items.
 */
function CardActions({ card, unavailable, saving, onResolve, onLater }: {
  card: StackCard | undefined
  unavailable: boolean
  saving: boolean
  onResolve: (status: ReminderStatus) => void
  onLater: (id: string) => void
}) {
  if (card?.reminder) {
    return (
      <>
        <Button disabled={saving} onClick={() => onResolve('done')} className={FIRST_SLOT}>Done</Button>
        <Button variant="outline" disabled={saving} onClick={() => onResolve('dismissed')} className={SECOND_SLOT}>Dismiss</Button>
        <Button variant="ghost" onClick={() => openTarget(card.primary.target)} className={LAST_SLOT}>
          <span className="truncate">{card.primary.label}</span>
        </Button>
      </>
    )
  }

  if (card) {
    const { primary, secondary } = card
    return (
      <>
        <Button onClick={() => openTarget(primary.target)} className={FIRST_SLOT}>
          <span className="truncate">{primary.label}</span>
          {leaves(primary.target) ? <ArrowUpRight aria-hidden="true" /> : null}
        </Button>
        <Button variant="outline" onClick={() => onLater(card.id)} aria-label={`Later: ${card.title}`} className={SECOND_SLOT}>Later</Button>
        {secondary ? (
          <Button variant="ghost" onClick={() => openTarget(secondary.target)} className={LAST_SLOT}>
            <span className="truncate">{secondary.label}</span>
            {leaves(secondary.target) ? <ArrowUpRight aria-hidden="true" /> : null}
          </Button>
        ) : null}
      </>
    )
  }

  if (unavailable) return null

  return (
    <Button variant="outline" onClick={() => openTarget({ to: 'screen', screen: 'actions' })} className="h-11 rounded-xl px-4 text-sm">
      See Action Items
    </Button>
  )
}

/**
 * The pager card in the middle of the stage: the one thing that matters most right now, and the rest a click away.
 * Its text sits in a box of fixed height, so paging never moves a button: the actions keep their widths on the left,
 * the pager its place on the right. "Later" puts a card away; a choice holds for a while, then the top card leads again.
 */
function StageCard({ model, unavailable, onDismiss, className }: { model: HomeModel; unavailable: boolean; onDismiss: (id: string) => void; className?: string }) {
  const still = useStill()
  const cards = model.stack
  const [selected, setSelected] = useState<StackSelection | null>(null)
  const [direction, setDirection] = useState<Way>(1)
  const [saving, setSaving] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null)
  const ids = cards.map(card => card.id)
  const id = visibleCardId(ids, selected, Date.now())
  const index = Math.max(0, cards.findIndex(card => card.id === id))
  const card: StackCard | undefined = cards[index]
  const selectedExists = selected !== null && ids.includes(selected.id)
  const now = model.upcoming.day.now

  useEffect(() => {
    if (!selected) return
    if (!selectedExists) {
      setSelected(null)
      return
    }
    const timer = setTimeout(() => setSelected(null), Math.max(0, selected.at + MANUAL_HOLD_MS - Date.now()))
    return () => clearTimeout(timer)
  }, [selected, selectedExists])

  const choose = (to: number, way: Way) => {
    setDirection(way)
    setSelected({ id: cards[(to + cards.length) % cards.length]!.id, at: Date.now() })
  }

  const resolveReminder = async (status: ReminderStatus) => {
    if (!card?.reminder || saving) return
    const { id, reminder } = card
    setSaving(id)
    setFailure(null)
    try {
      await runCommand('reminder.resolve', { ...reminder, status })
    } catch (error) {
      setFailure({ id, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(null)
    }
  }

  const after = cards.length > 1 ? cards[(index + 1) % cards.length] : undefined
  let words = unavailable ? WAITING_WORDS : CALM_WORDS
  if (card) words = { tone: card.tone, label: card.label, title: card.title, ...cardText(card) }

  return (
    <div className={cn('flex min-w-0 flex-col gap-3 rounded-[20px] border border-border bg-surface px-[22px] py-5 shadow-panel', className)}>
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <p className="eyebrow truncate text-xs">{greeting(now)} · {today.format(now)}</p>
        <p className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{clockTime(now)}</p>
      </div>
      <h1 className="truncate font-heading text-[28px] leading-[1.15] font-semibold">{model.header.title}</h1>
      <div aria-label="Choose a card" className="flex h-4 items-center gap-1">
        {cards.map((item, at) => (
          <button
            key={item.id}
            type="button"
            aria-label={`Show ${item.label}: ${item.title}`}
            aria-pressed={item.id === card?.id}
            onClick={() => choose(at, at < index ? -1 : 1)}
            className="group flex h-4 flex-1 items-center"
          >
            <span className={cn('h-1 w-full rounded-full transition-opacity', DOT[item.tone], item.id === card?.id ? 'opacity-100' : 'opacity-30 group-hover:opacity-70')} />
          </button>
        ))}
      </div>
      <div className="relative h-[158px] overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={card?.id ?? (unavailable ? 'waiting' : 'calm')}
            custom={direction}
            variants={still ? fade : slide}
            initial="from"
            animate="shown"
            exit="gone"
            className="flex h-full min-w-0 flex-col gap-1.5"
          >
            <CardWords {...words} />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex h-11 min-w-0 items-center gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
          <CardActions
            card={card}
            unavailable={unavailable}
            saving={saving !== null}
            onResolve={(status) => void resolveReminder(status)}
            onLater={onDismiss}
          />
        </div>
        {cards.length > 1 ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" aria-label="Previous card" onClick={() => choose(index - 1, -1)} className={PAGE}><ChevronLeft aria-hidden="true" /></button>
            <span className="w-12 text-center font-mono text-xs text-muted-foreground tabular-nums">{index + 1} of {cards.length}</span>
            <button type="button" aria-label="Next card" onClick={() => choose(index + 1, 1)} className={PAGE}><ChevronRight aria-hidden="true" /></button>
          </div>
        ) : null}
      </div>
      {card ? (
        <div className="flex min-w-0 flex-col gap-0.5 text-[12.5px] text-muted-foreground">
          {failure?.id === card.id ? <p role="alert" className="truncate text-bad-fg">{failure.message}</p> : <p className="truncate">{card.reason}</p>}
          {after ? (
            <button type="button" onClick={() => choose(index + 1, 1)} className="truncate text-left hover:text-foreground">Then: {after.title}</button>
          ) : (
            <p className="truncate">Then: nothing else waits.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** One agent at work, standing on the hills: what it is doing over its head. It holds still under the pointer. */
function Walker({ row, index, still }: { row: HomeRow; index: number; still: boolean }) {
  return (
    <li className={index % 2 ? 'home-walk-b' : 'home-walk-a'}>
      <button
        type="button"
        onClick={() => openTarget(row.action.target)}
        aria-label={`${row.title}: ${row.detail ?? row.action.label}`}
        title={row.title}
        className="flex max-w-[160px] flex-col items-center gap-1.5"
      >
        <span className={cn('max-w-full truncate rounded-full border bg-surface px-2 py-[3px] text-[11.5px] shadow-panel', row.face?.asking ? 'border-sun text-sun-fg' : 'border-border')}>
          {row.detail ?? row.title}
        </span>
        {row.face ? <AgentHood hue={row.face.hue} size={52} mood={row.face.mood} asking={row.face.asking} working={!still} /> : null}
      </button>
    </li>
  )
}

const WORK: HomeTarget = { to: 'screen', screen: 'work' }

/** The right side of the stage: the agents at work, or a quiet line saying why nobody is. */
function Lane({ running, unavailable, still, className }: { running: HomeModel['running']; unavailable: boolean; still: boolean; className?: string }) {
  const shown = running.rows.slice(0, 4)
  const more = running.rows.length - shown.length
  let quiet = 'Nobody is at work right now.'
  if (unavailable) quiet = 'Waiting for hobkin.'
  else if (running.held) quiet = `Work held: ${running.held}`
  return (
    <div aria-label="Agents at work" className={cn('flex min-h-[200px] min-w-0 flex-col justify-end gap-3 @max-[760px]:min-h-[120px]', className)}>
      {shown.length ? (
        <ul className="flex flex-wrap-reverse items-end justify-around gap-x-3 gap-y-4">
          {shown.map((row, index) => <Walker key={row.id} row={row} index={index} still={still} />)}
        </ul>
      ) : (
        <p className="self-center rounded-full border border-border bg-surface px-3 py-1.5 text-center text-xs text-muted-foreground shadow-panel">{quiet}</p>
      )}
      {more > 0 ? (
        <button type="button" onClick={() => openTarget(WORK)} className="self-center rounded-full text-xs text-muted-foreground hover:text-foreground">+{more} more at work</button>
      ) : null}
    </div>
  )
}

/** hobkin itself, on the left of the stage. Its eyes follow the pointer across the stage unless the app is still. */
function HobColumn({ mood, still, within }: { mood: HomeModel['header']['mood']; still: boolean; within: RefObject<HTMLElement | null> }) {
  return (
    <div className="flex justify-center self-end @max-[760px]:row-start-2">
      <Hob
        mood={mood}
        still={still}
        size={184}
        stage="var(--home-sky)"
        followWithin={still ? undefined : within}
        className="-mx-3 -mb-[22px] shrink-0 @max-[760px]:mx-0 @max-[760px]:-mb-[13px] @max-[760px]:size-[110px]"
      />
    </div>
  )
}

/**
 * The top of Home: a sky with hobkin on the left, the pager card in the middle and the agents at work on the right.
 * Nothing sits over anything else; the grid places every piece. With No Pet chosen, the card and the lane share the stage.
 */
export function Stage({ model, unavailable, onDismiss }: { model: HomeModel; unavailable: boolean; onDismiss: (id: string) => void }) {
  const still = useStill()
  const stage = useRef<HTMLElement | null>(null)
  const pet = usePetChoice() !== 'none'
  return (
    <section ref={stage} aria-label="hobkin right now" data-still={still || undefined} className="home-scene @container relative isolate overflow-hidden rounded-[24px] border border-border">
      <Sky now={model.upcoming.day.now} />
      <div
        className={cn(
          'relative grid min-h-[380px] items-end gap-6 px-6 pt-7 pb-[26px] @max-[760px]:gap-4 @max-[760px]:px-3.5 @max-[760px]:pt-4 @max-[760px]:pb-[18px]',
          pet ? 'grid-cols-[160px_minmax(0,1fr)_260px] @max-[760px]:grid-cols-[100px_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_260px] @max-[760px]:grid-cols-1',
        )}
      >
        {pet ? <HobColumn mood={model.header.mood} still={still} within={stage} /> : null}
        <StageCard model={model} unavailable={unavailable} onDismiss={onDismiss} className="self-center @max-[760px]:col-span-full @max-[760px]:row-start-1" />
        <Lane running={model.running} unavailable={unavailable} still={still} className="self-stretch @max-[760px]:row-start-2" />
      </div>
    </section>
  )
}

/** The status chips under the stage, never over it: each goes where it names. */
export function StatusChips({ header }: { header: HomeModel['header'] }) {
  const chips = [...header.chips]
  if (header.line) chips.push({ tone: 'info', label: header.line, target: { to: 'screen', screen: 'reports' } })
  if (!chips.length) return null
  return (
    <ul aria-label="Home status" className="flex flex-wrap gap-2">
      {chips.map(chip => (
        <li key={chip.label}>
          <button
            type="button"
            onClick={() => openTarget(chip.target)}
            className="flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs transition-colors hover:border-border-strong"
          >
            <ToneDot tone={chip.tone} className="size-[7px]" />
            {chip.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
