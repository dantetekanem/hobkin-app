import { motion, type Variants } from 'motion/react'
import { useMemo } from 'react'
import { Hero } from '@/app/Reveal.tsx'
import { Hob } from '@/avatar/Hob.tsx'
import type { Mood } from '@/avatar/moods.tsx'
import { dur, ease, spring, stagger, staggerDelay, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { summarize, type Summary } from './inbox.ts'
import { toneOf, type Report, type Tone } from './report.ts'
import { useStill } from './still.ts'
import { dayKey, timeOf } from './time.ts'
import { TONE_FILL, TONE_NAME } from './Tone.tsx'

const DAYS = 7
/** More reports than this on one day show as a count above the column. */
const MOST_DOTS = 7

/** hobkin's face over the unread reports: the worst of them sets it. With nothing unread it dozes. */
const MOOD: Record<Tone, Mood> = { critical: 'surprised', blocked: 'confused', useful: 'happy', plain: 'idle', nothing: 'idle' }

const LEGEND: readonly Tone[] = ['critical', 'blocked', 'useful', 'plain', 'nothing']
const LEGEND_WORD: Record<Tone, string> = { critical: 'critical', blocked: 'blocked', useful: 'useful', plain: 'unmarked', nothing: 'nothing new' }

const TONE_RING: Record<Tone, string> = {
  critical: 'border-bad',
  blocked: 'border-warn',
  useful: 'border-ok',
  nothing: 'border-border-strong',
  plain: 'border-border-strong',
}

function headline({ unread, worst, worstCount }: Summary): string {
  if (unread === 0) return 'Everything is read'
  if (worst === 'critical' || worst === 'blocked') return unread === 1 ? `1 unread, and it is ${worst}` : `${unread} unread, ${worstCount} ${worst}`
  return unread === 1 ? '1 unread report' : `${unread} unread`
}

interface Column {
  key: string
  label: string
  today: boolean
  reports: Report[]
}

/** The last seven days, oldest first, each with its reports in the order they came. */
function week(list: readonly Report[], now: number): { columns: Column[]; earlier: number } {
  const columns: Column[] = []
  for (let back = DAYS - 1; back >= 0; back -= 1) {
    const day = new Date(now)
    day.setDate(day.getDate() - back)
    const label = back === 0 ? 'Today' : new Intl.DateTimeFormat('en', { weekday: 'short' }).format(day)
    columns.push({ key: dayKey(day.getTime()), label, today: back === 0, reports: [] })
  }
  const byKey = new Map(columns.map((column) => [column.key, column]))
  let earlier = 0
  for (const report of [...list].reverse()) {
    const at = timeOf(report.at)
    const column = at === null ? undefined : byKey.get(dayKey(at))
    if (column) column.reports.push(report)
    else earlier += 1
  }
  return { columns, earlier }
}

/** The overview's own stage. It drives its arrival and hands `center` on to the hero inside, after the screen has landed. */
const STAGE: Variants = {
  enter: {},
  center: { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)', transition: { delayChildren: staggerDelay } },
  leave: { opacity: 0, transform: 'scale(0.96)', filter: 'blur(6px)', transition: { duration: dur.base, ease: ease.out } },
}
const STILL_STAGE: Variants = {
  enter: {},
  center: { opacity: 1, transition: { delayChildren: staggerDelay } },
  leave: { opacity: 0, transition: tween.exit },
}

/** Each dot pops up from below, a column at a time, the way a new agent pops into its list. */
function dotVariants(still: boolean): Variants {
  return {
    enter: still ? { opacity: 0 } : { opacity: 0, transform: 'translateY(14px) scale(0.6)' },
    center: (order: number) => {
      const delay = order * (stagger / 3)
      return { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: { ...spring.alive, delay }, opacity: { ...tween.enter, delay } } }
    },
  }
}

/**
 * The week at a glance, beside the list while no report is open. Each dot is a report, colored by its tone,
 * filled until it is read, standing in the column of its day. hobkin stands at the end of the week, and its
 * face says how the unread ones look. A dot opens its report.
 */
export function Overview({
  list,
  read,
  now,
  onOpen,
  quiet = false,
}: {
  list: readonly Report[]
  read: ReadonlySet<string>
  now: number
  onOpen: (id: string, from: HTMLElement) => void
  /** It slides back in beside a report that closed, already in place, so nothing in it arrives a second time. */
  quiet?: boolean
}) {
  const still = useStill()
  const summary = useMemo(() => summarize(list, read), [list, read])
  const { columns, earlier } = useMemo(() => week(list, now), [list, now])
  const dots = useMemo(() => dotVariants(still), [still])
  let order = 0

  return (
    // It drives its own arrival with the screen. Sliding back in beside a report that closed, it is already in place.
    <motion.div
      className="pointer-events-auto absolute inset-0 @max-[800px]:hidden"
      variants={still ? STILL_STAGE : STAGE}
      initial={quiet ? false : 'enter'}
      animate="center"
    >
      <Hero className="h-full">
        <section aria-label="The week" className="flex h-full flex-col overflow-hidden rounded-[28px] bg-background p-7">
          <header>
            <h2 className="eyebrow">The last seven days</h2>
            <p className="mt-1 font-heading text-[26px] leading-tight font-semibold tracking-[-0.022em]">{headline(summary)}</p>
            <p className="mt-1.5 text-[13px] text-muted-foreground">Each dot is a report, in the column of its day. A filled dot is unread.</p>
          </header>

          <div className="flex min-h-0 flex-1 items-center py-6">
            <div className="flex w-full items-end gap-4">
              <div className="flex min-w-0 flex-1 items-end gap-1.5" role="list" aria-label="Reports by day">
                {columns.map((column) => (
                  <div key={column.key} role="listitem" className="flex min-w-0 flex-1 flex-col items-center gap-2.5">
                    {column.reports.length > MOST_DOTS ? (
                      <span className="text-[11px] text-muted-foreground tabular-nums">+{column.reports.length - MOST_DOTS}</span>
                    ) : null}
                    <div className="flex flex-col-reverse items-center gap-1.5">
                      {column.reports.slice(0, MOST_DOTS).map((report) => {
                        const tone = toneOf(report)
                        const unread = !read.has(report.id)
                        const words = `${report.title}, ${TONE_NAME[tone]}${unread ? ', unread' : ''}`
                        return (
                          <motion.button
                            key={report.id}
                            type="button"
                            tabIndex={-1}
                            custom={order++}
                            variants={dots}
                            title={words}
                            aria-label={words}
                            onClick={(event) => onOpen(report.id, event.currentTarget)}
                            className="group grid size-7 cursor-default place-items-center"
                          >
                            <span className={cn('relative size-[18px] rounded-full border-2 transition-transform duration-[160ms] ease-out group-hover:scale-125', TONE_RING[tone])}>
                              <span
                                className={cn(
                                  'absolute -inset-px rounded-full transition-[opacity,transform] duration-[220ms] ease-out',
                                  TONE_FILL[tone],
                                  unread ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
                                )}
                              />
                            </span>
                          </motion.button>
                        )
                      })}
                    </div>
                    <span className={cn('h-px w-full', column.today ? 'bg-border-strong' : 'bg-border')} aria-hidden="true" />
                    <span className={cn('text-[11px] font-medium', column.today ? 'text-foreground' : 'text-muted-foreground')}>{column.label}</span>
                  </div>
                ))}
              </div>
              {/* Standing on the line, at the end of the week. */}
              <Hob mood={summary.unread === 0 ? 'sleepy' : MOOD[summary.worst ?? 'plain']} size={76} className="mb-[22px] shrink-0" />
            </div>
          </div>

          <footer className="flex flex-col gap-1.5">
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground" aria-label="By tone">
              {LEGEND.filter((tone) => summary.tones[tone] > 0).map((tone) => (
                <li key={tone} className="flex items-center gap-1.5">
                  <span className={cn('size-2 rounded-full', TONE_FILL[tone])} aria-hidden="true" />
                  <span className="tabular-nums">
                    {summary.tones[tone]} {LEGEND_WORD[tone]}
                  </span>
                </li>
              ))}
            </ul>
            {earlier ? <p className="text-[12px] text-muted-foreground">{earlier === 1 ? 'One more is older than a week.' : `${earlier} more are older than a week.`}</p> : null}
          </footer>
        </section>
      </Hero>
    </motion.div>
  )
}
