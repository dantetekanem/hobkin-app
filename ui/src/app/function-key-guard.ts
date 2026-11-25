/**
 * Apple's function keys as AppKit names them, U+F700 to U+F747: the arrows, F1 to F35, Home, End, Page Up and the rest.
 * WebKit sometimes types one into a text box as a character, as when an arrow pressed while the box is drawn again is
 * not taken as a move of the caret, and the box shows a crossed square. They are never text, so the window never lets one
 * in. A paste or a drop is the user's own and is left alone.
 */
const FUNCTION_KEYS = /[-]/
const TYPED = new Set(['insertText', 'insertCompositionText', 'insertReplacementText'])

export function typesFunctionKey({ inputType, data }: { inputType: string; data: string | null }): boolean {
  return TYPED.has(inputType) && data !== null && FUNCTION_KEYS.test(data)
}

interface Listens {
  addEventListener(name: 'beforeinput', listener: (event: Event) => void, capture: boolean): void
  removeEventListener(name: 'beforeinput', listener: (event: Event) => void, capture: boolean): void
}

/** The one guard for the page's life, kept across hot updates so each load replaces it rather than adding another. */
const SLOT = Symbol.for('hobkin.function-key-guard')
type Installed = { target: Listens; listener: (event: Event) => void }
const slots = globalThis as Record<symbol, Installed | undefined>

/** Stops a function key typed as text before any text box, input or editable takes it, on every one in the page. */
export function installFunctionKeyGuard(target: Listens): void {
  const before = slots[SLOT]
  if (before) before.target.removeEventListener('beforeinput', before.listener, true)
  const listener = (event: Event) => {
    if (typesFunctionKey(event as InputEvent)) event.preventDefault()
  }
  target.addEventListener('beforeinput', listener, true)
  slots[SLOT] = { target, listener }
}
