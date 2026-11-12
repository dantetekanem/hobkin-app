import { Progress } from '@base-ui/react/progress'
import { cn } from '@/lib/utils.ts'

/**
 * How far along a run is, as a bar. With no percent yet a band sweeps across it; waiting its turn it stays empty;
 * stopped it turns red. The bar's width eases to each new percent.
 */
export function ProgressLine({ percent, state, label, className }: { percent: number | null; state: 'queued' | 'running' | 'failed'; label: string; className?: string }) {
  return (
    <Progress.Root value={percent} aria-label={label} className={cn('min-w-0', className)}>
      <Progress.Track className="relative h-2.5 overflow-hidden rounded-full bg-border">
        {percent == null ? (
          state === 'running' ? <span aria-hidden="true" className="pv-sweep" /> : null
        ) : (
          <Progress.Indicator className={cn('h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out)]', state === 'failed' ? 'bg-bad' : 'bg-primary')} />
        )}
      </Progress.Track>
    </Progress.Root>
  )
}
