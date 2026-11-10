/**
 * Frame times, for the budgets in 006 A8 and 008 A9. Development only.
 */
export interface FrameStats {
  frames: number
  /** Milliseconds: the median frame, the 95th percentile and the worst. */
  median: number
  p95: number
  worst: number
  /** Share of frames under 16.7ms, 0 to 100. */
  underBudget: number
}

export const FRAME_BUDGET = 16.7

export function statsOf(deltas: readonly number[]): FrameStats {
  if (deltas.length === 0) return { frames: 0, median: 0, p95: 0, worst: 0, underBudget: 100 }
  const sorted = [...deltas].sort((a, b) => a - b)
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]!
  const round = (value: number) => Math.round(value * 10) / 10
  return {
    frames: sorted.length,
    median: round(at(0.5)),
    p95: round(at(0.95)),
    worst: round(sorted.at(-1)!),
    underBudget: round((sorted.filter((delta) => delta <= FRAME_BUDGET).length / sorted.length) * 100),
  }
}

/** Calls `onFrame` every frame for `ms` milliseconds with progress 0 to 1, and returns the time each frame took. */
export function recordFrames(ms: number, onFrame: (progress: number) => void): Promise<FrameStats> {
  return new Promise((resolve) => {
    const deltas: number[] = []
    const started = performance.now()
    let previous = started
    const tick = (now: number) => {
      const elapsed = now - started
      if (now > previous) deltas.push(now - previous)
      previous = now
      if (elapsed >= ms) return resolve(statsOf(deltas))
      onFrame(elapsed / ms)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame((now) => {
      previous = now
      requestAnimationFrame(tick)
    })
  })
}
