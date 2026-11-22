import { useEffect, useRef, useState } from 'react'

/**
 * The run a panel shows (053-work-control-room, "Proofs"): the one its holder asked for, until J and K, or Run again,
 * move it along; a new ask starts there again. `onShow` hears each run it shows, the first too, once each time it
 * changes, so the holder always knows which run is in the panel.
 */
export function useShownRun(asked: string, onShow?: (id: string) => void): [id: string, moveTo: (id: string) => void] {
  const [shown, setShown] = useState({ asked, id: asked })
  const id = shown.asked === asked ? shown.id : asked
  const latest = useRef(onShow)
  latest.current = onShow
  useEffect(() => {
    latest.current?.(id)
  }, [id])
  return [id, (next) => setShown({ asked, id: next })]
}
