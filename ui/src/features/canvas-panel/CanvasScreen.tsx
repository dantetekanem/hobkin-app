import { useEffect, useRef } from 'react'
import { MAIN_CANVAS } from '#shared/protocol/canvas.ts'
import { handOffCanvasFocus } from '@/app/focus.ts'
import { spring } from '@/lib/motion.ts'
import { CanvasView } from './CanvasView.tsx'
import { CANVAS_TOP } from './rules.ts'
import { useArrival } from './use-board.ts'

/**
 * The main hobkin's canvas as a place of its own (`040-canvas-board`): the whole right side, its page or drawing starting
 * just below the floating menu, which holds its controls. Going to it puts the keyboard in it.
 */
export function CanvasScreen() {
  const area = useRef<HTMLDivElement | null>(null)
  // The place pushes in on the screens' spring; the drawing's entrance waits for it.
  const arrived = useArrival(spring.push.duration)
  useEffect(() => (area.current ? handOffCanvasFocus(area.current) : undefined), [])

  return (
    <div className="relative h-full">
      <CanvasView ref={area} owner={MAIN_CANVAS} arrived={arrived} className="absolute inset-x-0 bottom-0 rounded-bl-[26px]" style={{ top: CANVAS_TOP }} />
    </div>
  )
}
