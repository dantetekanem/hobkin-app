import type { RunTelemetry } from '#shared/protocol/snapshot.ts'

export const formatPercent = (value: number | null): string => (value === null ? '—' : `${Math.round(value)}%`)

/** 12345 -> "12.3k", 4_200_000 -> "4.2M". */
export function formatCount(value: number): string {
  if (value < 1000) return String(value)
  const [divisor, suffix] = value >= 1_000_000_000 ? [1e9, 'B'] : value >= 1_000_000 ? [1e6, 'M'] : [1e3, 'k']
  const scaled = value / divisor
  return `${scaled >= 100 ? Math.round(scaled) : Number(scaled.toFixed(1))}${suffix}`
}

/** "2 November 2026", or a dash when hobkin's config does not say. */
export function formatDate(iso: string | null): string {
  const at = iso ? new Date(iso) : null
  return at && !Number.isNaN(at.getTime()) ? at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
}

/** "3d 04h", "5h 07m", "12m 05s". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (days) return `${days}d ${pad(hours)}h`
  if (hours) return `${hours}h ${pad(minutes)}m`
  return `${minutes}m ${pad(total % 60)}s`
}

/** Whole days from an ISO time to now, or null when there is no time. */
export function daysSince(iso: string | null, now: number): number | null {
  const at = iso ? Date.parse(iso) : NaN
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 86_400_000)) : null
}

/** How many things a snapshot key holds, or null when the host did not send it. */
export function countOf(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null
}

/** "Chrome 131.0.6778.86" or "AppleWebKit/605.1.15" from a user agent, for the engine the window runs on. */
export function engineOf(userAgent: string): string {
  return /(Chrome|Edg|Firefox)\/([\d.]+)/.exec(userAgent)?.slice(1, 3).join(' ') ?? /AppleWebKit\/([\d.]+)/.exec(userAgent)?.[0] ?? 'unknown'
}

/** Screen refresh rate from the gaps between frames in milliseconds, snapped to the usual rates. Null with too few frames. */
export function refreshRate(gaps: readonly number[]): number | null {
  if (gaps.length < 10) return null
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0
  if (median <= 0) return null
  const hz = 1000 / median
  return [30, 48, 50, 60, 75, 90, 100, 120, 144, 165, 240].reduce((best, rate) => (Math.abs(rate - hz) < Math.abs(best - hz) ? rate : best))
}

export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  /** Estimate from observed usage, not an invoice. Null when no run estimated one. */
  costUsd: number | null
  runs: number
  responses: number
}

const plus = (sum: number, scalar: { value: number | null }) => sum + (scalar.value ?? 0)

/** Totals across the runs the host still holds (at most 100), never one run on its own. Null without telemetry. */
export function tokenTotals(telemetry: Pick<RunTelemetry, 'runs'> | null | undefined): TokenTotals | null {
  if (!telemetry) return null
  const totals: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: null, runs: telemetry.runs.length, responses: 0 }
  for (const { performance } of telemetry.runs) {
    if (!performance) continue
    totals.input = plus(totals.input, performance.input)
    totals.output = plus(totals.output, performance.output)
    totals.cacheRead = plus(totals.cacheRead, performance.cacheRead)
    totals.cacheWrite = plus(totals.cacheWrite, performance.cacheWrite)
    totals.responses += performance.responses ?? 0
    if (performance.estimatedUsd.value !== null) totals.costUsd = (totals.costUsd ?? 0) + performance.estimatedUsd.value
  }
  totals.total = totals.input + totals.output + totals.cacheRead + totals.cacheWrite
  return totals
}

export const formatUsd = (value: number | null): string => (value === null ? '—' : `$${value < 1 ? value.toFixed(3) : value.toFixed(2)}`)

/** Count, size, newest and oldest of the backups kept, from `backup.list`. */
export function backupSummary(backups: readonly { at: number; bytes: number }[]) {
  const times = backups.map((backup) => backup.at)
  return {
    count: backups.length,
    bytes: backups.reduce((sum, backup) => sum + backup.bytes, 0),
    newest: times.length ? Math.max(...times) : null,
    oldest: times.length ? Math.min(...times) : null,
  }
}
