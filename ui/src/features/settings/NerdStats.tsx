import { useEffect, useState, type ReactNode } from 'react'
import { useTheme } from '@/app/theme.ts'
import { useHasHost } from '@/lib/host/index.ts'
import { formatTokens } from './rules.ts'
import { useSettings } from './store.ts'

/** Frames drawn in the last second, and the slowest one. Measured only while this is on screen. */
function useFrames(): { fps: number; slowest: number } {
  const [frames, setFrames] = useState({ fps: 0, slowest: 0 })

  useEffect(() => {
    let count = 0
    let slowest = 0
    let last = performance.now()
    let since = last
    let request = 0
    const loop = (now: number) => {
      slowest = Math.max(slowest, now - last)
      last = now
      count += 1
      if (now - since >= 1000) {
        setFrames({ fps: Math.round((count * 1000) / (now - since)), slowest: Math.round(slowest * 10) / 10 })
        count = 0
        slowest = 0
        since = now
      }
      request = requestAnimationFrame(loop)
    }
    request = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(request)
  }, [])

  return frames
}

function useEverySecond(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

const openedAt = Date.now()
const inMacWindow = '__TAURI_INTERNALS__' in window

function duration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

/** What hobkin's host will report. Sample values until it is connected (020-settings, S5). */
const SAMPLE = {
  tokensIn: 1_840_000,
  tokensOut: 212_000,
  tokensCached: 9_600_000,
  contextUsed: 0.41,
  contextWindow: 400_000,
  compactions: 2,
  cost: 3.12,
  runs: { done: 14, failed: 1, interrupted: 0 },
}

/**
 * Numbers for the curious: how the window is drawing, and what hobkin has spent and run today.
 * The window's own numbers are live. hobkin's are sample values, marked as such, until the host supplies them.
 */
export function NerdStats() {
  const frames = useFrames()
  const now = useEverySecond()
  const theme = useTheme()
  const typeFace = useSettings((state) => state.typeFace)
  const movement = useSettings((state) => state.movement)
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory

  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-2 font-mono text-[12px] leading-snug @max-[820px]:grid-cols-1">
      <Stat name="about">
        hobkin {__HOBKIN_VERSION__}, core {__HOBKIN_CORE_VERSION__}, {import.meta.env.DEV ? 'development' : 'release'} build, {inMacWindow ? 'Mac window' : 'browser tab'}
      </Stat>
      <Stat name="frames">
        {frames.fps ? `${frames.fps} fps, slowest ${frames.slowest} ms` : 'measuring'}
      </Stat>
      <Stat name="tokens today" sample>
        {formatTokens(SAMPLE.tokensIn)} in, {formatTokens(SAMPLE.tokensOut)} out, {formatTokens(SAMPLE.tokensCached)} cached
      </Stat>
      <Stat name="window">
        {innerWidth} x {innerHeight} at {devicePixelRatio}x
      </Stat>
      <Stat name="context" sample>
        {Math.round(SAMPLE.contextUsed * 100)}% of {formatTokens(SAMPLE.contextWindow)}, {SAMPLE.compactions} compactions
      </Stat>
      <Stat name="looks">
        {theme}, {typeFace}, movement {movement}
      </Stat>
      <Stat name="cost today" sample>
        ${SAMPLE.cost.toFixed(2)}, an estimate
      </Stat>
      <Stat name="open for">{duration(now - openedAt)}</Stat>
      <Stat name="runs today" sample>
        {SAMPLE.runs.done} done, {SAMPLE.runs.failed} failed, {SAMPLE.runs.interrupted} interrupted
      </Stat>
      {memory ? <Stat name="memory">{Math.round(memory.usedJSHeapSize / 1_048_576)} MB of script heap</Stat> : null}
      <Stat name="host">not connected</Stat>
    </dl>
  )
}

function Stat({ name, sample = false, children }: { name: string; sample?: boolean; children: ReactNode }) {
  // With a host connected, a made-up number is not shown at all.
  const hasHost = useHasHost()
  if (sample && hasHost) return null
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-[13ch] shrink-0 text-muted-foreground">{name}</dt>
      <dd className="min-w-0 flex-1 truncate">
        {children}
        {sample ? <span className="ml-2 text-muted-foreground">(sample)</span> : null}
      </dd>
    </div>
  )
}
