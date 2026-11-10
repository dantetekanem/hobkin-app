import { AnimatePresence, motion } from 'motion/react'
import { Hero } from '@/app/Reveal.tsx'
import { Hob } from '@/avatar/Hob.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { useStill } from '@/features/reports/still.ts'
import { timeOf, waited } from '@/features/reports/time.ts'
import { tally, type WaitingRow } from './items.ts'
import { KIND, breakdown } from './kinds.ts'

/** The pile shows this many cards. The rest are a count beside it. */
const MOST_CARDS = 6
const CARD = { width: 60, height: 42 }

/** A tilt of its own for each card, taken from its id, so the pile looks put down by hand and stays the same. */
function tiltOf(id: string): number {
  let hash = 0
  for (const letter of id) hash = (hash * 31 + letter.charCodeAt(0)) | 0
  return (Math.abs(hash) % 15) - 7
}

/**
 * What waits on the user, as a scene: hobkin listening beside a pile of cards, one card for each thing. A new
 * one drops onto the pile, and an answered one is taken off the top and away. With nothing waiting, hobkin is
 * pleased and the screen says so in one line.
 */
export function PileTile({ rows, now }: { rows: readonly WaitingRow[]; now: number }) {
  const still = useStill()
  const { total, kinds, oldest } = tally(rows)
  const since = timeOf(oldest)

  return (
    <Hero>
      <section aria-label="Waiting on you" className="relative flex items-center gap-5 overflow-hidden rounded-3xl bg-background p-6 pr-8">
        <Hob mood={total ? 'listening' : 'happy'} size={84} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Waiting on you</p>
          {total ? (
            <>
              <p className="mt-1 font-heading text-[28px] leading-tight font-semibold tracking-[-0.022em]">
                <Count value={total} still={still} /> {total === 1 ? 'thing' : 'things'}
              </p>
              <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{breakdown(kinds)}.</p>
              {since !== null ? <p className="mt-0.5 text-[12px] text-muted-foreground">The oldest has waited {waited(since, now)}.</p> : null}
            </>
          ) : (
            <p className="mt-1 font-heading text-[22px] leading-tight font-semibold tracking-[-0.022em]">Nothing is waiting on you.</p>
          )}
        </div>
        <Pile rows={rows} still={still} />
      </section>
    </Hero>
  )
}

/** The count rolls to its new number: the old one rises away as the new one comes up under it. */
function Count({ value, still }: { value: number; still: boolean }) {
  return (
    <span className="relative inline-flex overflow-hidden align-bottom tabular-nums">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          className="inline-block"
          initial={still ? { opacity: 0 } : { opacity: 0, transform: 'translateY(70%)' }}
          animate={{ opacity: 1, transform: 'translateY(0%)', transition: { transform: spring.alive, opacity: tween.enter } }}
          exit={still ? { opacity: 0, transition: tween.exit } : { opacity: 0, transform: 'translateY(-70%)', transition: tween.exit }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

function Pile({ rows, still }: { rows: readonly WaitingRow[]; still: boolean }) {
  const shown = rows.slice(-MOST_CARDS)
  const more = rows.length - shown.length

  return (
    <div className="relative h-[104px] w-[150px] shrink-0" aria-hidden="true">
      <AnimatePresence initial={false}>
        {shown.map((row, index) => {
          // Each card a little higher and further along than the one under it.
          const x = (index - (shown.length - 1) / 2) * 7
          const y = -index * 8
          const tilt = tiltOf(row.id)
          const place = `translateX(${x}px) translateY(${y}px) rotate(${tilt}deg)`
          const Icon = KIND[row.kind].icon
          return (
            <motion.div
              key={row.id}
              className="absolute bottom-2 left-1/2 grid place-items-center rounded-xl border border-border bg-surface shadow-panel"
              style={{ width: CARD.width, height: CARD.height, marginLeft: -CARD.width / 2 }}
              initial={still ? { opacity: 0, transform: place } : { opacity: 0, transform: `translateX(${x}px) translateY(${y - 64}px) rotate(${tilt + 20}deg)` }}
              animate={{ opacity: 1, transform: place, transition: { transform: spring.alive, opacity: tween.enter } }}
              exit={
                still
                  ? { opacity: 0, transition: tween.exit }
                  : { opacity: 0, transform: `translateX(${x + 84}px) translateY(${y - 46}px) rotate(${tilt + 28}deg)`, transition: { transform: spring.screenExit, opacity: tween.exit } }
              }
            >
              <Icon className="size-4 text-muted-foreground" />
            </motion.div>
          )
        })}
      </AnimatePresence>
      {more > 0 ? <span className="absolute top-0 right-0 text-[12px] font-medium text-muted-foreground tabular-nums">+{more}</span> : null}
    </div>
  )
}
