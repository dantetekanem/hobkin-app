import { motion, type Variants } from 'motion/react'
import { Bot, ChevronRight, Inbox, PauseCircle } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Hero } from '@/app/Reveal.tsx'
import { useView } from '@/app/view-store.ts'
import { Hob } from '@/avatar/Hob.tsx'
import type { Mood } from '@/avatar/moods.tsx'
import { useActionItemCount, useAgents, useHasHost, useHost } from '@/lib/host/hooks.ts'
import { dur, ease, spring, stagger, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useActionCount } from '../actions/store.ts'
import { useRoutines } from '../routines/store.ts'
import { needsAttention, outcomeWeek, sinceLastLook, type OutcomeDay, type SourceAttention } from './briefing.ts'
import { summarize, type Summary } from './inbox.ts'
import { HomeIdeas } from './HomeIdeas.tsx'
import type { Report, Tone } from './report.ts'
import { useStill } from './still.ts'
import { clockTime, dayKey, dayLabel } from './time.ts'
import { TONE_NAME, ToneMark } from './Tone.tsx'

/** hobkin's face over the unread reports: the worst of them sets it. With nothing unread it dozes. */
const MOOD: Record<Tone, Mood> = { critical: 'surprised', blocked: 'confused', useful: 'happy', plain: 'idle', nothing: 'idle' }

/** How many sources and agents the briefing names before it says how many more. */
const MOST_SOURCES = 5
const MOST_AGENTS = 3
const BAR_PX = 72

function headline({ unread, worst, worstCount }: Summary): string {
  if (unread === 0) return 'Everything is read'
  if (worst === 'critical' || worst === 'blocked') return unread === 1 ? `1 unread, and it is ${worst}` : `${unread} unread, ${worstCount} ${worst}`
  return unread === 1 ? '1 unread report' : `${unread} unread`
}

const lastLookWords = (since: number, now: number) => {
  const day = dayLabel(since, now)
  return `${day === 'Today' ? '' : `${day === 'Yesterday' ? 'yesterday' : day} `}at ${clockTime(since)}`
}

function attentionWords({ unread, worst, worstCount }: SourceAttention): string {
  if (worst === 'plain') return `${unread} unread`
  const tone = `${worstCount} ${TONE_NAME[worst].toLowerCase()}`
  return unread === worstCount ? tone : `${unread} unread · ${tone}`
}

function dayWords(day: OutcomeDay): string {
  const parts = ([[day.completed, 'completed'], [day.failed, 'failed'], [day.stopped, 'stopped']] as const).filter(([count]) => count > 0)
  return `${day.label}: ${parts.length ? parts.map(([count, word]) => `${count} ${word}`).join(', ') : 'no runs'}`
}

/** The briefing's own stage. It arrives with the screen and hands `center` on to the hero inside at once. */
const STAGE: Variants = {
  enter: {},
  center: { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
  leave: { opacity: 0, transform: 'scale(0.96)', filter: 'blur(6px)', transition: { duration: dur.base, ease: ease.out } },
}
const STILL_STAGE: Variants = {
  enter: {},
  center: { opacity: 1 },
  leave: { opacity: 0, transition: tween.exit },
}

/** Each day's column pops up from below with the card, a step after the one before, the way a new agent pops into its list. */
function barVariants(still: boolean): Variants {
  return {
    enter: { opacity: 0, transform: still ? 'translateY(0px)' : 'translateY(12px)' },
    center: (index: number) => {
      const delay = still ? 0 : index * (stagger / 3)
      return { opacity: 1, transform: 'translateY(0px)', transition: { transform: still ? { duration: 0 } : { ...spring.alive, delay }, opacity: { ...tween.enter, delay } } }
    },
  }
}

/** A line that opens what it names, reachable by native Tab on Home too. */
function LinkRow({ lead, label, detail, onOpen }: { lead: ReactNode; label: string; detail: string; onOpen: (from: HTMLElement) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={(event) => onOpen(event.currentTarget)}
        className="group flex w-full cursor-default items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 hover:bg-surface-2/60"
      >
        <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">{lead}</span>
        {/* Side by side when there is room; on a narrow card the detail goes under the name, so neither is cut short. */}
        <span className="flex min-w-0 flex-1 flex-col @[26rem]:flex-row @[26rem]:items-baseline @[26rem]:gap-3">
          <span className="min-w-0 truncate text-[13.5px] font-medium @[26rem]:flex-1">{label}</span>
          <span className="min-w-0 truncate text-[12px] text-muted-foreground tabular-nums @[26rem]:max-w-[55%] @[26rem]:shrink-0">{detail}</span>
        </span>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </button>
    </li>
  )
}

function Block({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      {/* A fixed height, so a readout that comes and goes never moves what is below it. */}
      <header className="flex h-[18px] items-center justify-between gap-3 px-2.5">
        <h3 className="eyebrow shrink-0">{title}</h3>
        {aside === undefined ? null : <span className="truncate text-[12px] leading-[18px] text-muted-foreground tabular-nums">{aside}</span>}
      </header>
      {children}
    </section>
  )
}

/** How the last seven days' runs ended: a column a day, the runs that did not finish at its foot. A column opens its worst run. */
function RunsWeek({ days, still, onOpen }: { days: OutcomeDay[]; still: boolean; onOpen: (id: string, from: HTMLElement) => void }) {
  const [shown, setShown] = useState<OutcomeDay | null>(null)
  const bars = useMemo(() => barVariants(still), [still])
  const most = Math.max(1, ...days.map((day) => day.completed + day.failed + day.stopped))
  const height = (count: number) => (count === 0 ? 0 : Math.max(3, Math.round((count / most) * BAR_PX)))
  const completed = days.reduce((sum, day) => sum + day.completed, 0)
  const unfinished = days.reduce((sum, day) => sum + day.failed + day.stopped, 0)
  return (
    <Block title="Runs, last 7 days" aside={shown ? dayWords(shown) : ''}>
      <ul className="flex items-end gap-1.5 px-2.5" aria-label="Runs by day" onPointerLeave={() => setShown(null)}>
        {days.map((day, index) => {
          const notDone = day.failed + day.stopped
          return (
            <li key={day.key} className="min-w-0 flex-1">
              <motion.button
                type="button"
                custom={index}
                variants={bars}
                aria-label={dayWords(day)}
                disabled={!day.openId}
                onPointerEnter={() => setShown(day)}
                onClick={(event) => day.openId && onOpen(day.openId, event.currentTarget)}
                className="group flex w-full cursor-default flex-col items-center gap-2"
              >
                {/* Hover changes only color: nothing here moves or changes size. */}
                <span className="flex w-full flex-col items-center justify-end gap-[2px] border-b border-border" style={{ height: BAR_PX + 1 }}>
                  {day.completed ? <span className="w-full max-w-6 rounded-t-[4px] bg-border-strong group-hover:bg-muted-foreground" style={{ height: height(day.completed) }} /> : null}
                  {notDone ? <span className={cn('w-full max-w-6 bg-bad-fg group-hover:bg-bad', !day.completed && 'rounded-t-[4px]')} style={{ height: height(notDone) }} /> : null}
                </span>
                <span className={cn('text-[11px] font-medium', day.today ? 'text-foreground' : 'text-muted-foreground')}>{day.label}</span>
              </motion.button>
            </li>
          )
        })}
      </ul>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 px-2.5 text-[12px] text-muted-foreground tabular-nums" aria-label="Runs by outcome">
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-border-strong" aria-hidden="true" />
          {completed} completed
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-bad-fg" aria-hidden="true" />
          {unfinished} failed or stopped
        </li>
      </ul>
    </Block>
  )
}

/**
 * The Reports home, beside the list while no report is open: what needs the user, what came since they last looked,
 * how the week's runs ended, and what is going on now. Every line opens what it names. hobkin's face says how the
 * unread reports look.
 */
export function Overview({
  list,
  read,
  now,
  onOpen,
  quiet = false,
  standalone = false,
}: {
  list: readonly Report[]
  read: ReadonlySet<string>
  now: number
  onOpen: (id: string, from: HTMLElement) => void
  /** It slides back in beside a report that closed, already in place, so nothing in it arrives a second time. */
  quiet?: boolean
  /** Home owns the outer scroller; Reports keeps its two-pane positioning. */
  standalone?: boolean
}) {
  const still = useStill()
  const attention = useHost((state) => state.snapshot.reportAttention)
  const facts = useRoutines((state) => state.prepared.facts)
  const agents = useAgents()
  // As the menu's badge counts them: hobkin's own count, or the sample's rows.
  const hostItems = useActionItemCount()
  const sampleItems = useActionCount()
  const actionItems = useHasHost() ? hostItems : sampleItems
  const today = dayKey(now)
  const summary = useMemo(() => summarize(list, read), [list, read])
  const sources = useMemo(() => needsAttention(list, read), [list, read])
  const fresh = useMemo(() => sinceLastLook(list, read, attention), [list, read, attention])
  // The week changes with the day, not with each drawing.
  const days = useMemo(() => outcomeWeek(list, now), [list, today])
  const held = useMemo(() => facts.filter((fact) => fact.state === 'held' && fact.hold), [facts])
  const { openScreen, openAgentCanvas } = useView.getState()

  return (
    // It drives its own arrival with the screen. Sliding back in beside a report that closed, it is already in place.
    <motion.div
      className={standalone ? 'pointer-events-auto' : 'pointer-events-auto absolute inset-0 @max-[800px]:hidden'}
      variants={still ? STILL_STAGE : STAGE}
      initial={quiet ? false : 'enter'}
      animate="center"
    >
      <Hero className={standalone ? undefined : 'h-full'}>
        <section aria-label="Briefing" className={cn('@container flex flex-col gap-6 rounded-[28px] bg-background p-7 pt-6', !standalone && 'scroll-quiet h-full overflow-y-auto')}>
          <HomeIdeas list={list} read={read} now={now} onOpen={onOpen} />
          <header className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="eyebrow">Briefing</h2>
              <p className="mt-1 font-heading text-[26px] leading-tight font-semibold tracking-[-0.022em]">{headline(summary)}</p>
              {fresh?.count && fresh.openId ? (
                <button
                  type="button"
                  onClick={(event) => onOpen(fresh.openId!, event.currentTarget)}
                  className="group mt-1.5 flex max-w-full cursor-default items-center gap-1.5 text-left text-[13px] text-muted-foreground hover:text-foreground"
                >
                  <ToneMark tone={fresh.worst ?? 'plain'} unread />
                  <span className="min-w-0">
                    {fresh.count} new since you last looked {lastLookWords(fresh.since, now)}
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                </button>
              ) : fresh ? (
                <p className="mt-1.5 text-[13px] text-muted-foreground">Nothing new since you last looked {lastLookWords(fresh.since, now)}.</p>
              ) : null}
            </div>
            <Hob mood={summary.unread === 0 ? 'sleepy' : MOOD[summary.worst ?? 'plain']} size={56} className="shrink-0" />
          </header>

          <Block title="Needs attention" aside={sources.length > MOST_SOURCES ? `${sources.length - MOST_SOURCES} more` : undefined}>
            {sources.length ? (
              <ul className="-my-0.5 flex flex-col">
                {sources.slice(0, MOST_SOURCES).map((source) => (
                  <LinkRow
                    key={source.key}
                    lead={<ToneMark tone={source.worst} unread />}
                    label={source.label}
                    detail={attentionWords(source)}
                    onOpen={(from) => onOpen(source.openId, from)}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-2.5 text-[13px] text-muted-foreground">Nothing unread needs you.</p>
            )}
          </Block>

          <RunsWeek days={days} still={still} onOpen={onOpen} />

          <Block title="Now">
            <ul className="-my-0.5 flex flex-col">
              <LinkRow
                lead={<Inbox className="size-4" />}
                label="Action Items"
                detail={actionItems === 0 ? 'nothing waiting' : `${actionItems} waiting`}
                onOpen={() => openScreen('actions')}
              />
              {agents.slice(0, MOST_AGENTS).map((agent) => (
                <LinkRow key={agent.id} lead={<Bot className="size-4" />} label={agent.title} detail={agent.doing} onOpen={() => openAgentCanvas(agent.id)} />
              ))}
              {held.map(({ routine, hold }) => (
                <LinkRow
                  key={routine.id}
                  lead={<PauseCircle className="size-4" />}
                  label={routine.title}
                  detail={`held: ${hold!.reason}`}
                  onOpen={() => {
                    useRoutines.getState().open(routine.id, `routine-${routine.id}`)
                    openScreen('routines')
                  }}
                />
              ))}
            </ul>
            {agents.length === 0 || agents.length > MOST_AGENTS ? (
              <p className="px-2.5 text-[12px] text-muted-foreground">
                {agents.length === 0 ? 'No agents are running.' : `${agents.length - MOST_AGENTS} more agents running.`}
              </p>
            ) : null}
          </Block>
        </section>
      </Hero>
    </motion.div>
  )
}
