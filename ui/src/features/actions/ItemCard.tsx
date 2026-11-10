import { ExternalLink, Waypoints } from 'lucide-react'
import { motion, type Variants } from 'motion/react'
import { Fragment } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { rowLayout } from '@/features/reports/list-motion.ts'
import { timeOf, waited } from '@/features/reports/time.ts'
import { cn } from '@/lib/utils.ts'
import type { WaitingRow } from './items.ts'
import { KIND } from './kinds.ts'

interface ItemCardProps {
  row: WaitingRow
  now: number
  variants: Variants
  /** Its turn in the screen's arrival, or -1 when it arrives on its own. */
  order: number
  readOnly?: boolean
  onAsk: (row: WaitingRow) => void
  onReview: (row: WaitingRow) => void
}

/**
 * One thing waiting on the user: what kind it is and who asks, the one line that says what it is, and its
 * choices in words, with hobkin's pick marked. The whole card is one button that asks the question. Its own
 * controls (Review, links) sit on top, and Right reaches them from the keyboard.
 */
export function ItemCard({ row, now, variants, order, readOnly = false, onAsk, onReview }: ItemCardProps) {
  const { label, icon: Icon } = KIND[row.kind]
  const at = timeOf(row.at)
  const choices = row.question.choices
  // "Routine inbox-sweep" already says it is a routine.
  const source = row.from.toLowerCase().startsWith(label.toLowerCase()) ? row.from : `${label} · ${row.from}`

  return (
    <motion.li
      data-item={row.id}
      layout="position"
      variants={variants}
      custom={order}
      initial="enter"
      animate="center"
      exit="gone"
      transition={rowLayout}
      className="relative"
    >
      <button
        type="button"
        data-stop=""
        data-item-row={row.id}
        aria-label={`${label}, from ${row.from}: ${row.summary}`}
        aria-disabled={readOnly || undefined}
        onClick={() => { if (!readOnly) onAsk(row) }}
        className="absolute inset-0 cursor-default rounded-3xl bg-background transition-colors duration-[160ms] ease-[ease] hover:bg-tone-2"
      />
      <div className="pointer-events-none relative flex items-start gap-4 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-surface-2">
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2">
            <span className="eyebrow min-w-0 flex-1 truncate">{source}</span>
            <span className="shrink-0 text-[12px] text-muted-foreground">{row.putOff ? 'Put off' : at === null ? '' : `${waited(at, now)} ago`}</span>
          </p>
          <h3 className="mt-1 line-clamp-2 font-heading text-[16px] leading-snug font-semibold tracking-[-0.01em] text-balance">{row.summary}</h3>
          {readOnly ? (
            <p className="mt-1.5 text-[13px] leading-snug whitespace-pre-wrap text-muted-foreground">
              {row.item?.question ?? row.question.tldr}
              {row.item?.why ? `\n${row.item.why}` : ''}
            </p>
          ) : null}
          <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
            {choices.map((choice, index) => (
              <Fragment key={choice.value}>
                {index ? <span aria-hidden="true"> · </span> : null}
                <span className={cn(choice.label === row.pick && 'font-medium text-foreground')}>{choice.label}</span>
                {choice.label === row.pick ? <span className="eyebrow ml-1.5 text-sun-fg">hobkin's pick</span> : null}
              </Fragment>
            ))}
          </p>
          {row.changed ? (
            <p className="mt-1.5 flex items-baseline gap-2 text-[13px] leading-snug">
              <span className="eyebrow shrink-0">Changed</span>
              <span>{row.changed}</span>
            </p>
          ) : null}
          {row.links.length ? (
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {row.links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  tabIndex={-1}
                  data-row-control=""
                  className="pointer-events-auto inline-flex items-center gap-1 rounded-sm text-[13px] underline decoration-border-strong underline-offset-[3px] transition-colors duration-[160ms] ease-[ease] hover:decoration-foreground"
                >
                  {link.label}
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              ))}
            </p>
          ) : null}
        </div>
        {row.branch ? (
          <Button variant="outline" size="sm" tabIndex={-1} disabled={readOnly} data-row-control="" onClick={() => { if (!readOnly) onReview(row) }} className="pointer-events-auto shrink-0 self-center">
            <Waypoints aria-hidden="true" />
            Review
          </Button>
        ) : null}
      </div>
    </motion.li>
  )
}
