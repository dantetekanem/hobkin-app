/**
 * A one-shot instruction hobkin gives the window: go to a screen, open the spotlight, step back, or put words in
 * the composer so the user can send them. The window does the move; the host only holds the latest instruction and
 * tells the window. Like a theme request (`shared/protocol/appearance.ts`), a new `id` is a new instruction, so the
 * window carries out each one once and never replays one on a reconnect. See _specs/013-hobkin-access.
 */

/** The screens hobkin may send the window to by name. Only the ones the user navigates to, never a contextual one that needs a target open in it. */
export const NUDGE_SCREENS = ['home', 'reports', 'routines', 'actions', 'work', 'github', 'settings', 'integrations'] as const
export type NudgeScreen = (typeof NUDGE_SCREENS)[number]

export type NudgeAction =
  /** Open a screen, as clicking its place in the menu does. */
  | { kind: 'open'; screen: NudgeScreen }
  /** Open the spotlight (Command+K) over the window. */
  | { kind: 'spotlight' }
  /** Step back to the place before this one, as Command+Left does. */
  | { kind: 'back' }
  /** Put words in the composer without sending them, so the user can read, edit and send. */
  | { kind: 'draft'; text: string }

export interface Nudge {
  /** Goes up by one with every instruction, so the window applies each one once. */
  id: number
  action: NudgeAction
}
