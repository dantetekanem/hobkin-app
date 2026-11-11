import { ArrowUpRight, ExternalLink, Waypoints } from 'lucide-react'
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
  /** Kept for the screen that still passes it. A card is always actionable. */
  readOnly?: boolean
  /** The card's own action: open its whole decision, or open it where it is handled. */
  onAsk: (row: WaitingRow) => void
  onReview: (row: WaitingRow) => void
}

const OPENS_IN = { reports: 'Opens in Reports', work: 'Opens in Work' } as const

/**
 * One thing waiting on the user: what kind it is and who asks, the one line that says what it is, and its
 * choices in words, with hobkin's pick marked. The whole card is one button that opens its whole decision, or
 * opens it where hobkin handles it. Its own controls (links, Review) sit on top, and Right reaches them.
 */
export function ItemCard({ row, now, variants, order, onAsk, onReview }: ItemCardProps) {
  const { label, icon: Icon } = KIND[row.kind]
  const at = timeOf(row.at)
  const choices = row.question.choices
  // "Routine inbox-sweep" already says it is a routine.
  const source = row.from.toLowerCase().startsWith(label.toLowerCase()) ? row.from : `${label} · ${row.from}`
  const action = row.opens ? OPENS_IN[row.opens.screen] : 'Answer'

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
        aria-label={`${action}: ${label}, from ${row.from}: ${row.summary}`}
        onClick={() => onAsk(row)}
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
          {row.opens ? (
            <p className="mt-1.5 flex items-center gap-1 text-[13px] leading-snug text-muted-foreground">
              {row.question.tldr ? <span className="min-w-0 truncate">{row.question.tldr}</span> : null}
              <span className="flex shrink-0 items-center gap-0.5 font-medium text-foreground">
                {row.question.tldr ? <span aria-hidden="true" className="font-normal text-muted-foreground"> · </span> : null}
                {OPENS_IN[row.opens.screen]}
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </span>
            </p>
          ) : (
            <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
              {choices.map((choice, index) => (
                <Fragment key={choice.value}>
                  {index ? <span aria-hidden="true"> · </span> : null}
                  <span className={cn(choice.label === row.pick && 'font-medium text-foreground')}>{choice.label}</span>
                  {choice.label === row.pick ? <span className="eyebrow ml-1.5 text-sun-fg">hobkin's pick</span> : null}
                </Fragment>
              ))}
            </p>
          )}
          {row.changed ? (
            <p className="mt-1.5 flex items-baseline gap-2 text-[13px] leading-snug">
              <span className="eyebrow shrink-0">Changed</span>
              <span>{row.changed}</span>
            </p>
          ) : null}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 empty:hidden">
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
        </div>
        {row.branch ? (
          <Button variant="outline" size="sm" tabIndex={-1} data-row-control="" onClick={() => onReview(row)} className="pointer-events-auto shrink-0 self-center">
            <Waypoints aria-hidden="true" />
            Review
          </Button>
        ) : null}
      </div>
    </motion.li>
  )
}
