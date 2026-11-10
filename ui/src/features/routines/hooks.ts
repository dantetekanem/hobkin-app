import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/** The time now, read again every `everyMs`. Clocks on this screen tick on a whole step, so siblings stay in step. */
export function useClock(everyMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      setNow(Date.now())
      timer = setTimeout(tick, everyMs - (Date.now() % everyMs))
    }
    timer = setTimeout(tick, everyMs - (Date.now() % everyMs))
    return () => clearTimeout(timer)
  }, [everyMs, active])

  return now
}

/**
 * The width of an element in CSS pixels, kept up to date as it resizes. 0 until it has been measured.
 * It is the layout width, so a screen that arrives scaled down still measures its real size.
 */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return width
}
