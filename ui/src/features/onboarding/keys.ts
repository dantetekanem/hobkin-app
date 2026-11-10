/**
 * The setup's keys, as a function with no knowledge of the page. While the setup is open it owns the keyboard:
 * Enter goes on, Escape and Left go back, Up and Down move between the step's controls. A control that uses a key
 * itself keeps it. See _specs/025-onboarding.
 */

export interface SetupPress {
  key: string
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

/** What the control that has the keyboard does with keys itself. */
export interface SetupKeyContext {
  /** A text field: Enter sends it and Left moves the caret. */
  typing: boolean
  /** A button or a link: Enter presses it. */
  pressable: boolean
  /** A choice, such as a row of options: Left and Right change it. */
  sideways: boolean
  /** A list that walks itself with Up and Down. */
  walks: boolean
  /** A sign-in is under way. Escape stops it before it goes back. */
  signingIn: boolean
}

export type SetupKey = { do: 'next' } | { do: 'back' } | { do: 'cancel-signin' } | { do: 'move'; delta: 1 | -1 }

/** What the setup does for a key, or null when the key is the control's own, or nobody's. */
export function resolveSetupKey(press: SetupPress, context: SetupKeyContext): SetupKey | null {
  if (press.meta || press.ctrl || press.alt) return null
  switch (press.key) {
    case 'Enter':
      return press.shift || context.typing || context.pressable ? null : { do: 'next' }
    case 'Escape':
      return context.signingIn ? { do: 'cancel-signin' } : { do: 'back' }
    case 'ArrowLeft':
      return press.shift || context.typing || context.sideways ? null : { do: 'back' }
    case 'ArrowDown':
      return press.shift || context.walks ? null : { do: 'move', delta: 1 }
    case 'ArrowUp':
      return press.shift || context.walks ? null : { do: 'move', delta: -1 }
    default:
      return null
  }
}
