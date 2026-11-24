/**
 * What a change review's model calls took (spec 058, A7), kept beside the review in `usage.json` in its change
 * review's folder: one entry for each call, with the tier and model it ran on, the model's own token counts and the
 * cost when Pi gives one. `tokens` is what hobkin counts as tokens: fresh input, what was written to the cache, and the
 * output. A call whose model gave no count is kept with none, so it says it ran without guessing what it took.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A model's own count for one call, as Pi gives it on its message. */
export interface CallTokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Fresh tokens: input, cache written, and output. */
  tokens: number
  /** In US dollars, when Pi gives it. */
  cost?: number
}

/** One model call of a review. */
export interface CallUsage extends Partial<CallTokens> {
  pass: 'review' | 'checker'
  tier: string
  model: string
  /** When it answered, as an ISO time. */
  at: string
}

export const USAGE_FILE = 'usage.json'

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)

/** A model's count from the usage on its messages, summed, or null when none gave one. */
export function tokensOf(usages: readonly unknown[]): CallTokens | null {
  const given = usages.filter((usage): usage is Record<string, unknown> => usage != null && typeof usage === 'object')
  if (!given.length) return null
  const sum = (field: string) => given.reduce((total, usage) => total + count(usage[field]), 0)
  const costs = given.map((usage) => (usage.cost as { total?: unknown } | undefined)?.total).filter((cost): cost is number => typeof cost === 'number' && Number.isFinite(cost))
  const [input, output, cacheRead, cacheWrite] = [sum('input'), sum('output'), sum('cacheRead'), sum('cacheWrite')]
  return { input, output, cacheRead, cacheWrite, tokens: input + cacheWrite + output, ...(costs.length ? { cost: costs.reduce((total, cost) => total + cost, 0) } : {}) }
}

/** Every call kept beside a review, oldest first; none when the file is missing or cannot be read. */
export function readUsage(folder: string): CallUsage[] {
  try {
    const kept = JSON.parse(readFileSync(join(folder, USAGE_FILE), 'utf8')) as { calls?: unknown }
    return Array.isArray(kept.calls) ? kept.calls.filter((call): call is CallUsage => call != null && typeof call === 'object' && typeof (call as CallUsage).at === 'string') : []
  } catch {
    return []
  }
}

/** Keeps one more call beside a review, written whole so a reader never sees half of it. */
export function recordUsage(folder: string, call: CallUsage): void {
  const file = join(folder, USAGE_FILE)
  const next = `${file}.${process.pid}.next`
  writeFileSync(next, JSON.stringify({ calls: [...readUsage(folder), call] }), { mode: 0o600 })
  renameSync(next, file)
}

/** The fresh tokens a review's calls took, or null when none of them gave a count. */
export function tokensIn(folder: string): number | null {
  const counted = readUsage(folder).filter((call) => typeof call.tokens === 'number')
  return counted.length ? counted.reduce((total, call) => total + (call.tokens ?? 0), 0) : null
}
