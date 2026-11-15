import { createContext, useContext, type ReactNode } from 'react'
import { cn } from '@/lib/utils.ts'
import { STAMP_SHAPES, stampOf, type Stamp } from './stamp.ts'

/**
 * The time a row of an agent's work happened, in a column of its own at the left of the row: quiet, to the second, in
 * the conversation's clock, and with the day under it for a row from another day (`stamp.ts`). Every row of a page
 * that shows times keeps the column, a row with no time too, so the times read straight down the page and the rows'
 * own words start on one line. A durable hobkin's page and an agent's page show them; a page that does not say so
 * draws its rows as before.
 */
const Shown = createContext(false)

/** Rows inside show their times. */
export function ShowStamps({ children }: { children: ReactNode }) {
  return <Shown.Provider value>{children}</Shown.Provider>
}

/**
 * Where a row's first line sits, so its time is centered on it: a header row, a command's card, a paragraph of the
 * agent's words, a message bubble, an item in a list opened under a row, another hobkin's bubble that opens with who
 * sent it, or a short note. The numbers are in agent-activity.css.
 */
export type StampLine = 'row' | 'card' | 'text' | 'bubble' | 'item' | 'from' | 'note'

/**
 * A row in the times' column: the column at its left, with the row's time beside its first line, and the row in the
 * rest. With no time the column stays, empty. On a page that shows no times, the row alone.
 */
export function Stamped({ at, line, className, children }: { at?: number | string | null; line: StampLine; className?: string; children: ReactNode }) {
  if (!useContext(Shown)) return <>{children}</>
  // Read as it is drawn: a row drawn yesterday that has not changed keeps its look until it is drawn again.
  const stamp = stampOf(at, Date.now())
  return (
    <div className={cn('aa-stamped', className)} data-aa-line={line}>
      <span className="aa-stamp text-muted-foreground">
        {/* Every shape the time can take, unseen, so the column is as wide on every row. */}
        {STAMP_SHAPES.map((shape) => (
          <span key={shape} className="invisible" aria-hidden="true">
            {shape}
          </span>
        ))}
        {stamp ? <StampTime stamp={stamp} /> : null}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/**
 * The time of a row further down inside a `Stamped` one, such as the next command in a group or an item in a list
 * opened under a row. It reaches out from the row into the column above it, so it reads in line with the rest. Its
 * parent is positioned and starts where the column's rows start, or `--aa-indent` further in.
 */
export function RowStamp({ at, line }: { at?: number; line: StampLine }) {
  const stamp = stampOf(at, Date.now())
  if (!useContext(Shown) || !stamp) return null
  return (
    <span className="aa-row-stamp text-muted-foreground" data-aa-line={line}>
      <StampTime stamp={stamp} />
    </span>
  )
}

function StampTime({ stamp }: { stamp: Stamp }) {
  return (
    <time dateTime={stamp.iso} title={stamp.full}>
      {stamp.time}
      {stamp.date ? <span className="aa-stamp-date">{stamp.date}</span> : null}
    </time>
  )
}
