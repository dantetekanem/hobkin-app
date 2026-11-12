import { Dialog } from '@base-ui/react/dialog'
import { useEffect, useState, type ReactNode } from 'react'
import type { ParentPerformance } from '#shared/protocol/snapshot.ts'
import { useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { useTheme } from '@/app/theme.ts'
import { useHost } from '@/lib/host/hooks.ts'
import { performanceStats, projectTelemetry } from './nerd-stats-data.ts'
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

/** Only the mounted, open content subscribes to telemetry and measures the window. */
export function NerdStats() {
  const [open, setOpen] = useState(false)
  const still = useStill()
  const fade = still ? '' : 'transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0'
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={<Button variant="ghost" size="sm" />} data-stop="">Nerd stats</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className={`fixed inset-0 z-50 bg-scrim ${fade}`} />
        <Dialog.Popup className={`fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[min(800px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl bg-background shadow-float outline-none ${fade}`}>
          <header className="flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-3">
            <Dialog.Title className="text-lg font-semibold">Nerd stats</Dialog.Title>
            <Dialog.Close render={<Button variant="ghost" size="sm" />}>Close</Dialog.Close>
          </header>
          <Dialog.Description className="px-6 pb-3 text-xs text-muted-foreground">
            Last-reported own-run usage, not billed cost or daily totals. First output is observer-side delay, not provider-wire TTFT.
          </Dialog.Description>
          {open ? <StatsContent /> : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function StatsContent() {
  const frames = useFrames()
  const now = useEverySecond()
  const theme = useTheme()
  const typeFace = useSettings((state) => state.typeFace)
  const movement = useSettings((state) => state.movement)
  const link = useHost((state) => state.link)
  const snapshot = useHost((state) => state.snapshot)
  const view = projectTelemetry({ link, snapshot })
  const telemetry = view.telemetry
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return (
    <div className="min-h-0 overflow-y-auto px-6 pb-6 text-xs [overflow-wrap:anywhere]">
      <dl className="space-y-2 font-mono">
        <Stat name="Link">{view.link} · telemetry always {view.freshness}, as of {view.asOf}</Stat>
        <Stat name="Provenance">Home/epoch association unavailable; retained facts may precede the current connection.</Stat>
        {telemetry ? <>
          <Stat name="Reported state">{telemetry.connection} · {telemetry.stale ? 'stale' : 'not marked stale'} · scope {telemetry.scope}</Stat>
          <Stat name="Helpers">{telemetry.helpers === 'unavailable' ? 'capability unavailable' : 'owned helper records'}</Stat>
          <Stat name="Retention">
            Bounded history: up to {telemetry.retention.maxRuns} runs, {telemetry.retention.maxHelpersPerRun ?? 'unknown'} helpers/run,
            {' '}{telemetry.retention.maxEventKeys ?? 'unknown'} event keys, {telemetry.retention.eventMonthFiles} month files,
            {' '}{telemetry.retention.eventTailBytesPerFile} bytes/file. Events {telemetry.retention.eventReadState};
            {' '}{telemetry.retention.eventTailTruncated ? 'tail truncated' : 'tail not marked truncated'}.
          </Stat>
        </> : <Stat name="Telemetry">unavailable · no report from this host</Stat>}
      </dl>
      {telemetry?.runs.length === 0 ? <p className="mt-4">No retained run records; not a zero-usage total.</p> : null}
      {telemetry?.runs.map((run) => (
        <section key={run.runId} className="mt-4 rounded-2xl bg-surface p-4">
          <h3 className="font-semibold">{run.kind} · {run.runId}</h3>
          <p className="mt-1 text-muted-foreground">Session {run.sessionId ?? 'unavailable'} · {run.status} · {run.source}</p>
          <OwnPerformance value={run.performance} />
          {telemetry.helpers === 'owned' && !run.helpers?.length ? <p className="mt-2">No retained helpers for this run.</p> : null}
          {run.helpers?.map((helper) => (
            <section key={helper.id} className="mt-3 border-l border-border pl-3">
              <h4 className="font-semibold">Helper · {helper.id}</h4>
              <p className="text-muted-foreground">Parent {helper.parentId} · root {helper.rootId} · depth {helper.depth}</p>
              <p className="text-muted-foreground">Session {helper.sessionId ?? 'unavailable'} · {helper.status} · {helper.source}</p>
              <OwnPerformance value={helper.performance} />
            </section>
          ))}
        </section>
      ))}
      <h3 className="mt-5 mb-2 font-semibold">Window-local measurements</h3>
      <dl className="space-y-2 font-mono">
        <Stat name="About">hobkin {__HOBKIN_VERSION__}, core {__HOBKIN_CORE_VERSION__}, {import.meta.env.DEV ? 'development' : 'release'}, {inMacWindow ? 'Mac window' : 'browser tab'}</Stat>
        <Stat name="Frames">{frames.fps ? `${frames.fps} fps, slowest ${frames.slowest} ms` : 'measuring'}</Stat>
        <Stat name="Window">{innerWidth} x {innerHeight} at {devicePixelRatio}x</Stat>
        <Stat name="Looks">{theme}, {typeFace}, movement {movement}</Stat>
        <Stat name="Open for">{duration(now - openedAt)}</Stat>
        <Stat name="Script heap">{memory ? `${Math.round(memory.usedJSHeapSize / 1_048_576)} MB` : 'unavailable'}</Stat>
      </dl>
    </div>
  )
}

function OwnPerformance({ value }: { value: ParentPerformance | null }) {
  const stats = performanceStats(value)
  if (!stats) return <p className="mt-2">Own performance unavailable.</p>
  return (
    <>
      <p className="mt-2 text-muted-foreground">Own observed responses only · {value?.incomplete ? 'incomplete' : 'not marked incomplete'}</p>
      <dl className="mt-2 grid gap-x-6 gap-y-1 font-mono sm:grid-cols-2">
        {stats.map(([name, text]) => <Stat key={name} name={name}>{text}</Stat>)}
      </dl>
    </>
  )
}

function Stat({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}
