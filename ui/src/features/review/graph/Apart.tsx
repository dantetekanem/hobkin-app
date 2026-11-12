import { ViewportPortal } from '@xyflow/react'
import { useSession } from '../state/context.tsx'

/** Room between the block's cards and the dashed line around them, in points of the graph. */
const PAD = 22

/**
 * The label of the block of nodes nothing wires (the user, 2026-11-12: "many nodes also doesn't connect"): a dashed line
 * around them, under the flow, and what they are. Each card says why it stands apart. It is only a line and words, so it
 * lies over the graph without hiding anything, and the pointer goes through it.
 */
export function Apart() {
  const apart = useSession((session) => session.view.apart)
  if (!apart) return null
  const { box } = apart
  return (
    <ViewportPortal>
      <div
        className="rv-apart"
        aria-hidden="true"
        style={{ left: box.x - PAD, top: box.y - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 }}
      >
        <span className="rv-apart-label">Not linked to the change's code</span>
      </div>
    </ViewportPortal>
  )
}
