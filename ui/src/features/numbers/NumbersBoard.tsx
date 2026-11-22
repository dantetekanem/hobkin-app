import { memo, useEffect, useMemo } from 'react'
import type { WorkMetrics } from '#shared/protocol/metrics.ts'
import { Segmented } from '@/features/work/parts.tsx'
import { cn } from '@/lib/utils.ts'
import { boardOf, chartId, NUMBERS_PERIODS, projectRows, type NumbersChart, type NumbersOpen, type NumbersPeriod } from './board-model.ts'
import type { ChartStatus, RatePoint } from './chart-kit.ts'
import { DayBars } from './DayBars.tsx'
import { READ_WORDS, type MetricsReadState } from './metrics-store.ts'
import { ProjectsTable } from './ProjectsTable.tsx'
import { RateLine } from './RateLine.tsx'
import { SpanPair } from './SpanPair.tsx'
import { tokenWords } from './format.ts'

export interface NumbersBoardProps {
  /** The numbers of the last `period` days (`useWorkMetrics(period)`), or null while there are none. */
  metrics: WorkMetrics | null
  /** Where the read stands. `loading` with numbers holds them dimmed until the new period's arrive. */
  state: MetricsReadState
  period: NumbersPeriod
  onPeriod: (period: NumbersPeriod) => void
  /** A chart, a day or week of one, or a project's row was opened. */
  onOpen: (what: NumbersOpen) => void
  /** The chart to bring into view and give the keyboard, as when a tile on Work opened the tab. */
  at?: NumbersChart | null
}

const PERIOD_OPTIONS = NUMBERS_PERIODS.map((days) => ({ value: String(days) as `${NumbersPeriod}`, label: `${days} days` }))

const NO_DAYS: string[] = []

/**
 * The Numbers tab (_specs/053-work-control-room, the Numbers sketch): the period switch, then merged by day, the first
 * pass rate beside the waits, AI reviews beside proofs, tokens, and the table of projects. A chart with something
 * behind it opens it through `onOpen`; Proofs and Tokens have no list behind them, so they are plain charts. Every box
 * keeps its size while the numbers load, and a read that has none says why in each box. It is placed by the page that
 * shows it; it reads nothing itself.
 */
export const NumbersBoard = memo(function NumbersBoard({ metrics, state, period, onPeriod, onOpen, at = null }: NumbersBoardProps) {
  const board = useMemo(() => (metrics ? boardOf(metrics, period) : null), [metrics, period])
  const rows = useMemo(() => (metrics ? projectRows(metrics, period) : []), [metrics, period])
  const status: ChartStatus = board ? 'ready' : state === 'loading' ? 'loading' : 'no-data'
  const note = board ? undefined : (READ_WORDS[state] ?? undefined)
  const held = board !== null && state === 'loading'
  const line = [
    state === 'failed' && board
      ? 'The last read failed. These are the numbers read before it.'
      : state === 'older-host'
        ? 'This host sends no numbers yet: it is older than this window. They show once hobkin restarts.'
        : state === 'failed'
          ? READ_WORDS.failed
          : null,
    metrics?.gaps.length ? `Not counted: ${metrics.gaps.join('; ')}. The rest still counts.` : null,
  ]
    .filter(Boolean)
    .join(' ')

  const opens = useMemo(
    () => ({
      merged: (day: string | null) => onOpen(day ? { chart: 'merged', from: day, to: day } : { chart: 'merged' }),
      firstPass: (point: RatePoint | null) => onOpen(point ? { chart: 'first-pass', from: point.from, to: point.to } : { chart: 'first-pass' }),
      waiting: () => onOpen({ chart: 'waiting' }),
      startToMerge: () => onOpen({ chart: 'start-to-merge' }),
      reviews: (day: string | null) => onOpen(day ? { chart: 'ai-reviews', from: day, to: day } : { chart: 'ai-reviews' }),
      project: (slug: string) => onOpen({ project: slug }),
    }),
    [onOpen],
  )

  useEffect(() => {
    if (!at) return
    const chart = document.getElementById(chartId(at))
    chart?.scrollIntoView({ block: 'nearest' })
    chart?.querySelector<HTMLElement>('[data-stop]')?.focus({ preventScroll: true })
  }, [at])

  const days = board?.days ?? NO_DAYS
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1">
        <Segmented label="Period" name="numbers-period" value={String(period) as `${NumbersPeriod}`} options={PERIOD_OPTIONS} onChoose={(value) => onPeriod(Number(value) as NumbersPeriod)} />
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted-foreground">{line}</p>
      </div>
      <div className={cn('@container', held && 'opacity-60')}>
        <div className="grid gap-3 @3xl:grid-cols-2">
          <div className="@3xl:col-span-2">
            <DayBars
              id={chartId('merged')}
              title="Merged by day"
              counts="Changes merged each day, by itself in YOLO mode or on your yes. The line is the changes you declined."
              figure={board?.merged.figure}
              days={days}
              series={board?.merged.series ?? []}
              line={board?.merged.line}
              status={status}
              note={note}
              onOpen={opens.merged}
            />
          </div>
          <RateLine
            id={chartId('first-pass')}
            title="First pass rate"
            counts={`Of the changes merged or declined each ${period <= 7 ? 'day' : 'week'}, the share never sent back first. Under each point: how many were decided.`}
            figure={board?.firstPass.figure}
            points={board?.firstPass.points ?? []}
            status={status}
            note={note}
            onOpen={opens.firstPass}
          />
          <div className="flex flex-col justify-between gap-3">
            <SpanPair id={chartId('waiting')} title="Waiting for you" counts="From a change reaching Finished changes to your yes or no." span={board?.waiting ?? null} status={status} note={note} onOpen={opens.waiting} />
            <SpanPair id={chartId('start-to-merge')} title="Start to merge" counts="From a change's first run starting to its merge." span={board?.startToMerge ?? null} status={status} note={note} onOpen={opens.startToMerge} />
          </div>
          <DayBars
            id={chartId('ai-reviews')}
            title="AI reviews"
            counts="AI reviews that ended each day: safe to deploy, risky, or stopped before an answer."
            figure={board?.reviews.figure}
            days={days}
            series={board?.reviews.series ?? []}
            status={status}
            note={note}
            onOpen={opens.reviews}
          />
          <DayBars
            id={chartId('proofs')}
            title="Proofs"
            counts="Model checks and proofs that ended each day: every rule holds, or one broke."
            figure={board?.proofs.figure}
            days={days}
            series={board?.proofs.series ?? []}
            status={status}
            note={note}
          />
          <div className="@3xl:col-span-2">
            <DayBars
              id={chartId('tokens')}
              title="Tokens"
              counts="Fresh tokens work mode spent each day."
              figure={board?.tokens.figure}
              days={days}
              series={board?.tokens.series ?? []}
              words={tokenWords}
              status={status}
              note={note}
            />
          </div>
          <div className="@3xl:col-span-2">
            <ProjectsTable id={chartId('projects')} rows={rows} periodWords={`${period} days`} status={status} note={note} onOpen={opens.project} />
          </div>
        </div>
      </div>
    </div>
  )
})
