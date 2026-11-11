import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { WireSnapshot } from '#shared/protocol/snapshot.ts'
import type { ScreenId } from '../../app/screens.ts'

/**
 * Hobkin's mind: its main agent, the one the chat talks to, as it works. The host sends `mainActivity`, the main
 * conversation's words and tool calls in a job's shape, never its thinking; an empty list before its first. A host
 * that sends no `mainActivity` at all is older than this view. Pure, so the rules are tested without a window.
 */

/** The main agent's steps, an empty list before its first, or null from a host too old to send them. */
export function mainActivityOf(snapshot: WireSnapshot): readonly ActivityEntry[] | null {
  return snapshot.mainActivity ?? null
}

/** Where the canvas was, so leaving the mind goes back there. */
export interface Place {
  screen: ScreenId
  settingsReturn: ScreenId | null
  githubReturn: ScreenId | null
  openAgent: string | null
  previewReturn: ScreenId | null
  agentTalk: boolean
}

const placeOf = ({ screen, settingsReturn, githubReturn, openAgent, previewReturn, agentTalk }: Place): Place => ({ screen, settingsReturn, githubReturn, openAgent, previewReturn, agentTalk })

/** The first screen of the menu, for a mind with no way back, as after a reload. */
const FALLBACK: ScreenId = 'reports'

/**
 * Opening the mind. It comes in from the chat's side, where it is drawn from. Opened from a screen that sits over the
 * mind (Settings, an agent being previewed or a GitHub opened from it) it keeps the way back it had.
 */
export function intoMind(view: Place, back: Place | null) {
  const over = [view.settingsReturn, view.previewReturn, view.githubReturn].includes('mind')
  return {
    view: { screen: 'mind', settingsReturn: null, previewReturn: null, agentTalk: false, screenMotion: { axis: 'x', direction: -1 } } as const,
    back: over && back ? back : placeOf(view),
  }
}

/** Leaving the mind: the canvas as it was, coming back from the other side. */
export function outOfMind(back: Place | null) {
  return { ...(back ?? { screen: FALLBACK, settingsReturn: null, githubReturn: null, openAgent: null, previewReturn: null, agentTalk: false }), screenMotion: { axis: 'x', direction: 1 } as const }
}
