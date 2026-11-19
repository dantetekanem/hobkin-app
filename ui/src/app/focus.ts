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

/**
 * A screen takes the keyboard only when it is nowhere: on nothing, on the page itself, or on something that
 * has left the page with its old screen. Typing in the chat, or any control still on the page, keeps it.
 */
export function takeKeyboardIfNowhere(element: HTMLElement): boolean {
  const held = document.activeElement as HTMLElement | null
  const nowhere = held == null || held === document.body || held === document.documentElement || held.isConnected === false
  if (nowhere) element.focus({ preventScroll: true })
  return nowhere
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

/** The area of `owner`'s canvas on screen (040-canvas-board), not one on its way out. */
export function canvasBoard(owner: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-canvas-board="${CSS.escape(owner)}"]:not([inert])`)
}

/** Puts the keyboard in `owner`'s canvas. False when it is not on screen. */
export function focusBoard(owner: string): boolean {
  const board = canvasBoard(owner)
  board?.focus({ preventScroll: true })
  return board !== null
}

/** Puts the keyboard in the talk box of the durable hobkin's page on screen. False when there is none. */
export function focusTalk(): boolean {
  const box = activeCanvasScreen()?.querySelector<HTMLElement>('[data-agent-input]')
  box?.focus({ preventScroll: true })
  return Boolean(box)
}

/** The keyboard is in a canvas: its area, its drawing, its controls in the menu, or the canvas place itself. */
export function keyboardInCanvas(): boolean {
  return document.activeElement?.closest('[data-canvas-board], [data-canvas-controls], [data-canvas-screen="canvas"]') != null
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
