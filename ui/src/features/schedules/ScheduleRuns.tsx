import { CalendarClock, ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { AgentScheduleRunRecord } from '#shared/protocol/schedules.ts'
import { useArrival } from '@/features/agent-activity/arrive.ts'
import { BOX } from '@/features/agent-activity/boxes.ts'
import { Stamped } from '@/features/agent-activity/Stamp.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { clockSeconds } from '@/features/reports/time.ts'
import { cn } from '@/lib/utils.ts'
import { foldWords, runWords, type RunSchedule, type RunsRow, type RunTone } from './runs.ts'

/**
 * A schedule's runs in its agent's conversation (`runs.ts`): one quiet row, not a message from anyone, at the moment
 * the run ended. One run says what ran, how it ended, how long it took and whether it woke the agent, and opens to the
 * last lines it printed, as a command step opens. Runs in a row that ended the same way are one row that counts them
 * and opens to the list, each of which opens to its own lines.
 */

const TONE: Record<RunTone, string> = { ok: 'text-ok-fg', bad: 'text-bad-fg', quiet: '' }

/** The row's look, as a step's folded row: its icon on the steps' line, and its hover out into their inset. */
const ROW = '-mx-2.5 flex w-[calc(100%+1.25rem)] min-w-0 items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] text-muted-foreground'

/** A row of the conversation for runs, on an agent's page: in the times' column at its newest run. */
export function ScheduleRunsItem({ row }: { row: RunsRow }) {
  const arrival = useArrival()
  return (
    <li
      data-step="schedule"
      tabIndex={-1}
      className={cn('w-full min-w-0 rounded-[18px] px-2.5 text-left outline-none [contain-intrinsic-size:auto_36px] [content-visibility:auto] focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]', arrival)}
    >
      <Stamped at={row.at} line="row">
        <ScheduleRuns row={row} />
      </Stamped>
    </li>
  )
}

/** One run or a fold of them, and what it opens to. `aside` stands at the row's end, such as its time in the main chat. */
export function ScheduleRuns({ row, aside }: { row: RunsRow; aside?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [only] = row.runs
  const one = row.runs.length === 1 ? only! : null
  // A plain wake prints nothing, so it has nothing to open.
  const opens = !one || hasOutput(row.schedule, one)
  const words = (
    <>
      <span className="shrink-0 font-medium text-foreground/80">{one ? runWords(row.schedule, one).name : foldWords(row, Date.now()).name}</span>
      {one ? <OneRun schedule={row.schedule} run={one} /> : <Folded row={row} />}
    </>
  )
  return (
    <div className="flex min-w-0 flex-col">
      <Line open={opens ? open : null} onToggle={() => setOpen(!open)} aside={aside}>
        {words}
      </Line>
      {open && opens ? one ? <Output schedule={row.schedule} run={one} /> : <RunList schedule={row.schedule} runs={row.runs} /> : null}
    </div>
  )
}

const hasOutput = (schedule: RunSchedule, run: AgentScheduleRunRecord) => schedule.does === 'shell' || Boolean(run.tail || run.line)

/** The row itself: a press when it opens, `open` null when there is nothing to open. A run in an opened list has no icon of its own. */
function Line({ open, onToggle, aside, icon = true, children }: { open: boolean | null; onToggle: () => void; aside?: ReactNode; icon?: boolean; children: ReactNode }) {
  const content = (
    <>
      {icon ? <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" /> : null}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">{children}</span>
      {aside}
      {open === null ? null : <ChevronRight className={cn('size-3.5 shrink-0 transition-transform duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]', open && 'rotate-90')} aria-hidden="true" />}
    </>
  )
  if (open === null) return <div className={ROW}>{content}</div>
  return (
    <button type="button" data-step-toggle aria-expanded={open} onClick={onToggle} className={cn(ROW, 'transition-colors duration-[160ms] ease-[ease] hover:bg-tone-1')}>
      {content}
    </button>
  )
}

const Dot = () => <span aria-hidden="true">·</span>

/** One run's words after its name: what ran, how it ended, how long, and whether it woke the agent. */
function OneRun({ schedule, run }: { schedule: RunSchedule; run: AgentScheduleRunRecord }) {
  const words = runWords(schedule, run)
  return (
    <>
      {words.ran ? <span className="min-w-0 truncate font-mono text-[12px]">{words.ran}</span> : null}
      <span className={cn('shrink-0 tabular-nums', TONE[words.tone])}>{words.end}</span>
      {words.took ? (
        <>
          <Dot />
          <span className="shrink-0 tabular-nums">{words.took}</span>
        </>
      ) : null}
      {words.wake ? (
        <>
          <Dot />
          <span className="shrink-0">{words.wake}</span>
        </>
      ) : null}
    </>
  )
}

/** A fold's words after its name: how many ran, how they all ended, and how long ago the last one did, kept current. */
function Folded({ row }: { row: RunsRow }) {
  const now = useNow(true, 30000)
  const words = foldWords(row, now)
  return (
    <>
      <span className="shrink-0 tabular-nums">{words.count}</span>
      <Dot />
      <span className={cn('shrink-0', TONE[words.tone])}>{words.all}</span>
      <Dot />
      <span className="shrink-0 tabular-nums">{words.last}</span>
      {words.wake ? (
        <>
          <Dot />
          <span className="shrink-0">{words.wake}</span>
        </>
      ) : null}
    </>
  )
}

/** A fold opened: each run on its line, oldest first, with when it ended, and each opens to its own lines. */
function RunList({ schedule, runs }: { schedule: RunSchedule; runs: readonly AgentScheduleRunRecord[] }) {
  return (
    <ul className="flex flex-col pl-[22px]">
      {runs.map((run) => (
        <li key={run.at} className="min-w-0">
          <ListedRun schedule={schedule} run={run} />
        </li>
      ))}
    </ul>
  )
}

function ListedRun({ schedule, run }: { schedule: RunSchedule; run: AgentScheduleRunRecord }) {
  const [open, setOpen] = useState(false)
  const words = runWords(schedule, run)
  const opens = hasOutput(schedule, run)
  const at = Date.parse(run.at)
  return (
    <div className="flex min-w-0 flex-col">
      <Line open={opens ? open : null} onToggle={() => setOpen(!open)} icon={false}>
        <time dateTime={run.at} className="shrink-0 tabular-nums">
          {Number.isFinite(at) ? clockSeconds(at) : ''}
        </time>
        <span className={cn('shrink-0 tabular-nums', TONE[words.tone])}>{words.end}</span>
        {words.took ? (
          <>
            <Dot />
            <span className="shrink-0 tabular-nums">{words.took}</span>
          </>
        ) : null}
        {words.wake ? (
          <>
            <Dot />
            <span className="shrink-0">{words.wake}</span>
          </>
        ) : null}
      </Line>
      {open && opens ? <Output schedule={schedule} run={run} /> : null}
    </div>
  )
}

/** What a run printed last, in a card as a command's: its command, then its last lines, or why there are none. */
function Output({ schedule, run }: { schedule: RunSchedule; run: AgentScheduleRunRecord }) {
  const said = run.tail?.trimEnd() || run.line || null
  return (
    <div className="mt-0.5 mb-1 min-w-0 rounded-2xl bg-code-bg px-3.5 py-2 text-code-text shadow-[inset_0_0_0_1px_var(--hb-border)]">
      {schedule.command ? (
        <p className="flex min-w-0 gap-2 font-mono text-[13px] leading-[1.7]">
          <span className="opacity-50" aria-hidden="true">
            $
          </span>
          <code className="min-w-0 flex-1 break-words whitespace-pre-wrap">{schedule.command}</code>
        </p>
      ) : null}
      {said ? (
        <div {...{ [BOX]: '' }} className="aa-box scroll-quiet mt-1">
          <pre className="font-mono text-[12px] leading-[1.6] [overflow-wrap:anywhere] whitespace-pre-wrap opacity-75">{said}</pre>
        </div>
      ) : (
        <p className="mt-1 text-[12px] opacity-60">It printed nothing.</p>
      )}
    </div>
  )
}
