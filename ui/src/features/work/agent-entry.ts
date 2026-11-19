/**
 * Stepping into an agent: everything that moves (the canvas, the menu's marker, the chat stepping back, the agent's
 * own pieces) rides one spring, together and without a dwell. Quicker than a screen push, and still a glide that
 * slows into place rather than a cut. Under Still it is immediate.
 */
export function agentEntry(still: boolean) {
  if (still) return { type: 'tween', duration: 0, delay: 0 } as const
  return { type: 'spring', duration: 0.32, bounce: 0, delay: 0 } as const
}

/** Content availability, not elapsed time or the entry route, decides what can be read. */
export function agentReading(available: boolean, content: boolean) {
  return available && content
}

/** Preserve every other screen's own transition. */
export function entryTransition<T>(agent: boolean, still: boolean, other: T) {
  return agent ? agentEntry(still) : other
}

/**
 * Whether a click or the keyboard in this agent's window keeps it open for good: it is the agent on screen, previewed
 * from the agents list in a walk that began on another screen (`previewReturn`) or on another agent's window
 * (`previewFrom`). The list losing the keyboard then no longer ends the preview.
 */
export function keepsPreview(view: { screen: string; openAgent: string | null; previewReturn: unknown; previewFrom: string | null }, agentId: string): boolean {
  return view.screen === 'agent' && view.openAgent === agentId && (view.previewReturn !== null || view.previewFrom !== null)
}
