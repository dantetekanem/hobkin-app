import type { ParentPerformance, PerformanceScalar } from '#shared/protocol/snapshot.ts'
import type { HostState } from '@/lib/host/state.ts'

export function formatScalar(scalar: PerformanceScalar, unit: 'number' | 'usd' | 'ms' = 'number'): string {
  if (scalar.value === null) return 'unavailable'
  const value = unit === 'usd'
    ? `$${Number(scalar.value.toPrecision(6))} estimate`
    : `${scalar.value}${unit === 'ms' ? ' ms' : ''}`
  return `${value}${scalar.state === 'partial' ? ' · partial' : ''}`
}

/** Each performance object contains only this run's observed usage, never its descendants'. */
export function performanceStats(performance: ParentPerformance | null): [string, string][] | null {
  if (!performance) return null
  return [
    ['Responses', String(performance.responses ?? 'unavailable')],
    ['Input tokens', formatScalar(performance.input)],
    ['Output tokens', formatScalar(performance.output)],
    ['Cache read tokens', formatScalar(performance.cacheRead)],
    ['Cache write tokens', formatScalar(performance.cacheWrite)],
    ['Cost', formatScalar(performance.estimatedUsd, 'usd')],
    ['Response duration', formatScalar(performance.responseDurationMs, 'ms')],
    ['First observed output', performance.firstObservedOutputMs === null ? 'unavailable' : `${performance.firstObservedOutputMs} ms`],
    ['Dispatch elapsed', performance.dispatchElapsedMs === null ? 'unavailable' : `${performance.dispatchElapsedMs} ms`],
  ]
}

/** The DTO has no home/epoch identity. Even an open link cannot establish these facts as current. */
export function projectTelemetry(state: Pick<HostState, 'link' | 'snapshot'>) {
  const telemetry = state.snapshot.telemetry ?? null
  return { link: state.link, freshness: 'last-reported' as const, asOf: telemetry?.asOf ?? 'unknown time', telemetry }
}
