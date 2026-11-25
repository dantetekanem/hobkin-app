import { focusInput, requestCanvasFocus } from './focus.ts'
import { keyboardHomeFor } from './key-map.ts'
import { useView } from './view-store.ts'

/**
 * Hands the keyboard home when something drawn over the window lets it go: the file viewer, a question, the tiers,
 * the spotlight. An agent's screen, a durable hobkin's too, keeps it: the message input closes an agent's screen as it
 * takes focus, so sending the keyboard there would lose the agent the user was reading.
 */
export function focusHome(): void {
  if (keyboardHomeFor(useView.getState().screen) === 'canvas') requestCanvasFocus()
  else focusInput()
}
