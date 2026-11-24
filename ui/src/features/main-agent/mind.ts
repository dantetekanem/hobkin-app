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
  screenReturn: ScreenId | null
  openAgent: string | null
  previewReturn: ScreenId | null
}

const placeOf = ({ screen, settingsReturn, screenReturn, openAgent, previewReturn }: Place): Place => ({ screen, settingsReturn, screenReturn, openAgent, previewReturn })

/** The first screen of the menu, for a mind with no way back, as after a reload. */
const FALLBACK: ScreenId = 'reports'

/**
 * Opening the mind. It comes in from the chat's side, where it is drawn from. Opened from a screen that sits over the
 * mind (Settings, an agent being previewed or an integration's screen opened from it) it keeps the way back it had.
 */
export function intoMind(view: Place, back: Place | null) {
  const over = [view.settingsReturn, view.previewReturn, view.screenReturn].includes('mind')
  return {
    view: { screen: 'mind', settingsReturn: null, previewReturn: null, screenMotion: { axis: 'x', direction: -1 } } as const,
    back: over && back ? back : placeOf(view),
  }
}

/** Leaving the mind: the canvas as it was, coming back from the other side. */
export function outOfMind(back: Place | null) {
  return { ...(back ?? { screen: FALLBACK, settingsReturn: null, screenReturn: null, openAgent: null, previewReturn: null }), screenMotion: { axis: 'x', direction: 1 } as const }
}

/**
 * When the main agent last did something, to count its quiet from: its last step (when the window saw it, or saw its
 * call end), or its turn's start when that came later. Undefined with nothing to count from.
 */
export function quietSince(lastStep: number | undefined, turnStart: number | null): number | undefined {
  if (lastStep === undefined) return turnStart ?? undefined
  return turnStart === null ? lastStep : Math.max(lastStep, turnStart)
}

/**
 * What the mind says between steps, as an agent's canvas does: what hobkin is doing and, from two seconds on, for how
 * long, in seconds under a minute and then minutes and seconds. Never a time below zero.
 */
export function quietLine(word: string, since: number | undefined, now: number): string {
  const lead = word.charAt(0).toUpperCase() + word.slice(1)
  const seconds = since === undefined ? 0 : Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 2) return lead
  return `${lead} · ${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`}`
}
