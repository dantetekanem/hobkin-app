import { memo } from 'react'
import { cn } from '@/lib/utils.ts'
import { SERIES_COLOR } from './chart-kit.ts'

export interface SparklineProps {
  /** One value a day, oldest first. Null where a rate has nothing under it: no bar is drawn there. */
  values: readonly (number | null)[]
  /** The value a full bar stands for: 1 for a share, the largest value when left out. */
  most?: number
  /** Names the sparkline for a reader; without it, it is left to its tile's words. */
  label?: string
  className?: string
}

/**
 * A row of thin day bars, as in the Work sketch (▁▂▃▅): the newest in hobkin's yellow, the rest quiet, a day of zero a
 * hairline at the base. It fills its box, which keeps its height whatever the values are.
 */
export const Sparkline = memo(function Sparkline({ values, most, label, className }: SparklineProps) {
  const top = most ?? Math.max(0, ...values.map((value) => value ?? 0))
  const last = values.length - 1
  return (
    <span role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn('flex h-6 items-end gap-px', className)}>
      {values.map((value, index) => (
        <span
          key={index}
          className="min-w-0 flex-1 rounded-t-[1px]"
          style={
            value === null
              ? undefined
              : value > 0 && top > 0
                ? { height: `max(2px, ${Math.min(1, value / top) * 100}%)`, background: index === last ? SERIES_COLOR.now : SERIES_COLOR.plain }
                : { height: 1, background: 'var(--hb-border)' }
          }
        />
      ))}
    </span>
  )
})
