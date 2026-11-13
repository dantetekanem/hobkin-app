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
