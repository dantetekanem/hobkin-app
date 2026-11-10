export function messageInput(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('[data-chat-side] textarea')
}

let cancelEntry: (() => void) | undefined

export function focusInput(): void {
  cancelEntry?.()
  messageInput()?.focus()
}

/** Motion retains exiting sections, sometimes after the active section in DOM order. */
export function activeCanvasScreen(): HTMLElement | undefined {
  const key = document.querySelector<HTMLElement>('[data-active-canvas-screen]')?.dataset.activeCanvasScreen
  return [...document.querySelectorAll<HTMLElement>('[data-canvas-screen]')].find((section) => section.dataset.canvasScreen === key)
}

export function focusCanvas(): void {
  activeCanvasScreen()?.focus({ preventScroll: true })
}

/** Navigation waits for React to mount the arriving section. */
export function requestCanvasFocus(selector?: string): void {
  cancelEntry?.()
  if (typeof requestAnimationFrame !== 'function') return
  const owner = document.activeElement
  let pending = true
  const events = ['focusin', 'pointerdown', 'input'] as const
  const cancel = () => {
    pending = false
    events.forEach((event) => document.removeEventListener(event, cancel, true))
    if (cancelEntry === cancel) cancelEntry = undefined
  }
  cancelEntry = cancel
  events.forEach((event) => document.addEventListener(event, cancel, true))
  requestAnimationFrame(() => {
    const take = pending && document.activeElement === owner
    cancel()
    if (take) {
      const section = activeCanvasScreen()
      ;(selector ? (section?.querySelector<HTMLElement>(selector) ?? section) : section)?.focus({ preventScroll: true })
    }
  })
}

/** A lazy screen takes a pending handoff, never focus that has since moved to typing or an overlay. */
export function handOffCanvasFocus(element: HTMLElement): () => void {
  const section = element.closest<HTMLElement>('[data-canvas-screen]')
  const take = (event: FocusEvent) => {
    if (event.target === section && section === activeCanvasScreen()) element.focus({ preventScroll: true })
  }
  section?.addEventListener('focus', take)
  if (section && document.activeElement === section && section === activeCanvasScreen()) element.focus({ preventScroll: true })
  return () => section?.removeEventListener('focus', take)
}
