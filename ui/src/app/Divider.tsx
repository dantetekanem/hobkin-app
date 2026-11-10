import { useRef } from 'react'
import { CONVERSATION_WIDTH, useView } from './view-store.ts'

const KEY_STEP = 16

/** The gap between the chat and the canvas. Drag it, or focus it and use the arrow keys, to resize the conversation. */
export function Divider() {
  const width = useView((view) => view.conversationWidth)
  const resize = useView((view) => view.resizeConversation)
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the conversation"
      aria-valuemin={CONVERSATION_WIDTH.min}
      aria-valuemax={CONVERSATION_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      className="group relative z-10 w-2.5 shrink-0 cursor-col-resize touch-none outline-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { startX: event.clientX, startWidth: width }
      }}
      onPointerMove={(event) => {
        if (drag.current) resize(drag.current.startWidth + event.clientX - drag.current.startX)
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => resize(CONVERSATION_WIDTH.initial)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') resize(width - KEY_STEP)
        else if (event.key === 'ArrowRight') resize(width + KEY_STEP)
        else if (event.key === 'Home') resize(CONVERSATION_WIDTH.min)
        else if (event.key === 'End') resize(CONVERSATION_WIDTH.max)
        else return
        event.preventDefault()
      }}
    >
      {/* No line at rest: the chat and the floating canvas need none between them. A grip shows on hover and focus. */}
      <span className="absolute top-1/2 left-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border-strong opacity-0 transition-opacity duration-[160ms] ease-[ease] group-hover:opacity-60 group-focus-visible:opacity-100 group-active:opacity-100" />
    </div>
  )
}
