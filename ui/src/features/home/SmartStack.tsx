import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { ArrowRight, ArrowUpRight, Bot, CalendarClock, ChevronLeft, ChevronRight, GitMerge, GitPullRequest, Inbox, MessageCircleQuestion, Signpost, Sparkles, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { runCommand } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { useStill } from '@/features/reports/still.ts'
import { openTarget } from './navigate.ts'
import { DOT, leaves, TEXT, ToneIcon } from './parts.tsx'
import { MANUAL_HOLD_MS, visibleCardId, type StackSelection } from './stack-selection.ts'
import type { HomeTone, StackCard } from './types.ts'

const ICON: Record<StackCard['kind'], ReactNode> = {
  reminder: <CalendarClock />,
  question: <MessageCircleQuestion />,
  decision: <Signpost />,
  review: <GitMerge />,
  github: <GitPullRequest />,
  problem: <TriangleAlert />,
  away: <Inbox />,
  agent: <Bot />,
  upnext: <CalendarClock />,
  today: <Sparkles />,
}

/** A soft wash of the card's tone across its top, so a problem and a decision do not look alike at a glance. */
const WASH: Record<HomeTone, string> = {
  accent: 'from-sun/12', bad: 'from-bad/12', warn: 'from-warn/12', ok: 'from-ok/12', info: 'from-code/12', quiet: 'from-transparent',
}

type Way = 1 | -1

/** A card slides in from the side it was paged toward and leaves the other way. AnimatePresence hands the leaving card the latest way. */
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

function Body({ card }: { card: StackCard }) {
  const asks = card.pick !== null || card.choices.length > 0
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="line-clamp-3 break-words font-heading text-[24px] leading-[1.2] font-semibold tracking-tight">{card.title}</h2>
        {card.detail ? <p className="line-clamp-3 break-words text-sm leading-relaxed text-muted-foreground">{card.detail}</p> : null}
      </div>
      {card.facts.length ? (
        <dl className="grid grid-cols-2 gap-2 @[420px]:grid-cols-4">
          {card.facts.map(fact => (
            <div key={`${fact.label}:${fact.value}`} className="min-w-0 rounded-xl border border-border bg-surface px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">{fact.label}</dt>
              <dd className={cn('truncate text-sm font-medium tabular-nums', TEXT[fact.tone])}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {card.next ? (
        <p className="flex gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-[13px] leading-relaxed">
          <ArrowRight aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span><span className="font-medium">Next: </span><span className="text-muted-foreground">{card.next}</span></span>
        </p>
      ) : null}
      {asks ? (
        <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface px-3 py-2.5">
          {card.pick ? (
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-[13px]">
              <Sparkles aria-hidden="true" className="size-3.5 shrink-0 self-center text-sun-fg" />
              <span className="text-muted-foreground">hobkin suggests</span>
              <span className="font-medium">{card.pick}</span>
            </p>
          ) : null}
          {card.why ? <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{card.why}</p> : null}
          {card.choices.length ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">You choose from: </span>
              {card.choices.join(' · ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The one thing that matters most right now, with what the user needs to weigh it, and a button that goes where it is
 * handled. The user can page through the rest, or dismiss the one on top ("seen it / not now") and the next takes over;
 * a choice holds for a while, then the top card leads again. The whole stack is hidden when nothing needs the user, so
 * this only ever renders with at least one card.
 */
export function SmartStack({ cards, onDismiss }: { cards: StackCard[]; onDismiss: (id: string) => void }) {
  const still = useStill()
  const [selected, setSelected] = useState<StackSelection | null>(null)
  const [direction, setDirection] = useState<Way>(1)
  const [saving, setSaving] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null)
  const ids = cards.map(card => card.id)
  const id = visibleCardId(ids, selected, Date.now())
  const index = cards.findIndex(card => card.id === id)
  const card = cards[index]
  const selectedExists = selected !== null && ids.includes(selected.id)
  const resolveReminder = async (status: 'done' | 'dismissed') => {
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

  useEffect(() => {
    if (!selected) return
    if (!selectedExists) {
      setSelected(null)
      return
    }
    const timer = setTimeout(
      () => setSelected(null),
      Math.max(0, selected.at + MANUAL_HOLD_MS - Date.now())
    )
    return () => clearTimeout(timer)
  }, [selected, selectedExists])

  const choose = (to: number, way: Way) => {
    setDirection(way)
    setSelected({ id: cards[(to + cards.length) % cards.length]!.id, at: Date.now() })
  }
  const after = cards.length > 1 ? cards[(index + 1) % cards.length] : undefined
  const tone = card?.tone ?? 'quiet'
  const icon = card ? (card.primary.target.to === 'review' ? <GitMerge /> : ICON[card.kind]) : null

  return (
    <section aria-label="Smart stack" className="@container relative flex h-full min-h-[340px] min-w-0 flex-col overflow-hidden rounded-[22px] border border-border-strong bg-surface-2 shadow-lg">
      <div aria-hidden="true" className={cn('pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b to-transparent transition-colors', WASH[tone])} />
      <div className="relative flex flex-1 flex-col gap-5 p-6">
        {card ? (
          <header className="flex min-w-0 items-center gap-3">
            <ToneIcon tone={tone} size="lg">{icon}</ToneIcon>
            <div className="min-w-0 flex-1">
              <p className="eyebrow truncate">{card.label}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{card.reason}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {cards.length > 1 ? (
                <>
                  <button type="button" aria-label="Previous card" onClick={() => choose(index - 1, -1)} className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground">
                    <ChevronLeft aria-hidden="true" className="size-4" />
                  </button>
                  <span className="min-w-10 text-center text-xs text-muted-foreground tabular-nums">{index + 1} of {cards.length}</span>
                  <button type="button" aria-label="Next card" onClick={() => choose(index + 1, 1)} className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground">
                    <ChevronRight aria-hidden="true" className="size-4" />
                  </button>
                </>
              ) : null}
              {card ? (
                <button type="button" aria-label={`Dismiss: ${card.title}`} disabled={saving !== null} onClick={() => card.reminder ? void resolveReminder('dismissed') : onDismiss(card.id)} className="ml-0.5 grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground">
                  <X aria-hidden="true" className="size-4" />
                </button>
              ) : null}
            </div>
          </header>
        ) : null}

        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={card?.id ?? 'empty'}
            custom={direction}
            variants={still ? fade : slide}
            initial="from"
            animate="shown"
            exit="gone"
            className="flex flex-1 flex-col"
          >
            {card ? <Body card={card} /> : null}
          </motion.div>
        </AnimatePresence>

        {card ? (
          <footer className="mt-auto flex min-w-0 flex-wrap items-center gap-2">
            {card.reminder ? (
              <>
                <Button size="lg" disabled={saving !== null} onClick={() => void resolveReminder('done')}>Done</Button>
                <Button size="lg" variant="outline" disabled={saving !== null} onClick={() => void resolveReminder('dismissed')}>Dismiss</Button>
                {failure?.id === card.id ? <p role="alert" className="w-full text-sm text-bad-fg">{failure.message}</p> : null}
              </>
            ) : null}
            <Button size="lg" variant={card.reminder ? 'outline' : 'default'} onClick={() => openTarget(card.primary.target)} className="h-10 px-4 text-sm font-semibold">
              {card.primary.label}
              {leaves(card.primary.target) ? <ArrowUpRight aria-hidden="true" data-icon="inline-end" /> : <ArrowRight aria-hidden="true" data-icon="inline-end" />}
            </Button>
            {card.secondary ? (
              <Button size="lg" variant="outline" onClick={() => openTarget(card.secondary!.target)} className="h-10 px-4 text-sm">
                {card.secondary.label}
                {leaves(card.secondary.target) ? <ArrowUpRight aria-hidden="true" data-icon="inline-end" /> : null}
              </Button>
            ) : null}
            {after ? (
              <button
                type="button"
                onClick={() => choose(index + 1, 1)}
                className="ml-auto flex min-w-0 max-w-[50%] items-center gap-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground"
              >
                <span className="shrink-0">Then:</span>
                <span className="truncate">{after.title}</span>
              </button>
            ) : null}
          </footer>
        ) : null}
      </div>
      {cards.length > 1 ? (
        <div aria-label="Choose a card" className="relative flex gap-1.5 px-6 pb-5">
          {cards.map((item, at) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Show ${item.label}: ${item.title}`}
              aria-pressed={item.id === id}
              onClick={() => choose(at, at < index ? -1 : 1)}
              className="group flex h-4 flex-1 items-center"
            >
              <span className={cn('h-1 w-full rounded-full transition-[background-color,opacity]', item.id === id ? DOT[item.tone] : 'bg-border-strong opacity-50 group-hover:opacity-100')} />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
