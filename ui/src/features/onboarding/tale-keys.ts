import type { Ask } from './story.ts'

/**
 * The story's keys, as a function with no knowledge of the page. While the setup is open it owns the keyboard:
 * Enter, Space and Right go on, Escape and Left go back, and with two choices up Left and Right reach for them.
 * With the routine cards up, Escape, Left and Right are the cards'. A control that uses a key itself keeps it. See _specs/025-onboarding.
 */

export interface TalePress {
  key: string
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

/** What the control that has the keyboard does with keys itself, and what the story is doing. */
export interface TaleKeyContext {
  /** A text field: Enter sends it, Space is typed, and Left and Right move the caret. */
  typing: boolean
  /** A button or a link: Enter and Space press it. */
  pressable: boolean
  /** What is being asked now, once the question's bubble is fully said. */
  asking: Ask['kind'] | null
  /** A sign-in is under way. Escape stops it before it goes back. */
  signingIn: boolean
  /** An install is running. It cannot be gone back from. */
  busy: boolean
}

export type TaleKey = { do: 'on' } | { do: 'back' } | { do: 'cancel-signin' } | { do: 'reach'; side: 'left' | 'right' }

/** What the story does for a key, or null when the key is the control's own, or nobody's. */
export function resolveTaleKey(press: TalePress, context: TaleKeyContext): TaleKey | null {
  if (press.meta || press.ctrl || press.alt) return null
  const choosing = context.asking === 'choice'
  // The routine cards move between themselves, put a card in Change back, and go back to the goal's question.
  if (context.asking === 'cards' && ['Escape', 'ArrowLeft', 'ArrowRight'].includes(press.key)) return null

  switch (press.key) {
    case 'Enter':
    case ' ':
      return press.shift || context.typing || context.pressable ? null : { do: 'on' }
    case 'Escape':
      if (context.signingIn) return { do: 'cancel-signin' }
      return context.busy ? null : { do: 'back' }
    case 'ArrowLeft':
      if (press.shift || context.typing) return null
      if (choosing) return { do: 'reach', side: 'left' }
      return context.busy ? null : { do: 'back' }
    case 'ArrowRight':
      if (press.shift || context.typing) return null
      return choosing ? { do: 'reach', side: 'right' } : { do: 'on' }
    default:
      return null
  }
}
