import { Check as CheckIcon, Clock, Code, OctagonX, TriangleAlert, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { holdStill, useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { ProofRun } from '#shared/protocol/proofs.ts'
import { specFile } from '../proof-match.ts'
import '../proofs.css'
import {
  actionRows,
  CHART,
  chartOf,
  codeRows,
  countersOf,
  coverageNote,
  elapsedLine,
  LOG_LINES,
  logRows,
  resultOf,
  ruleRows,
  stepRows,
  type ResultIcon,
  type StepLook,
  type Tone,
} from './run-view.ts'

/** The tabs the result's two buttons go to. */
export type ProofTab = 'run' | 'graph' | 'math'

export interface RunViewProps {
  run: ProofRun
  now: number
  zone: string
  /** Goes to another tab. Null while that tab is not in this build. */
  onTab: ((tab: Exclude<ProofTab, 'run'>) => void) | null
  /** Opens an action's code, `path:line` in the project. Null while the project's folder is not known here. */
  onCode: ((where: string) => void) | null
}

const CARD = 'rounded-[20px] border border-border bg-surface'
/** One log line's room: its text on two lines and its detail on one. */
const LOG_ROW = 52

/**
 * The Run tab of a proof run (050-tla-proofs, screen 1): the check with its steps, TLC's counters and how fast new
 * states come in; what it found, in an area of one height whose buttons never move; what must stay true and which
 * actions ran; and beside them what hobkin is doing and where each action lives in the code.
 */
export function RunView({ run, now, zone, onTab, onCode }: RunViewProps) {
  return (
    <div className="grid grid-cols-1 gap-5 @min-[880px]:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Check run={run} now={now} />
        <ResultArea run={run} onTab={onTab} />
        <div className="grid grid-cols-1 gap-4 @min-[680px]:grid-cols-2">
          <Rules run={run} />
          <Actions run={run} />
        </div>
      </div>
      <aside className="flex min-w-0 flex-col gap-4">
        <Doing run={run} zone={zone} />
        <CodeMap run={run} onCode={onCode} />
      </aside>
    </div>
  )
}

const STEP_LOOK: Readonly<Record<StepLook, { box: string; dot: string; mark: string }>> = {
  done: { box: 'border-border bg-tone-2', dot: 'bg-ok-fg text-background', mark: '✓' },
  running: { box: 'border-sun bg-sun/20', dot: 'pf-pulse bg-sun text-primary-foreground', mark: '•' },
  waiting: { box: 'border-border bg-transparent', dot: 'bg-tone-1 text-muted-foreground', mark: '' },
  failed: { box: 'border-bad-fg bg-bad/15', dot: 'bg-bad-fg text-background', mark: '!' },
}

const STROKE: Readonly<Record<Tone, string>> = { live: 'stroke-foreground', ok: 'stroke-ok-fg', bad: 'stroke-bad-fg', warn: 'stroke-warn-fg', quiet: 'stroke-muted-foreground' }
const WASH: Readonly<Record<Tone, string>> = { live: 'fill-sun/20', ok: 'fill-ok/15', bad: 'fill-bad/15', warn: 'fill-warn/15', quiet: 'fill-tone-1' }

/** The spec and its model, the three steps, the four counters and the chart of new states. */
function Check({ run, now }: { run: ProofRun; now: number }) {
  const still = useStill()
  const chart = chartOf(run)
  const tween_ = still ? { duration: 0 } : { duration: 0.6, ease: [0.23, 1, 0.32, 1] as const }
  return (
    <section aria-label="The check" className={cn(CARD, 'flex flex-col gap-[18px] px-[22px] py-5')}>
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
        <h2 className="font-mono text-[15px] font-medium">{specFile(run.spec)}</h2>
        <span className="text-[13px] text-muted-foreground">{[run.model && `Model: ${run.model}`, run.workers ? `${run.workers} ${run.workers === 1 ? 'worker' : 'workers'}` : null].filter(Boolean).join(' · ')}</span>
        <span className="ml-auto font-mono text-[12.5px] text-muted-foreground tabular-nums">{elapsedLine(run, now)}</span>
      </div>

      <ol aria-label="Steps" className="grid grid-cols-3 gap-2">
        {stepRows(run).map((step) => {
          const look = STEP_LOOK[step.look]
          return (
            <li key={step.id} className={cn('flex min-h-[62px] flex-col gap-1.5 rounded-[14px] border px-3 py-2.5', look.box)}>
              <span className="flex items-center gap-2 text-[13px] font-semibold">
                <span aria-hidden="true" className={cn('grid size-[18px] shrink-0 place-items-center rounded-full text-[11px] font-bold', look.dot)}>
                  {look.mark}
                </span>
                {step.name}
                <span className="sr-only">: {step.look}</span>
              </span>
              <span title={step.note} className="line-clamp-1 text-[12px] text-muted-foreground">
                {step.note}
              </span>
            </li>
          )
        })}
      </ol>

      <div className="grid grid-cols-2 gap-3 @min-[560px]:grid-cols-4">
        {countersOf(run).map((counter) => (
          <div key={counter.label} className="flex flex-col gap-1 rounded-[14px] border border-border bg-tone-2 px-3.5 py-3">
            <span className="text-[12px] text-muted-foreground">{counter.label}</span>
            <span className="font-heading text-[28px] leading-[1.1] font-light tracking-[-0.02em] tabular-nums">{counter.value}</span>
            <span className="line-clamp-1 text-[11.5px] text-muted-foreground">{counter.sub}</span>
          </div>
        ))}
      </div>

      <figure className="flex flex-col gap-1.5">
        <figcaption className="flex justify-between text-[12px] text-muted-foreground">
          <span>New states found over time</span>
          <span className="tabular-nums">{chart.caption}</span>
        </figcaption>
        <svg role="img" aria-label={chart.aria} viewBox={`0 0 ${CHART.width} ${CHART.height}`} preserveAspectRatio="none" className="block h-[110px] w-full">
          <path d={`M0 ${CHART.floor} H${CHART.width}`} className="fill-none stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <motion.path initial={false} animate={{ d: chart.area }} transition={tween_} className={cn('stroke-none', WASH[chart.tone])} />
          <motion.path initial={false} animate={{ d: chart.line }} transition={tween_} className={cn('fill-none', STROKE[chart.tone])} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </figure>
    </section>
  )
}

const RESULT_LOOK: Readonly<Record<Tone, { box: string; icon: string }>> = {
  quiet: { box: 'border-border bg-surface', icon: 'bg-sun/20 text-foreground' },
  live: { box: 'border-border bg-surface', icon: 'bg-sun/20 text-foreground' },
  bad: { box: 'border-bad-fg bg-bad/15', icon: 'bg-bad-fg text-background' },
  ok: { box: 'border-ok-fg bg-ok/15', icon: 'bg-ok-fg text-background' },
  warn: { box: 'border-warn-fg bg-warn/15', icon: 'bg-warn-fg text-background' },
}
const RESULT_ICON: Readonly<Record<ResultIcon, LucideIcon>> = { clock: Clock, alert: TriangleAlert, check: CheckIcon, stop: OctagonX }

/** What the run found. One height whatever it says, its title on one line and its words on two, its buttons in place. */
function ResultArea({ run, onTab }: { run: ProofRun; onTab: RunViewProps['onTab'] }) {
  const still = useStill()
  const result = resultOf(run)
  const look = RESULT_LOOK[result.tone]
  const Icon = RESULT_ICON[result.icon]
  const words = `${result.icon}:${result.title}`
  return (
    <section aria-label="Result" aria-live="polite" className={cn('flex h-[128px] items-center gap-[18px] rounded-[20px] border px-[22px] py-[18px] transition-colors duration-[220ms]', look.box)}>
      <span aria-hidden="true" className={cn('grid size-11 shrink-0 place-items-center rounded-[14px] transition-colors duration-[220ms]', look.icon)}>
        <Icon className="size-[22px]" strokeWidth={2} />
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={words}
          className="flex min-w-0 flex-1 flex-col gap-1"
          initial={holdStill({ opacity: 0, transform: 'translateY(6px)' }, still)}
          animate={holdStill({ opacity: 1, transform: 'translateY(0px)' }, still)}
          exit={{ opacity: 0, transition: tween.exit }}
          transition={tween.enter}
        >
          <p className="line-clamp-1 font-heading text-[17px] font-semibold">{result.title}</p>
          <p title={result.line} className="line-clamp-2 text-[13.5px] leading-[1.45] text-muted-foreground">
            {result.line}
          </p>
        </motion.div>
      </AnimatePresence>
      <div className="flex w-[300px] shrink-0 justify-end gap-2 @max-[640px]:w-auto @max-[640px]:flex-col">
        <Button data-stop="" variant={result.primary.strong ? 'default' : 'outline'} className="h-11 rounded-xl px-4 text-[14px]" disabled={!onTab} title={onTab ? undefined : 'The state graph is not in this build yet.'} onClick={() => onTab?.('graph')}>
          {result.primary.label}
        </Button>
        <Button data-stop="" variant="outline" className="h-11 rounded-xl px-3.5 text-[14px]" disabled={!onTab} title={onTab ? undefined : 'The math is not in this build yet.'} onClick={() => onTab?.('math')}>
          Read the math
        </Button>
      </div>
    </section>
  )
}

const PILL: Readonly<Record<Tone, string>> = {
  ok: 'bg-ok/15 text-ok-fg',
  live: 'bg-sun/20 text-foreground',
  quiet: 'bg-tone-1 text-muted-foreground',
  warn: 'bg-warn/15 text-warn-fg',
  bad: 'bg-bad-fg text-background',
}

function Rules({ run }: { run: ProofRun }) {
  const rows = ruleRows(run)
  return (
    <section aria-label="What must stay true" className={cn(CARD, 'flex flex-col gap-2.5 px-5 py-[18px]')}>
      <h2 className="font-heading text-[15px] font-semibold">What must stay true</h2>
      {rows.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map((rule) => (
            <li key={rule.name} className={cn('grid min-h-[52px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-xl px-3 py-2 transition-colors duration-[220ms]', rule.marked ? 'bg-bad/15' : 'bg-transparent')}>
              <span title={rule.name} className="line-clamp-1 font-mono text-[13px] font-medium">
                {rule.name}
              </span>
              <span className={cn('row-span-2 inline-flex h-[26px] items-center rounded-full px-2.5 font-heading text-[12px] font-semibold whitespace-nowrap transition-colors duration-[220ms]', PILL[rule.tone])}>{rule.status}</span>
              <span title={rule.words} className="line-clamp-1 text-[12.5px] text-muted-foreground">
                {rule.words}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">The spec names what must stay true once SANY has read it.</p>
      )}
    </section>
  )
}

const FILL: Readonly<Record<'text' | 'bad' | 'none', string>> = { text: 'bg-foreground', bad: 'bg-bad-fg', none: 'bg-transparent' }

function Actions({ run }: { run: ProofRun }) {
  const still = useStill()
  const note = coverageNote(run)
  return (
    <section aria-label="Which actions ran" className={cn(CARD, 'flex flex-col gap-2.5 px-5 py-[18px]')}>
      <h2 className="font-heading text-[15px] font-semibold">Which actions ran</h2>
      <ul className="flex flex-col gap-[9px]">
        {actionRows(run).map((action) => (
          <li key={action.name} className="grid grid-cols-[96px_minmax(0,1fr)_64px] items-center gap-2.5 text-[12.5px]">
            <span title={action.name} className="truncate font-mono">
              {action.name}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-tone-1">
              <motion.span
                className={cn('block h-full origin-left rounded-full', FILL[action.tone])}
                initial={false}
                animate={{ transform: `scaleX(${action.width / 100})` }}
                transition={still ? { duration: 0 } : { duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
              />
            </span>
            <span className={cn('text-right font-mono tabular-nums', action.tone === 'none' ? 'text-warn-fg' : 'text-foreground')}>{action.count}</span>
          </li>
        ))}
      </ul>
      <p className={cn('line-clamp-2 min-h-9 text-[12.5px] leading-[1.45]', note.tone === 'warn' ? 'text-warn-fg' : 'text-muted-foreground')}>{note.text}</p>
    </section>
  )
}

const LOG_DOT: Readonly<Record<'done' | 'live' | 'ok' | 'bad', string>> = { done: 'bg-foreground', live: 'pf-pulse bg-sun', ok: 'bg-ok-fg', bad: 'bg-bad-fg' }

/** The newest lines of what the run did, in a box that always holds six, so nothing under it moves as lines come. */
function Doing({ run, zone }: { run: ProofRun; zone: string }) {
  const still = useStill()
  const rows = logRows(run, zone)
  return (
    <section aria-label="What hobkin is doing" className={cn(CARD, 'flex flex-col gap-3 px-5 py-[18px]')}>
      <h2 className="font-heading text-[15px] font-semibold">What hobkin is doing</h2>
      <ol className="relative flex flex-col overflow-hidden" style={{ height: LOG_LINES * LOG_ROW }}>
        <AnimatePresence initial={false} mode="popLayout">
          {rows.map((row, index) => (
            <motion.li
              key={row.key}
              layout={still ? false : 'position'}
              initial={holdStill({ opacity: 0, transform: 'translateY(10px)' }, still)}
              animate={holdStill({ opacity: 1, transform: 'translateY(0px)' }, still)}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={tween.enter}
              className="grid shrink-0 grid-cols-[44px_14px_minmax(0,1fr)] gap-2"
              style={{ minHeight: LOG_ROW }}
            >
              <span className="pt-0.5 font-mono text-[11.5px] text-muted-foreground tabular-nums">{row.at}</span>
              <span aria-hidden="true" className="flex flex-col items-center">
                <span className={cn('mt-1 size-2.5 shrink-0 rounded-full', LOG_DOT[row.tone])} />
                <span className={cn('w-0.5 flex-1', index === rows.length - 1 ? 'bg-transparent' : 'bg-border')} />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5 pb-3">
                <span title={row.text} className="line-clamp-2 text-[13px] leading-[1.4]">
                  {row.text}
                </span>
                {row.detail ? (
                  <span title={row.detail} className="line-clamp-1 font-mono text-[11.5px] text-muted-foreground">
                    {row.detail}
                  </span>
                ) : null}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
        {rows.length ? null : <li className="text-[12.5px] text-muted-foreground">Nothing yet. Each step shows here as hobkin takes it.</li>}
      </ol>
    </section>
  )
}

/** Each action's place in the code, from the spec's `\* code:` comments. A row opens the file where the app can. */
function CodeMap({ run, onCode }: { run: ProofRun; onCode: RunViewProps['onCode'] }) {
  const rows = codeRows(run)
  return (
    <section aria-label="Where each action lives" className={cn(CARD, 'flex flex-col gap-2.5 px-5 py-[18px]')}>
      <h2 className="font-heading text-[15px] font-semibold">Where each action lives</h2>
      {rows.length ? (
        <ul className="flex flex-col gap-0.5">
          {rows.map((row) => (
            <li key={row.action}>
              <button
                type="button"
                data-stop={onCode ? '' : undefined}
                disabled={!onCode}
                title={onCode ? `Open ${row.where}` : `${row.where}. The project's folder is not known here, so it cannot open.`}
                onClick={() => onCode?.(row.where)}
                className="-mx-2 grid min-h-9 w-[calc(100%+16px)] grid-cols-[92px_minmax(0,1fr)_14px] items-center gap-2.5 rounded-[10px] px-2 text-left transition-colors duration-[160ms] ease-[ease] enabled:hover:bg-tone-1 disabled:cursor-default"
              >
                <span className="truncate font-mono text-[12.5px] font-medium">{row.action}</span>
                <span className="truncate font-mono text-[12px] text-sun-fg">{row.where}</span>
                {onCode ? <Code aria-hidden="true" className="size-3.5 text-muted-foreground" /> : <span />}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">No action names its code. Each one says where it lives with a `\* code:` comment in the spec.</p>
      )}
    </section>
  )
}
