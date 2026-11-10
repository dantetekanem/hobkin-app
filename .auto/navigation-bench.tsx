import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MotionConfig } from 'motion/react'
import { Canvas } from '../ui/src/app/Canvas.tsx'
import { useFrameKeys } from '../ui/src/app/keys.ts'
import { useView } from '../ui/src/app/view-store.ts'
import { useSettings } from '../ui/src/features/settings/store.ts'
import { useReports } from '../ui/src/features/reports/store.ts'
import { createInbox } from '../ui/src/features/reports/inbox.ts'
import { useRoutines } from '../ui/src/features/routines/store.ts'
import type { Routine, RoutinesData } from '../ui/src/features/routines/types.ts'
import { hostStore } from '../ui/src/lib/host/client.ts'
import { initialHostState } from '../ui/src/lib/host/state.ts'
import '../ui/src/styles/globals.css'

const moduleReadyAt = performance.now()
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function routines(count: number, holdout: boolean): RoutinesData {
  const zones = holdout ? ['Australia/Lord_Howe', 'Asia/Kathmandu', 'Pacific/Auckland'] : ['America/Toronto', 'Europe/Berlin', 'America/Los_Angeles']
  const rows: Routine[] = Array.from({ length: count }, (_, index) => ({
    id: `scheduled-${index}`, title: `${holdout ? 'Follow-up' : 'Project check'} ${index}`,
    path: `/synthetic/routines/${index}.md`, prompt: `Read the current status of project ${index}.`,
    harness: 'pi', model: null, effort: 'low', cwd: '/synthetic', context: [],
    timezone: zones[index % zones.length]!, enabled: index % 13 !== 12,
    cadence: index % 8 < 2 ? 'daily' : index % 8 < 7 ? 'weekly' : 'monthly',
    weekday: index % 7, day: index % 28 + 1,
    ...(holdout && index % 7 === 0
      ? { window: { start: '08:00', end: '17:00', everyMinutes: 45 } }
      : { at: `${String(6 + index % 15).padStart(2, '0')}:${index % 2 ? '15' : '45'}` }),
    nextRun: { state: index % 13 === 12 ? 'off' : 'on', at: new Date(Date.now() + (index + 1) * 3600000).toISOString() },
  }))
  return { routines: rows, errors: [], logs: {}, memory: {}, reports: {}, running: {}, changedAt: {}, templates: [] }
}

function seed(reportCount: number, routineCount: number, holdout: boolean) {
  hostStore.setState({ ...initialHostState, link: 'lost', home: '/synthetic-navigation' }, true)
  const now = Date.now()
  const reports = Array.from({ length: reportCount }, (_, index) => ({
    id: `report-${index}`, title: `${index % 2 ? 'Build' : 'Review'} ${index}`,
    at: new Date(now - index * 3600000).toISOString(), scheduleId: `daily-${index % 9}`, outcome: 'completed',
    body: `${index % 4 ? 'Useful: Changes need a look.' : 'Nothing new.'}\n\n## ${holdout ? 'Delivery' : 'Project'} ${index}\n\n- Read the diff\n- Check **the result**\n\n${'A different detail. '.repeat(index % 15)}`,
  }))
  useReports.setState({ sample: false, inbox: createInbox(reports), kind: 'all', title: '', openId: null })
  useRoutines.setState({ data: routines(routineCount, holdout), sample: null, view: 'all', openId: null, openFrom: null, lit: null })
  useView.setState({ screen: 'reports', screenMotion: { axis: 'x', direction: 1 }, veil: null, canvasEngaged: false, openAgent: null, openReview: null })
}

function NavigationFrame({ still }: { still: boolean }) {
  useFrameKeys()
  return <MotionConfig reducedMotion={still ? 'always' : 'never'}>
    <div className="flex h-full w-full">
      <div data-chat-side style={{ width: 420, flexShrink: 0 }}><textarea aria-label="Benchmark composer" /></div>
      <Canvas />
    </div>
  </MotionConfig>
}

const sections = () => [...document.querySelectorAll<HTMLElement>('[data-canvas-screen]')]
const rowSelector = (screen: string) => screen === 'routines' ? '[data-anchor^="routine-"]' : '[data-report-row]'

async function tab(to: 'reports' | 'routines', count: number, still: boolean) {
  const outgoing = sections().at(-1)!
  outgoing.focus()
  await frame()
  const start = performance.now()
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: to === 'reports', bubbles: true, cancelable: true })
  outgoing.dispatchEvent(event)
  const dispatch = performance.now() - start
  assert(event.defaultPrevented && useView.getState().screen === to, `actual keyboard map opens ${to}`)
  const samples: { elapsed: number; x: number; opacity: number }[] = []
  const gaps: number[] = []
  let previous = start
  let present: number | null = null
  let sawContent = false
  let sawOutgoing = false
  let incoming: HTMLElement | undefined
  // Keep the same observation window: do not end early when optimized code finishes mounting sooner.
  while (performance.now() - start < 1250) {
    await frame()
    const now = performance.now()
    gaps.push(now - previous)
    previous = now
    incoming = sections().find((section) => section !== outgoing)
    sawOutgoing ||= outgoing.isConnected && incoming !== undefined
    if (incoming?.querySelector(rowSelector(to))) {
      // The second rAF after content exists leaves a paint opportunity, not just a synchronous DOM commit.
      if (sawContent && present === null) present = now - start
      sawContent = true
      const style = getComputedStyle(incoming)
      samples.push({ elapsed: now - start, x: new DOMMatrixReadOnly(style.transform).m41, opacity: Number(style.opacity) })
    }
  }
  assert(present !== null && incoming, `${to} reached a paint opportunity`)
  assert(incoming!.querySelectorAll(rowSelector(to)).length === count, `all ${count} ${to} rows remain rendered`)
  assert(incoming!.contains(document.activeElement), 'Tab transfers focus into the incoming canvas')
  assert(sawOutgoing && !outgoing.isConnected && sections().length === 1, 'outgoing screen survives its exit, then unmounts')
  const first = samples[0]!
  const last = samples.at(-1)!
  if (!still) {
    assert(samples.some((sample) => Math.abs(sample.x) > 8), `${to} travels horizontally`)
    assert(samples.some((sample) => Math.abs(sample.x) > 1 && Math.abs(sample.x) < 600), `${to} has intermediate travel frames`)
  }
  assert(Math.abs(last.x) < 1 && last.opacity > 0.99, `${to} finishes its screen transition`)
  return { to, present: present!, dispatch, maxGap: Math.max(...gaps), slowFrames: gaps.filter((gap) => gap > 34).length, first, last, frames: samples.length }
}

async function verifyWeek() {
  const input = document.querySelector<HTMLTextAreaElement>('[data-chat-side] textarea')!
  input.focus()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  await pause(1400)
  flushSync(() => useRoutines.getState().setView('week'))
  await pause(1400)
  assert(document.querySelectorAll('[data-anchor^="entry-"]').length > 0, 'week view still renders scheduled occurrences')
  flushSync(() => useRoutines.getState().setView('all'))
  await pause(1400)
  assert(document.querySelectorAll('[data-anchor^="routine-"]').length === useRoutines.getState().data.routines.length, 'returning from week restores every routine')
}

async function runBenchmark(holdout = false) {
  useSettings.setState({ motion: holdout ? 'still' : 'lively' })
  const container = document.getElementById('app')!
  container.style.width = holdout ? '1160px' : '1400px'
  const cases = holdout ? [[63, 11], [257, 31], [437, 53]] : [[48, 8], [464, 24], [512, 48]]
  const results = []
  let maxNodes = 0
  for (const [reportCount, routineCount] of cases) {
    seed(reportCount!, routineCount!, holdout)
    const root = createRoot(container)
    const mountStart = performance.now()
    flushSync(() => root.render(<NavigationFrame still={holdout} />))
    while (!document.querySelector('[data-report-row]')) {
      assert(performance.now() - mountStart < 10000, 'initial Reports appears')
      await frame()
    }
    await frame()
    await frame()
    const initialReports = performance.now() - mountStart
    await pause(1600)
    assert(document.querySelectorAll('[data-report-row]').length === reportCount, 'initial Reports populated')
    const visits = []
    for (let repeat = 0; repeat < 3; repeat++) {
      visits.push(await tab('routines', routineCount!, holdout))
      visits.push(await tab('reports', reportCount!, holdout))
      maxNodes = Math.max(maxNodes, container.querySelectorAll('*').length)
    }
    results.push({ reportCount, routineCount, initialReports, visits })
    if (routineCount === cases.at(-1)![1]) await verifyWeek()
    flushSync(() => root.unmount())
    await frame()
  }
  const routinesMs = results.reduce((sum, result) => sum + median(result.visits.filter((visit) => visit.to === 'routines').map((visit) => visit.present)), 0)
  const reportsMs = results.reduce((sum, result) => sum + median(result.visits.filter((visit) => visit.to === 'reports').map((visit) => visit.present)), 0)
  const visits = results.flatMap((result) => result.visits)
  const firstRoutines = results[0]!.visits[0]!.present
  return {
    metrics: {
      navigation_ms: routinesMs + reportsMs + firstRoutines,
      tab_present_ms: routinesMs + reportsMs, first_routines_ms: firstRoutines,
      module_ready_ms: moduleReadyAt, initial_reports_ms: results[0]!.initialReports,
      to_routines_ms: routinesMs, to_reports_ms: reportsMs,
      max_frame_gap_ms: Math.max(...visits.map((visit) => visit.maxGap)), slow_frames: visits.reduce((sum, visit) => sum + visit.slowFrames, 0), max_dom_nodes: maxNodes,
    },
    results, holdout, userAgent: navigator.userAgent,
    motionChecks: ['actual Tab/Shift+Tab routing', 'focus transfer', 'outgoing screen retained during exit', ...(holdout ? [] : ['screen travel and intermediate frames']), 'settled screen geometry', 'complete row counts', 'week and all views'],
  }
}
Object.assign(window, { runBenchmark })
