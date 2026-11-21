import { useState } from 'react'

/**
 * True from the first draw in which `wanted` is true, and from then on. A part whose code loads on first use mounts
 * when it is first wanted and stays mounted, so it can play its own exit.
 */
export function useWantedOnce(wanted: boolean): boolean {
  const [once, setOnce] = useState(wanted)
  if (wanted && !once) setOnce(true)
  return wanted || once
}
