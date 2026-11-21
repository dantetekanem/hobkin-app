import { Dialog } from '@base-ui/react/dialog'
import { useEffect, useMemo, useState } from 'react'
import type { BackupState } from '#shared/backup/types.ts'
import type { SystemMetrics, UsageFacts } from '#shared/protocol/system.ts'
import type { HostTiers } from '#shared/tiers/tiers.ts'
import { useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { useTheme } from '@/app/theme.ts'
import { useHost } from '@/lib/host/hooks.ts'
import { runCommand } from '@/lib/host/client.ts'
import { useHasHost } from '@/lib/host/index.ts'
import { formatBytes } from './backup.ts'
import {
  backupSummary, countOf, daysSince, engineOf, formatCount, formatDate, formatDuration, formatPercent, formatUsd, refreshRate, tokenTotals,
} from './nerd-stats-data.ts'
import { useNerdStats } from './nerd-stats-store.ts'
import { useSettings } from './store.ts'
import { graphicsCard, useStyleSheetsAdded } from './window-readings.ts'

/** Frames drawn in the last second, the slowest one, and the refresh rate the gaps between frames suggest. Measured only while this is on screen. */
function useFrames(): { fps: number; slowest: number; hz: number | null } {
  const [frames, setFrames] = useState<{ fps: number; slowest: number; hz: number | null }>({ fps: 0, slowest: 0, hz: null })

  useEffect(() => {
    let count = 0
    let slowest = 0
    let last = performance.now()
    let since = last
    let request = 0
    const gaps: number[] = []
    const loop = (now: number) => {
      const gap = now - last
      slowest = Math.max(slowest, gap)
      gaps.push(gap)
      if (gaps.length > 120) gaps.shift()
      last = now
      count += 1
      if (now - since >= 1000) {
        setFrames({ fps: Math.round((count * 1000) / (now - since)), slowest: Math.round(slowest * 10) / 10, hz: refreshRate(gaps) })
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

const media = (query: string): boolean => matchMedia(query).matches

/** The button in Settings. It only opens the panel, which the frame mounts once. */
export function NerdStats() {
  return <Button variant="ghost" size="sm" data-stop="" onClick={() => useNerdStats.getState().setOpen(true)}>Nerd stats</Button>
}

/**
 * The panel, mounted once with the app's other overlays. Solid, so nothing behind it shows through, 80% of the window
 * wide and 60% tall. Only the open content reads the machine and measures the window.
 */
export function NerdStatsPanel() {
  const open = useNerdStats((state) => state.open)
  const setOpen = useNerdStats((state) => state.setOpen)
  const still = useStill()
  const fade = still ? '' : 'transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0'
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={`fixed inset-0 z-50 bg-scrim ${fade}`} />
        <Dialog.Popup
          className={`fixed top-1/2 left-1/2 z-50 flex h-[60vh] w-[80vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl bg-popover text-popover-foreground shadow-float outline-none ${fade}`}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-3">
            <Dialog.Title className="text-lg font-semibold">Nerd stats</Dialog.Title>
            <Dialog.Close render={<Button variant="ghost" size="sm" />}>Close</Dialog.Close>
          </header>
          {open ? <StatsContent /> : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** The host answers; a missing answer shows as a dash rather than a guess. */
function useHostReading<T>(read: () => Promise<T>, everyMs: number | null): T | null {
  const hasHost = useHasHost()
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    if (!hasHost) return
    let live = true
    const refresh = () => void read().then((next) => live && setValue(next), () => {})
    refresh()
    const timer = everyMs ? setInterval(refresh, everyMs) : null
    return () => {
      live = false
      if (timer) clearInterval(timer)
    }
    // `read` is a stable module-level call per use.
  }, [hasHost, everyMs]) // eslint-disable-line react-hooks/exhaustive-deps
  return value
}

const readMetrics = (): Promise<SystemMetrics> => runCommand('system.metrics')
const readFacts = (): Promise<UsageFacts> => runCommand('usage.facts')
const readBackups = (): Promise<BackupState> => runCommand('backup.list')
const readTiers = (): Promise<HostTiers> => runCommand('tiers.read')

type Row = [label: string, value: string, note?: string]
const DASH = '—'
const when = (at: number | null) => (at === null ? DASH : new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))
const maybe = <T,>(value: T | null | undefined, show: (value: T) => string): string => (value === null || value === undefined ? DASH : show(value))
const count = (value: number | null) => maybe(value, String)

function StatsContent() {
  const frames = useFrames()
  const now = useEverySecond()
  const theme = useTheme()
  const typeFace = useSettings((state) => state.typeFace)
  const movement = useSettings((state) => state.movement)
  const snapshot = useHost((state) => state.snapshot)
  const work = useHost((state) => state.work)
  const integrations = useHost((state) => state.integrations)
  const metrics = useHostReading(readMetrics, 2000)
  const facts = useHostReading(readFacts, null)
  const backups = useHostReading(readBackups, 15_000)
  const tiers = useHostReading(readTiers, null)
  const card = useMemo(() => graphicsCard(), [])
  const sheetsAdded = useStyleSheetsAdded()
  const tokens = tokenTotals(snapshot.telemetry)
  const saved = backups ? backupSummary(backups.backups) : null
  const runs = snapshot.runs ?? []
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: 'hobkin',
      rows: [
        ['Memory (hobkin)', maybe(metrics, (m) => formatBytes(m.host.rssBytes)), 'host process resident memory'],
        ['Disk (hobkin data)', maybe(facts?.homeBytes, formatBytes), 'size of the hobkin home'],
        ['Disk (backups)', maybe(facts?.backupsBytes, formatBytes), 'size of the backups folder'],
        ['Host process', maybe(metrics, (m) => `pid ${m.host.pid} · up ${formatDuration(m.host.uptimeSeconds)}`)],
        ['Node', maybe(metrics, (m) => m.host.node)],
        ['First login', formatDate(facts?.firstLoginAt ?? null)],
        ['Days since first login', count(daysSince(facts?.firstLoginAt ?? null, now))],
        ['Conversations started', count(facts?.conversations ?? null), 'all-time, including reset ones'],
        ['Reports', count(countOf(snapshot.reports))],
        ['Routines', count(countOf(snapshot.schedules))],
        ['Work projects', count(work ? work.projects.length : null)],
        ['Work queue', count(work ? work.queued : null)],
        ['Integrations', count(integrations ? integrations.servers.length : null), 'MCP servers'],
        ['Agents running now', String(runs.filter((run) => run.state === 'running').length)],
        ['Open decisions', count(countOf(snapshot.decisions))],
        ['Model', snapshot.main ? `${snapshot.main.model} · ${snapshot.main.effort}` : DASH],
        ['Tiers', tiers ? Object.entries(tiers.tiers).map(([id, tier]) => `${id} ${tier.model ?? 'default'}`).join(' · ') : DASH],
      ],
    },
    {
      title: 'Tokens and cost (recent runs, up to the last 100)',
      rows: [
        ['Total tokens', maybe(tokens, (t) => formatCount(t.total))],
        ['Input', maybe(tokens, (t) => formatCount(t.input))],
        ['Output', maybe(tokens, (t) => formatCount(t.output))],
        ['Cache read', maybe(tokens, (t) => formatCount(t.cacheRead))],
        ['Cache write', maybe(tokens, (t) => formatCount(t.cacheWrite))],
        ['Estimated cost', maybe(tokens, (t) => formatUsd(t.costUsd)), 'estimate, not an invoice'],
        ['Runs', maybe(tokens, (t) => String(t.runs))],
        ['Responses', maybe(tokens, (t) => formatCount(t.responses))],
      ],
    },
    {
      title: 'Backups',
      rows: [
        ['Backups', maybe(saved, (s) => String(s.count))],
        ['Total size', maybe(saved, (s) => formatBytes(s.bytes))],
        ['Last backup', maybe(saved, (s) => when(s.newest))],
        ['Oldest backup', maybe(saved, (s) => when(s.oldest))],
        ['Schedule', maybe(backups, (b) => (b.config.enabled ? `${b.config.cadence}, keeps ${b.config.limit}` : `off, keeps ${b.config.limit}`))],
      ],
    },
    {
      title: 'System',
      rows: [
        ['CPU temperature', DASH, 'unavailable on macOS without extra tooling'],
        ['CPU usage', formatPercent(metrics?.cpuPercent ?? null)],
        ['CPU', maybe(metrics, (m) => `${m.cpu.model} · ${m.cpu.cores} cores · ${m.cpu.arch}`)],
        ['Load average', maybe(metrics, (m) => m.loadAverage.map((n) => n.toFixed(2)).join('  ')), '1, 5 and 15 minutes'],
        ['Memory (system)', maybe(metrics, (m) => `${formatBytes(m.memory.usedBytes)} of ${formatBytes(m.memory.totalBytes)}`)],
        ['Swap', maybe(metrics?.swap, (s) => `${formatBytes(s.usedBytes)} of ${formatBytes(s.totalBytes)}`)],
        ['Disk (volume)', maybe(metrics?.disk, (d) => `${formatBytes(d.totalBytes - d.usedBytes)} free of ${formatBytes(d.totalBytes)}`)],
        ['Battery', metrics ? maybe(metrics.battery, (b) => `${b.percent}%${b.charging ? ' · plugged in' : ''}`) : DASH],
        ['System', maybe(metrics, (m) => m.os)],
        ['System uptime', maybe(metrics, (m) => formatDuration(m.uptimeSeconds))],
      ],
    },
    {
      title: 'This window',
      rows: [
        ['hobkin', `${__HOBKIN_VERSION__} · core ${__HOBKIN_CORE_VERSION__}`, `${import.meta.env.DEV ? 'development' : 'release'}, ${inMacWindow ? 'Mac window' : 'browser tab'}`],
        ['Frames per second', frames.fps ? String(frames.fps) : DASH, frames.fps ? `slowest frame ${frames.slowest} ms` : undefined],
        ['Refresh rate', maybe(frames.hz, (hz) => `${hz} Hz`), 'estimated'],
        ['Viewport', `${innerWidth} × ${innerHeight}`],
        ['Screen', `${screen.width} × ${screen.height}`, `${devicePixelRatio}x · ${screen.colorDepth}-bit`],
        ['Graphics', card],
        ['Style sheets added', String(sheetsAdded), 'since this opened'],
        ['Engine', engineOf(navigator.userAgent)],
        ['Script heap', maybe(heap, (h) => `${Math.round(h.usedJSHeapSize / 1_048_576)} MB`)],
        ['Open for', formatDuration((now - openedAt) / 1000)],
        ['Look', `${theme} · ${typeFace} · movement ${movement}`],
        ['System appearance', `${media('(prefers-color-scheme: dark)') ? 'dark' : 'light'}${media('(prefers-reduced-motion: reduce)') ? ' · reduced motion' : ''}`],
        ['Network', `${navigator.onLine ? 'online' : 'offline'}`, connection?.effectiveType ? `${connection.effectiveType}${connection.downlink ? ` · ${connection.downlink} Mbit/s` : ''}` : undefined],
        ['Locale', `${navigator.language} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`],
      ],
    },
  ]

  return (
    <div className="grid min-h-0 flex-1 auto-cols-[minmax(240px,1fr)] grid-flow-col gap-x-6 overflow-auto px-6 pb-6">
      {groups.map((group) => (
        <section key={group.title} className="min-w-0">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">{group.title}</h3>
          <dl className="text-[13px] leading-5">
            {group.rows.map(([label, value, note]) => (
              <div key={label} className="py-1">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-mono tabular-nums [overflow-wrap:anywhere]">
                  {value}
                  {note ? <span className="ml-2 font-sans text-xs text-muted-foreground">{note}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
