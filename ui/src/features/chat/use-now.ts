import { useEffect, useState } from 'react'

/** The current time, read again every `everyMs` while `active`. For clocks on screen: elapsed time, a reaction that ends, the day. */
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [active, everyMs])

  return now
}
