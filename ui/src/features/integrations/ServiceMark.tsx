import { motion } from 'motion/react'
import type { CSSProperties } from 'react'
import { spring } from '@/lib/motion.ts'
import type { MarkLook } from './marks.ts'
import './integrations.css'

/**
 * A service's mark. Its layout id lets it fly from a tile into the detail and back, the same mark all the way.
 * `busy` plays one bob and one ring, as if a tool of the service were in use.
 */
export function ServiceMark({ look, size, layoutId, busy = false }: { look: MarkLook; size: number; layoutId?: string; busy?: boolean }) {
  return (
    <motion.span
      layoutId={layoutId}
      transition={spring.screen}
      aria-hidden="true"
      className="svc-mark"
      // The radius is set here, not by a class, so Motion keeps it round while the mark changes size.
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), '--svc-hue': look.hue } as CSSProperties}
    >
      <span className="svc-mark-face font-heading" data-busy={busy || undefined} style={{ fontSize: Math.round(size * 0.42) }}>
        {look.symbol}
      </span>
    </motion.span>
  )
}
