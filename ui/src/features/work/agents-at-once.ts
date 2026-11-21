/**
 * The rules of the "Agents at once" control that Work and Settings share: how many work agents hobkin's work mode may
 * run together. The most is hobkin's own (`MAX_AGENTS` in its `src/cli/work/store.mjs`), which the host sends as
 * `maxAgents`. See _specs/011-work and _specs/020-settings.
 */

export const FEWEST_AGENTS = 1

/** Shift with an arrow moves this many at once. */
export const BIG_STEP = 10

/** A held button steps once at once, again after this long, and then at the repeat pace. */
export const HOLD_DELAY_MS = 400
export const HOLD_REPEAT_MS = 70

/** The places in the Settings tile's row of hoods. Past that many agents the last place counts the rest. */
export const HOOD_PLACES = 8

/** A whole number between one and the most. A most below one is taken as one. */
export function clampAgents(value: number, most: number): number {
  const ceiling = Math.max(FEWEST_AGENTS, Math.floor(most))
  return Math.min(ceiling, Math.max(FEWEST_AGENTS, Math.round(value)))
}

/**
 * The number a key gives, or null for a key the control leaves to the screen. Left and Right step by one, by ten with
 * Shift; + and = add one and - takes one away, whatever Shift is, because + is typed with it; Home is one and End the most.
 */
export function agentsForKey(current: number, { key, shiftKey }: { key: string; shiftKey: boolean }, most: number): number | null {
  const arrowStep = shiftKey ? BIG_STEP : 1
  if (key === 'ArrowRight') return clampAgents(current + arrowStep, most)
  if (key === 'ArrowLeft') return clampAgents(current - arrowStep, most)
  if (key === '+' || key === '=') return clampAgents(current + 1, most)
  if (key === '-') return clampAgents(current - 1, most)
  if (key === 'Home') return FEWEST_AGENTS
  if (key === 'End') return clampAgents(most, most)
  return null
}

/**
 * What the Settings tile's row draws: a hood for each agent while they fit its eight places, and past eight, seven
 * hoods and the count of the rest in the eighth, so the row is never wider than eight hoods.
 */
export function hoodRow(agents: number): { hoods: number; more: number } {
  const count = Math.max(0, Math.round(agents))
  if (count <= HOOD_PLACES) return { hoods: count, more: 0 }
  return { hoods: HOOD_PLACES - 1, more: count - (HOOD_PLACES - 1) }
}
