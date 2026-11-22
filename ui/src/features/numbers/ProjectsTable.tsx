import { memo, useMemo } from 'react'
import { OpenArrow } from '@/components/ui/open-arrow.tsx'
import { cn } from '@/lib/utils.ts'
import { pressProps } from './ChartFrame.tsx'
import type { ChartStatus, ProjectRow } from './chart-kit.ts'
import { countWords, NO_DATA, shareWords, spanWords } from './format.ts'
import { Sparkline } from './Sparkline.tsx'

export interface ProjectsTableProps {
  id?: string
  rows: readonly ProjectRow[]
  /** The period the numbers cover, for the sparkline's heading: "30 days". */
  periodWords: string
  title?: string
  counts?: string
  status?: ChartStatus
  note?: string
  /** Makes each row a button that opens its project. */
  onOpen?: (slug: string) => void
}

const COLUMNS = 'grid-cols-[minmax(7rem,1fr)_56px_72px_72px_88px_88px_16px]'
const ROW = 44

/**
 * The table of projects: its name, how many merged, the share merged by itself, the first pass rate, the median wait
 * for the user's yes or no, and its merges by day. A rate with nothing under it reads "no data yet". Given `onOpen`,
 * each row is a button that opens the project. While the numbers load it keeps the height of three rows.
 */
export const ProjectsTable = memo(function ProjectsTable({ id, rows, periodWords, title = 'Projects', counts = 'Each project over the period, the most merged first. A row opens the project.', status = 'ready', note, onOpen }: ProjectsTableProps) {
  const opens = useMemo(() => (onOpen ? new Map(rows.map((row) => [row.slug, () => onOpen(row.slug)])) : null), [rows, onOpen])
  const ready = status === 'ready'
  return (
    <section id={id} aria-label={title} className="flex min-w-0 flex-col gap-2 rounded-2xl bg-background px-4 py-3">
      <div className="flex h-6 items-center">
        <h3 className="font-heading text-[13.5px] font-semibold">{title}</h3>
      </div>
      <p className="h-5 truncate text-[12.5px] leading-5 text-muted-foreground">{counts}</p>
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div aria-hidden="true" className={cn('grid h-7 items-center gap-x-3 px-2 text-[11.5px] text-muted-foreground', COLUMNS)}>
            <span>Project</span>
            <span className="text-right">Merged</span>
            <span className="text-right">By itself</span>
            <span className="text-right">First pass</span>
            <span className="text-right">Wait for you</span>
            <span>{periodWords}</span>
            <span />
          </div>
          {ready && rows.length ? (
            <ul aria-label={title} className="flex flex-col">
              {rows.map((row) => (
                <li key={row.slug} className="border-t border-border/60">
                  <Row row={row} onOpen={opens?.get(row.slug)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="grid place-items-center border-t border-border/60 text-[13px] text-muted-foreground" style={{ height: 3 * ROW }}>
              {status === 'loading' ? 'Reading the numbers…' : ready ? 'No project taken yet.' : (note ?? 'No data yet.')}
            </p>
          )}
        </div>
      </div>
    </section>
  )
})

const Row = memo(function Row({ row, onOpen }: { row: ProjectRow; onOpen?: () => void }) {
  const empty = row.merged === 0 && row.firstPass === null && row.wait === null
  const name = `${row.name}: ${countWords(row.merged)} merged, ${shareWords(row.byItself)} by itself, first pass ${shareWords(row.firstPass)}, wait for you ${spanWords(row.wait)}${empty ? '. Nothing yet' : ''}`
  const cells = (
    <>
      <span className="truncate text-[13.5px] font-medium">{row.name}</span>
      <span className="text-right text-[13px] tabular-nums">{countWords(row.merged)}</span>
      <Cell words={shareWords(row.byItself)} />
      <Cell words={shareWords(row.firstPass)} />
      <Cell words={spanWords(row.wait)} />
      <Sparkline values={row.series} className="h-5" />
      {onOpen ? <OpenArrow className="size-3.5" /> : <span />}
    </>
  )
  const line = cn('grid w-full items-center gap-x-3 rounded-xl px-2 text-left', COLUMNS)
  return (
    <div {...pressProps(onOpen)} aria-label={name} className={cn(line, onOpen && 'pressable')} style={{ height: ROW }}>
      {cells}
    </div>
  )
})

/** A rate or a span, quiet when there is nothing under it. */
function Cell({ words }: { words: string }) {
  return <span className={cn('truncate text-right text-[13px] tabular-nums', words === NO_DATA ? 'text-[12px] text-muted-foreground' : '')}>{words}</span>
}
