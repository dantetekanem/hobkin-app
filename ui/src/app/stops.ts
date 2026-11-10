import { useEffect, type RefObject } from 'react'

/**
 * Keyboard walking inside a canvas screen. Tab belongs to the frame everywhere (it changes the screen),
 * so inside a screen the rule is the terminal's: Up and Down move between controls, Left and Right change
 * the control that has the keyboard, Enter and Space press it.
 *
 * A screen marks each control with `data-stop`, in reading order, and calls this hook on its root.
 * See _specs/019-keyboard.
 */
export function useStops(root: RefObject<HTMLElement | null>): void {
  useEffect(() => bindStops(root.current), [root])
}

/** Bind the screen's keyboard handoff and control walking for its mounted lifetime. */
export function bindStops(element: HTMLElement | null): (() => void) | undefined {
  if (!element) return
  const screen = element.closest<HTMLElement>('[data-canvas-screen]')
  const stops = () => [...element.querySelectorAll<HTMLElement>('[data-stop]')].filter((stop) => !stop.hasAttribute('disabled'))

  // Arrival is transformed: focusing a control must not scroll the clipping canvas to chase it.
  const onScreenFocus = (event: FocusEvent) => {
    if (event.target === screen) stops()[0]?.focus({ preventScroll: true })
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
    const all = stops()
    const at = all.indexOf(document.activeElement as HTMLElement)
    const next = all[event.key === 'ArrowDown' ? Math.min(all.length - 1, at + 1) : Math.max(0, at - 1)]
    next?.focus()
    next?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    event.preventDefault()
  }

  screen?.addEventListener('focus', onScreenFocus)
  element.addEventListener('keydown', onKeyDown)
  // A screen that loads on demand mounts after the frame has focused its section, so that focus event was
  // missed: land on the first control now.
  if (screen && document.activeElement === screen) stops()[0]?.focus({ preventScroll: true })
  return () => {
    screen?.removeEventListener('focus', onScreenFocus)
    element.removeEventListener('keydown', onKeyDown)
  }
}
