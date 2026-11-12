import { ArrowDown } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils.ts'
import type { LogLine } from '../preparing-model.ts'

/** How close to the bottom still counts as reading the newest line, in pixels. */
const NEAR_BOTTOM = 24

/** The newest line reads at full strength, and each older one a little less, down to a floor that still reads well. */
const opacityOf = (age: number) => Math.max(0.7, 1 - age * 0.03)

/**
 * The run's log as it grows: monospace, oldest at the top and newest at the bottom, the older lines fading. It follows
 * the newest line unless the reader scrolls up to read, and then a button takes them back down to it.
 */
export function LiveLog({ lines, className, stop = false }: { lines: LogLine[]; className?: string; stop?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const [overflowing, setOverflowing] = useState(false)
  const newest = lines.at(-1)?.key

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    if (following) element.scrollTop = element.scrollHeight
    setOverflowing(element.scrollHeight > element.clientHeight + 1)
  }, [newest, following])

  const onScroll = () => {
    const element = box.current
    if (element) setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM)
  }
  const toNewest = () => {
    const element = box.current
    if (!element) return
    element.scrollTop = element.scrollHeight
    setFollowing(true)
  }
  // Up and Down scroll the log while it has room, and only then: at its ends they walk the view's controls (`data-stop`).
  const onKeyDown = (event: KeyboardEvent) => {
    const element = box.current
    if (!element || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || event.metaKey || event.altKey || event.ctrlKey) return
    const down = event.key === 'ArrowDown'
    const room = down ? element.scrollHeight - element.scrollTop - element.clientHeight > 1 : element.scrollTop > 0
    if (!room) return
    element.scrollBy({ top: down ? 44 : -44 })
    event.preventDefault()
  }

  return (
    <div className="relative min-w-0">
      {/* The view says what the run does now; the log is read, not announced line by line. */}
      <div
        ref={box}
        role="log"
        aria-live="off"
        aria-label="What the run did"
        tabIndex={0}
        {...(stop ? { 'data-stop': '' } : {})}
        data-overflow={overflowing}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        className={cn('pv-log scroll-quiet overflow-y-auto overscroll-contain font-mono text-[14px] leading-[1.6] outline-offset-2 select-text [font-variant-ligatures:none]', className)}
      >
        {lines.length ? (
          <ol className="flex flex-col gap-1">
            {lines.map((line, index) => (
              <li key={line.key} className="pv-line grid grid-cols-[5.5ch_minmax(0,1fr)] gap-x-3" style={{ opacity: opacityOf(lines.length - 1 - index) }}>
                <span className="text-right text-muted-foreground tabular-nums">{line.at}</span>
                <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{line.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="font-sans text-[14px] text-muted-foreground">Nothing written yet. Each step adds its lines here as it works.</p>
        )}
      </div>
      {following ? null : (
        <button
          type="button"
          onClick={toNewest}
          className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-popover px-3 py-1.5 font-heading text-[14px] font-semibold text-popover-foreground shadow-float transition-transform duration-[140ms] ease-[var(--ease-out)] active:scale-[0.96]"
        >
          <ArrowDown className="size-4" aria-hidden="true" />
          Newest
        </button>
      )}
    </div>
  )
}
