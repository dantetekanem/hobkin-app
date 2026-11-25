import { activeCanvasScreen, focusCanvas } from './focus.ts'
import { overlayOpen } from './key-page.ts'
import { rowKeyOf } from './kept-place.ts'
import { rescueKeyboard } from './keyboard-rescue.ts'

const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'
/** React is done putting a moved or remounted row back within a frame or two. */
const SETTLE_MS = 60

/**
 * One focusout and one pointerdown on the page. When the keyboard falls to the page itself and no press caused it,
 * it goes back to the row it was on, or else to the open screen, as Escape puts it there.
 */
export function watchKeyboard(): () => void {
  let pressedAt: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const press = (event: Event) => {
    pressedAt = event.timeStamp
  }
  const fell = (event: FocusEvent) => {
    if (event.relatedTarget) return
    const from = event.target instanceof Element ? event.target : null
    const screen = activeCanvasScreen()
    const rowKey = screen ? rowKeyOf(from, screen) : undefined
    const fromField = from?.matches(FIELD) ?? false
    const fromCanvas = Boolean(from?.closest('[data-canvas-screen]')) || rowKey !== undefined
    const at = event.timeStamp
    clearTimeout(timer)
    timer = setTimeout(() => {
      const now = activeCanvasScreen()
      const rescue = rescueKeyboard({
        onBody: document.activeElement == null || document.activeElement === document.body,
        windowFocused: document.hasFocus(),
        fromField,
        fromCanvas,
        rowKey,
        rowDrawn: rowKey !== undefined && now?.querySelector(rowKey) != null,
        overlayOpen: overlayOpen(document),
        sincePointerMs: pressedAt === null ? null : at - pressedAt,
      })
      if (rescue?.to === 'row') now?.querySelector<HTMLElement>(rescue.key)?.focus({ preventScroll: true })
      if (rescue && document.activeElement === document.body) focusCanvas()
    }, SETTLE_MS)
  }
  document.addEventListener('pointerdown', press, true)
  document.addEventListener('focusout', fell, true)
  return () => {
    clearTimeout(timer)
    document.removeEventListener('pointerdown', press, true)
    document.removeEventListener('focusout', fell, true)
  }
}
