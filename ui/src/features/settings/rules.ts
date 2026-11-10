/** The rules behind the Settings tiles, apart from the page so they can be tested alone. See _specs/020-settings. */

/** How many agents work mode may run together. hobkin's own limits (`src/cli/work/store.mjs`). */
export const AGENTS = { min: 1, max: 8, initial: 2 } as const

/** Tokens work mode may spend in a day. hobkin's default is 100M. */
export const BUDGET = { min: 10_000_000, max: 200_000_000, step: 10_000_000, initial: 100_000_000 } as const

export function stepAgents(current: number, delta: -1 | 0 | 1): number {
  return Math.min(AGENTS.max, Math.max(AGENTS.min, Math.round(current) + delta))
}

/** Moves the budget by whole steps. A value between steps snaps to the nearest one first. */
export function stepBudget(current: number, delta: -1 | 0 | 1): number {
  const steps = Math.round((current - BUDGET.min) / BUDGET.step) + delta
  return Math.min(BUDGET.max, Math.max(BUDGET.min, BUDGET.min + steps * BUDGET.step))
}

/** 100000000 becomes "100M". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(1))}K`
  return String(tokens)
}
