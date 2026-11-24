import type { NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { motion } from 'motion/react'
import { memo } from 'react'
import { ZONE_FRAME } from '#shared/review/layout.ts'
import { tween } from '@/lib/motion.ts'
import { useSession, useSessionStore } from '../state/context.tsx'
import { useZoneEntrance } from './entrance.tsx'
import { countsRoom, HEADING, headingRoom, headingWords, REGION_PREFIX, zoneTitle, zoneWords } from './zones.ts'

/** The room the layout keeps for the heading, and beside the nodes, for the region's CSS. */
const FRAME = { '--zone-head': `${ZONE_FRAME.head}px`, '--zone-pad': `${ZONE_FRAME.pad}px` } as React.CSSProperties

/**
 * A zone drawn behind its nodes (spec 055): one quiet box, under the cards and their wires, with its name and what it
 * holds as a heading in the room the layout keeps above its nodes, never over a card. The heading of a zone of code is
 * a button: it folds the whole zone into one card, and opens it again; its place and size stay the same either way. A
 * zone of tests folds only with the code it covers, so its heading only says what it is. A name too wide for its region
 * gives up its layer before its subject (`headingWords`), and the whole name is the heading's title. From far away the
 * heading grows inside that room, the layer small over the subject large, so the zones read as a map. It arrives with
 * its first node, only fading.
 */
function ZoneRegionComponent({ id, width = 0 }: NodeProps) {
  const store = useSessionStore()
  const zoneId = id.slice(REGION_PREFIX.length)
  const zone = useSession((session) => session.view.zones.find((each) => each.id === zoneId))
  const folded = useSession((session) => session.fold.zones?.includes(zoneId) ?? false)
  const entrance = useZoneEntrance(zoneId)
  if (!zone) return null

  const words = zoneWords(zone)
  const title = zoneTitle(zone)
  const near = headingWords(title, headingRoom(width, words), HEADING.size)
  const said = (
    <>
      <span className="rv-zone-mark" aria-hidden="true" />
      <span className="rv-zone-label">
        <span className="rv-zone-near">{near}</span>
        {title.layer != null ? <span className="rv-zone-layer">{title.layer}</span> : null}
        <span className="rv-zone-subject">{title.subject}</span>
      </span>
      <span className="rv-zone-counts" style={{ '--counts-room': `${countsRoom(width)}px` } as React.CSSProperties}>
        {words}
      </span>
    </>
  )
  return (
    <motion.div
      className="rv-zone"
      data-standing={zone.standing}
      data-tests={zone.tests}
      data-folded={folded}
      style={FRAME}
      initial={entrance ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={entrance ? { ...tween.enter, delay: entrance.delay } : { duration: 0 }}
    >
      {zone.tests ? (
        <div className="rv-zone-head" data-one-line={title.layer == null} title={`${zone.label}: ${words}. It folds with the code it covers.`} aria-label={`${zone.label}: ${words}`}>
          {said}
        </div>
      ) : (
        <button
          type="button"
          className="rv-zone-head pressable nodrag nopan"
          data-one-line={title.layer == null}
          aria-expanded={!folded}
          aria-label={`${folded ? 'Open' : 'Fold'} ${zone.label}: ${words}`}
          title={`${folded ? 'Open' : 'Fold'} ${zone.label}`}
          onClick={(event) => {
            // The click is the heading's: it does not reach the pane, which would close what is open.
            event.stopPropagation()
            store.getState().toggleZone(zoneId)
          }}
        >
          {said}
          {folded ? <ChevronDown className="rv-zone-chevron" aria-hidden="true" /> : <ChevronUp className="rv-zone-chevron" aria-hidden="true" />}
        </button>
      )}
    </motion.div>
  )
}

export const ZoneRegion = memo(ZoneRegionComponent)
