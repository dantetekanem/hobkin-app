import { Play } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useClock } from './hooks.ts'
import { chipMotion, groupVariants, rowMotion } from './look.ts'
import { RoutineHood, StateChip } from './parts.tsx'
import { byNextRun, type RoutineFacts } from './rules.ts'
import type { TimelineDay, TimelineEntry } from './timeline.ts'
import { RECURRENCES } from './types.ts'
import { clockText, dateLabel, dayName, dayWord, elapsedText, everyText, holdEnds, howOften, RECURRENCE_TITLE, stateSentence, untilText, zoneText } from './words.ts'

/**
 * The two lists under the sky: every routine grouped by how often it runs, and the next seven days in
 * time order. Each row is one stop for the keyboard. Enter or Right opens the routine, and the detail grows
 * out of the row that was chosen.
 */

export interface ListActions {
  readOnly?: boolean
  /** Opens a routine's detail from the element with this layout id. */
  onOpen: (id: string, from: string) => void
  onRun: (id: string) => void
  onEnable: (id: string, enabled: boolean) => void
  onLight: (id: string | null) => void
}

interface ListProps extends ListActions {
  facts: RoutineFacts[]
  now: number
  zone: string
  /** False while the detail is open: the rows behind it are not walked. */
  walkable: boolean
  /** The layout id the open detail grew from. That row gives its shape to the detail while it is open. */
  openFrom: string | null
}

type RowProps = Omit<ListProps, 'facts'> & { facts: RoutineFacts }

export function AllRoutines({ facts, now, zone, walkable, openFrom, ...actions }: ListProps) {
  return RECURRENCES.map((recurrence) => {
    const group = facts.filter((item) => item.routine.cadence === recurrence).toSorted(byNextRun)
    if (group.length === 0) return null

    return (
      <motion.section key={recurrence} variants={groupVariants} aria-label={RECURRENCE_TITLE[recurrence]} className="flex flex-col gap-1.5">
        <h3 className="eyebrow px-1 pt-2">
          {RECURRENCE_TITLE[recurrence]} <span className="ml-1 tabular-nums">{group.length}</span>
        </h3>
        <ul className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {group.map((item) => (
              <RoutineRow key={item.routine.id} facts={item} now={now} zone={zone} walkable={walkable} openFrom={openFrom} {...actions} />
            ))}
          </AnimatePresence>
        </ul>
      </motion.section>
    )
  })
}

/** The shape a row shares with the detail. While the detail is open it is the detail's, and the row keeps an empty place. */
function Shape({ layoutId, taken }: { layoutId: string; taken: boolean }) {
  if (taken) return null
  return <motion.div layoutId={layoutId} className="absolute inset-0 bg-background" style={{ borderRadius: 16 }} transition={spring.screen} />
}

interface RowButtonProps {
  routineId: string
  /** The row's layout id. The keyboard comes back to it when the detail closes. */
  anchor: string
  label: string
  walkable: boolean
  onOpen: () => void
  onLight: (id: string | null) => void
}

/** A row's whole area opens its routine. Its own controls sit over it and keep their clicks. */
function RowButton({ routineId, anchor, label, walkable, onOpen, onLight }: RowButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-stop={walkable ? '' : undefined}
      data-anchor={anchor}
      tabIndex={walkable ? 0 : -1}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'ArrowRight') return
        event.preventDefault()
        onOpen()
      }}
      onFocus={() => onLight(routineId)}
      onBlur={() => onLight(null)}
      onPointerEnter={() => onLight(routineId)}
      onPointerLeave={() => onLight(null)}
      className={cn(
        'absolute inset-0 cursor-pointer rounded-2xl outline-none',
        'transition-[background-color,box-shadow] duration-[160ms] ease-[ease] hover:bg-tone-1',
        'focus:bg-surface-2 focus:[box-shadow:inset_0_0_0_1.5px_var(--hb-focus)]',
      )}
    />
  )
}

function RoutineRow({ facts, now, zone, walkable, openFrom, readOnly = false, onOpen, onRun, onEnable, onLight }: RowProps) {
  const { routine, state, hold } = facts
  const layoutId = `routine-${routine.id}`
  const taken = openFrom === layoutId && !walkable
  const otherZone = routine.timezone !== zone

  return (
    <motion.li layout="position" {...rowMotion} className="relative">
      <Shape layoutId={layoutId} taken={taken} />
      <RowButton
        routineId={routine.id}
        anchor={layoutId}
        label={`${routine.title}. ${howOften(routine)}. ${stateSentence(facts, now, zone)}`}
        walkable={walkable}
        onOpen={() => onOpen(routine.id, layoutId)}
        onLight={onLight}
      />
      <div className={cn('pointer-events-none relative flex min-h-[64px] items-center gap-3 py-2.5 pr-3 pl-2 transition-opacity duration-[160ms]', taken && 'opacity-0')}>
        <RoutineHood id={routine.id} state={state} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-[15px] leading-snug font-semibold tracking-[-0.015em]">{routine.title}</p>
          <p className="truncate text-[12.5px] text-muted-foreground">
            {howOften(routine)}
            {otherZone ? `, ${zoneText(routine.timezone, now)}` : ''}
          </p>
          {hold ? <p className="truncate text-[12.5px] text-warn-fg">{hold.reason}</p> : null}
        </div>
        <NextRun facts={facts} now={now} zone={zone} />
        <div className="pointer-events-auto flex shrink-0 items-center gap-2 pl-1">
          <Button
            variant="ghost"
            size="icon-sm"
            tabIndex={-1}
            aria-label={`Run ${routine.title} now`}
            title="Run now"
            disabled={readOnly || state === 'running'}
            onClick={() => onRun(routine.id)}
          >
            <Play className="size-3.5" aria-hidden="true" />
          </Button>
          <Switch
            size="sm"
            tabIndex={-1}
            checked={routine.enabled}
            disabled={readOnly}
            onCheckedChange={(enabled) => onEnable(routine.id, enabled)}
            aria-label={routine.enabled ? `Turn ${routine.title} off` : `Turn ${routine.title} on`}
            title={routine.enabled ? 'On' : 'Off'}
          />
        </div>
      </div>
    </motion.li>
  )
}

/** The right side of a row: when it runs next, or why it does not. A change of state pops the new one in. */
function NextRun({ facts, now, zone }: { facts: RoutineFacts; now: number; zone: string }) {
  return (
    <div className="flex w-[11.5rem] shrink-0 flex-col items-end gap-0.5 text-right @max-[640px]:w-[8.5rem]">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={facts.state} className="flex flex-col items-end gap-0.5" {...chipMotion}>
          <NextRunText facts={facts} now={now} zone={zone} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function NextRunText({ facts, now, zone }: { facts: RoutineFacts; now: number; zone: string }) {
  const { routine, state, hold, next, running } = facts
  const own = routine.timezone

  if (state === 'running') {
    return (
      <>
        <StateChip state="running" />
        {running ? <Elapsed since={running.startedAt} /> : null}
      </>
    )
  }
  if (state === 'off') {
    return (
      <>
        <StateChip state="off" />
        <span className="text-[12px] text-muted-foreground">Runs only by hand</span>
      </>
    )
  }
  if (state === 'held' && hold) {
    const ends = holdEnds(hold.until)
    return (
      <>
        <StateChip state="held" />
        <span className="text-[12px] text-warn-fg">
          until {dayWord(ends, own, now)} {clockText(ends, own)}
        </span>
      </>
    )
  }
  if (!next) {
    const forecast = routine.nextRun
    const label = forecast ? `${forecast.state}${forecast.reason ? `: ${forecast.reason}` : ''}` : 'Nothing left to run'
    return <span className="text-[12px] text-muted-foreground">{label}</span>
  }

  // In another timezone the day is named where the user is, beside the time here, so "today" never means two days.
  return (
    <>
      <span className="font-heading text-[17px] leading-none font-semibold tracking-[-0.02em] tabular-nums">{clockText(next.at, own)}</span>
      <span className="text-[12px] text-muted-foreground">
        {own === zone ? dayWord(next.at, own, now) : zoneText(own, next.at)}, {untilText(next.at, now)}
      </span>
      {own === zone ? null : (
        <span className="text-[11px] text-muted-foreground">
          {dayWord(next.at, zone, now)} {clockText(next.at, zone)} here
        </span>
      )}
    </>
  )
}

/** A clock that counts up while a run goes on. */
export function Elapsed({ since, className }: { since: number; className?: string }) {
  const now = useClock(1000)
  return <span className={cn('font-heading text-[13px] font-semibold text-ok-fg tabular-nums', className)}>{elapsedText(now - since)}</span>
}

interface WeekProps extends ListProps {
  days: TimelineDay[]
}

/** The first line of each held routine in the week: its first run after the hold. */
function firstRunsAfterHold(facts: RoutineFacts[], days: TimelineDay[]): Set<string> {
  const entries = days.flatMap((day) => day.entries)
  const keys = new Set<string>()
  for (const item of facts) {
    if (!item.hold) continue
    const first = entries.find((entry) => entry.routineId === item.routine.id)
    if (first) keys.add(first.key)
  }
  return keys
}

/** "Today", "Tomorrow", then the day's name. */
function dayTitle(index: number, day: TimelineDay, zone: string, now: number): string {
  if (index === 0) return 'Today'
  if (index === 1) return 'Tomorrow'
  return dayName(day.start, zone, now)
}

/** The next seven days, each with what runs on it, in time order. */
export function NextSevenDays({ days, facts, now, zone, walkable, openFrom, ...actions }: WeekProps) {
  const byId = new Map(facts.map((item) => [item.routine.id, item]))
  const running = facts.filter((item) => item.state === 'running')
  const off = facts.filter((item) => item.state === 'off')
  const afterHold = firstRunsAfterHold(facts, days)

  return (
    <>
      {days.map((day, index) => (
        <motion.section key={day.date} variants={groupVariants} aria-label={dayName(day.start, zone, now)} className="flex flex-col gap-1.5">
          <h3 className="eyebrow flex items-baseline gap-2 px-1 pt-2">
            <span>{dayTitle(index, day, zone, now)}</span>
            <span className="font-medium tracking-[0.04em] normal-case">{dateLabel(day.start, zone)}</span>
          </h3>
          <ul className="flex flex-col gap-1.5">
            {index === 0 ? <NowLine running={running} now={now} zone={zone} /> : null}
            <AnimatePresence initial={false}>
              {day.entries.map((entry) => {
                const item = byId.get(entry.routineId)
                if (!item) return null
                return (
                  <EntryRow
                    key={entry.key}
                    entry={entry}
                    facts={item}
                    now={now}
                    zone={zone}
                    walkable={walkable}
                    openFrom={openFrom}
                    afterHold={afterHold.has(entry.key)}
                    {...actions}
                  />
                )
              })}
            </AnimatePresence>
            {day.entries.length === 0 ? <li className="px-3 py-2 text-[13px] text-muted-foreground">{index === 0 ? 'Nothing more runs today.' : 'Nothing runs.'}</li> : null}
          </ul>
        </motion.section>
      ))}
      {off.length ? (
        <motion.p variants={groupVariants} className="px-1 pt-1 text-[13px] text-muted-foreground">
          Off, so not in the week: {off.map((item) => item.routine.title).join(', ')}.
        </motion.p>
      ) : null}
    </>
  )
}

/** The top of today: the time now, and what is running at it. */
function NowLine({ running, now, zone }: { running: RoutineFacts[]; now: number; zone: string }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl px-3 py-2">
      <span className="w-[4.25rem] shrink-0 font-heading text-[13px] font-semibold tabular-nums">Now {clockText(now, zone)}</span>
      <span className="h-px flex-1 border-t border-dashed border-foreground/30" aria-hidden="true" />
      <AnimatePresence mode="popLayout" initial={false}>
        {running.map((item) => (
          <motion.span key={item.routine.id} layout="position" {...chipMotion} className="flex items-center gap-1.5 text-[12.5px]">
            <RoutineHood id={item.routine.id} state="running" size={18} />
            <span className="font-medium">{item.routine.title}</span>
            {item.running ? <Elapsed since={item.running.startedAt} className="text-[12.5px]" /> : null}
          </motion.span>
        ))}
      </AnimatePresence>
    </li>
  )
}

/** What a screen reader hears for a line of the week: the time here first, then the routine's own. */
function entryLabel(entry: TimelineEntry, facts: RoutineFacts, now: number, zone: string): string {
  const { routine } = facts
  const own = routine.timezone
  const parts = [`${routine.title}, ${dayWord(entry.at, zone, now)} at ${clockText(entry.at, zone)}`]
  if (own !== zone) parts.push(`here, ${clockText(entry.at, own)} ${zoneText(own, entry.at)}`)
  if (entry.window) parts.push(`a window to ${entry.window.end}`)
  return `${parts.join(', ')}.`
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** "10 checks", or "4 checks left" once the window has started. */
const checksText = (count: number, started: boolean) => `${count} ${count === 1 ? 'check' : 'checks'}${started ? ' left' : ''}`

function EntryRow({ entry, facts, now, zone, walkable, openFrom, afterHold, onOpen, onLight }: RowProps & { entry: TimelineEntry; afterHold: boolean }) {
  const { routine, state } = facts
  const layoutId = `entry-${entry.key}`
  const taken = openFrom === layoutId && !walkable
  const own = routine.timezone
  const window = entry.window
  // The week is laid out in the user's days, so its column of times is the time here. A routine from
  // another timezone says its own time beside it.
  const local = own === zone
  const windowStarted = window !== undefined && entry.time !== window.start

  const description = window ? `${capitalised(everyText(window.everyMinutes))}, ${checksText(window.checks.length, windowStarted)}` : howOften(routine)
  const ownWindow = window && !local ? `, from ${window.start} to ${window.end}` : ''
  const ownZone = local ? '' : `, ${zoneText(own, entry.at)}`

  return (
    <motion.li layout="position" {...rowMotion} className="relative">
      <Shape layoutId={layoutId} taken={taken} />
      <RowButton
        routineId={routine.id}
        anchor={layoutId}
        label={entryLabel(entry, facts, now, zone)}
        walkable={walkable}
        onOpen={() => onOpen(routine.id, layoutId)}
        onLight={onLight}
      />
      <div className={cn('pointer-events-none relative flex min-h-[56px] items-center gap-3 py-2 pr-4 pl-3 transition-opacity duration-[160ms]', taken && 'opacity-0')}>
        <div className="flex w-[4.25rem] shrink-0 flex-col">
          <span className="font-heading text-[17px] leading-none font-semibold tracking-[-0.02em] tabular-nums">{window && local ? window.start : clockText(entry.at, zone)}</span>
          {window && local ? <span className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">to {window.end}</span> : null}
          {local ? null : <span className="mt-0.5 text-[11px] text-muted-foreground">here</span>}
        </div>
        <RoutineHood id={routine.id} state={state} size={22} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-[14.5px] leading-snug font-semibold tracking-[-0.015em]">{routine.title}</p>
          <p className="truncate text-[12.5px] text-muted-foreground">
            {description}
            {ownWindow}
            {ownZone}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          {afterHold ? <StateChip state="held" className="bg-warn/14" /> : null}
          <span className="text-[12px] text-muted-foreground">
            {windowStarted ? `next check ${clockText(entry.at, own)}, ` : ''}
            {untilText(entry.at, now)}
          </span>
          {afterHold ? <span className="text-[11px] text-warn-fg">first run after its hold</span> : null}
        </div>
      </div>
    </motion.li>
  )
}
