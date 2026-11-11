import { requestCanvasFocus } from '@/app/focus.ts'
import { useView } from '@/app/view-store.ts'
import { intoMind, outOfMind } from './mind.ts'

/** What had the keyboard when the mind opened. The way back is the view's `mindReturn`, which a reload keeps. */
let opener: HTMLElement | null = null

const inCanvas = (element: Element | null) => element?.closest('[data-canvas-screen]') != null

/**
 * Command+J, or the brain in the chat's header: opens hobkin's mind on the canvas, or leaves it for where the user was.
 * The keyboard stays where it is, so the chat stays usable beside the mind; only one that was in the leaving screen
 * goes into the mind. Leaving gives it back to what had it, or to the screen that returns.
 */
export function toggleMind(): void {
  const view = useView.getState()
  const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
  if (view.screen === 'mind') {
    // Only a keyboard that was in the mind is moved. One the user took to the chat stays there.
    const wasInMind = active?.closest('[data-canvas-screen="mind"]') != null
    useView.setState({ ...outOfMind(view.mindReturn), mindReturn: null })
    const to = opener
    opener = null
    if (!wasInMind) return
    if (to?.isConnected && !inCanvas(to)) to.focus({ preventScroll: true })
    else requestCanvasFocus()
    return
  }
  const next = intoMind(view, view.mindReturn)
  opener = active
  useView.setState({ ...next.view, mindReturn: next.back })
  if (inCanvas(active)) {
    view.engageCanvas()
    requestCanvasFocus()
  }
}
