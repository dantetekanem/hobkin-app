import { motion, type Variants } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { Rise } from '@/app/Reveal.tsx'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { stagger, staggerDelay } from '@/lib/motion.ts'
import { useLookAtServers } from '@/features/integrations/live.ts'
import { useStill } from '@/features/reports/still.ts'
import { HomeWidgets } from './HomeWidgets.tsx'
import { openTarget } from './navigate.ts'
import { ToneDot } from './parts.tsx'
import { TipStrip } from './TipStrip.tsx'
import type { HomeModel } from './types.ts'
import { useHomeModel } from './use-home.ts'

/** Home's pieces land one after another once the screen has arrived, the header first. */
const pieces: Variants = {
  enter: {},
  center: { transition: { staggerChildren: stagger, delayChildren: staggerDelay } },
}

function greeting(now: number): string {
  const hour = new Date(now).getHours()
  if (hour < 5) return 'Up late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

function Header({ header, now, still }: { header: HomeModel['header']; now: number; still: boolean }) {
  return (
    <header className="flex min-w-0 items-start gap-4 px-1">
      <Hob mood={header.mood} still={still} size={60} className="shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="eyebrow">{greeting(now)} · {today.format(now)}</p>
        <h1 className="break-words font-heading text-[30px] leading-tight font-semibold tracking-tight">{header.title}</h1>
        {header.line ? <p className="break-words text-sm text-muted-foreground">{header.line}</p> : null}
        {header.chips.length ? (
          <ul aria-label="Home status" className="mt-2 flex flex-wrap gap-2">
            {header.chips.map(chip => (
              <li key={chip.label}>
                <button
                  type="button"
                  onClick={() => openTarget(chip.target)}
                  className="group flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface py-1 pr-2 pl-2.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                >
                  <ToneDot tone={chip.tone} />
                  <span className="break-words">{chip.label}</span>
                  <ChevronRight aria-hidden="true" className="size-3 opacity-60 group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </header>
  )
}

export function HomeScreen() {
  const model = useHomeModel()
  const still = useStill()
  // The host reads Pi's servers only when asked. Without this, Connections stays empty until the Integrations screen opens.
  useLookAtServers()
  // An available model always supplies seven days, including when there are no runs.
  const unavailable = model.week.days.length === 0
  return (
    <div className={`${SCREEN_SCROLLER} pb-10`}>
      <motion.div variants={pieces} className={`${SCREEN_COLUMN} @container flex flex-col gap-6`}>
        <Rise>
          <Header header={model.header} now={model.upcoming.day.now} still={still} />
        </Rise>
        {model.strip.length ? <Rise><TipStrip items={model.strip} /></Rise> : null}
        <HomeWidgets model={model} unavailable={unavailable} />
      </motion.div>
    </div>
  )
}
