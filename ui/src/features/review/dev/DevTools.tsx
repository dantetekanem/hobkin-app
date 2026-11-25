import { useReactFlow } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { boundsOf, nodeRect } from '#shared/review/layout.ts'
import { useView } from '@/app/view-store.ts'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { useSession } from '../state/context.tsx'
import { useDev, useTimings } from './dev.ts'
import { FRAME_BUDGET, recordFrames, statsOf, type FrameStats } from './frames.ts'

declare global {
  interface Window {
    /** Development only: measurements the review screen can take of itself. */
    __reviewDev?: { panTest(ms?: number): Promise<FrameStats>; timings(): { label: string; ms: number }[] }
  }
}

/**
 * Switches for checking the review by hand. Drawn in development builds only.
 * The system's reduced-motion setting cannot be turned on from the page, so there is a switch for it here.
 */
export function DevTools({ onReplay }: { onReplay: () => void }) {
  const dev = useDev()
  const flow = useReactFlow()
  const nodes = useSession((session) => session.view.nodes)
  const reviewId = useSession((session) => session.review.id)
  const openReviewFor = useView((view) => view.openReviewFor)
  const timings = useTimings((state) => state.timings)
  const [pan, setPan] = useState<FrameStats | 'running' | null>(null)
  const latest = useRef(nodes)
  latest.current = nodes

  useEffect(() => {
    /** Pans across the whole graph and back for three seconds, as a hand would, and times every frame. */
    const panTest = async (ms = 3000) => {
      const start = flow.getViewport()
      const box = boundsOf(latest.current.map((node) => nodeRect(node.kind, node.position)))
      const reach = { x: Math.min(box.width * start.zoom * 0.5, 900), y: Math.min(box.height * start.zoom * 0.3, 300) }
      setPan('running')
      const stats = await recordFrames(ms, (progress) => {
        const turn = progress * Math.PI * 4
        void flow.setViewport({ x: start.x + Math.sin(turn) * reach.x, y: start.y + Math.sin(turn * 0.5) * reach.y, zoom: start.zoom })
      })
      void flow.setViewport(start)
      setPan(stats)
      return stats
    }
    window.__reviewDev = { panTest, timings: () => useTimings.getState().timings }
    return () => {
      delete window.__reviewDev
    }
  }, [flow])

  return (
    <>
      <Popover>
        {/* Solid, so it reads the same over whatever the review shows under it (the user, 2026-11-25). */}
        <PopoverTrigger className="absolute top-3.5 right-3.5 z-40 h-6 rounded-full border border-border bg-card px-2 font-mono text-[10.5px] text-foreground shadow-xs" aria-label="Development switches">
          dev
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="rv-float w-[300px] gap-3 rounded-[18px] p-4 text-[13px] ring-0">
          <Row label="Reduced motion">
            <Switch checked={dev.reducedMotion} onCheckedChange={(reducedMotion) => dev.set({ reducedMotion })} aria-label="Reduced motion" />
          </Row>
          <Row label="Blur what is out of focus">
            <Switch checked={dev.treatment === 'blur'} onCheckedChange={(blur) => dev.set({ treatment: blur ? 'blur' : 'fade' })} aria-label="Blur what is out of focus" />
          </Row>
          <Row label="Frame times">
            <Switch checked={dev.frameMeter} onCheckedChange={(frameMeter) => dev.set({ frameMeter })} aria-label="Frame times" />
          </Row>
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <DevButton onClick={() => openReviewFor(reviewId === 'stress' ? 'sample' : 'stress')}>{reviewId === 'stress' ? 'Open the sample' : 'Open the 80 node review'}</DevButton>
            <DevButton onClick={() => openReviewFor(reviewId === 'large' ? 'sample' : 'large')}>{reviewId === 'large' ? 'Open the sample' : 'Open the 200 file review'}</DevButton>
            <DevButton onClick={onReplay}>Replay the entrance</DevButton>
            <DevButton onClick={() => void window.__reviewDev?.panTest()}>Pan for 3 seconds</DevButton>
          </div>
          {pan === 'running' ? <p className="text-muted-foreground">Panning…</p> : pan ? <Stats title="Pan" stats={pan} /> : null}
          {timings.length > 0 ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-border pt-3 font-mono text-[11.5px]">
              {timings.map((timing) => (
                <div key={timing.label} className="contents">
                  <dt className="text-muted-foreground">{timing.label}</dt>
                  <dd>{timing.ms}ms</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </PopoverContent>
      </Popover>
      {dev.frameMeter ? <FrameMeter /> : null}
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      {label}
      {children}
    </label>
  )
}

function DevButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full bg-secondary px-2.5 py-1 font-heading text-[12px] font-medium active:scale-[0.97]">
      {children}
    </button>
  )
}

function Stats({ title, stats }: { title: string; stats: FrameStats }) {
  return (
    <p className="font-mono text-[11.5px] leading-relaxed" data-rv-stats={title}>
      {title}: {stats.underBudget}% of {stats.frames} frames under {FRAME_BUDGET}ms
      <br />
      median {stats.median}ms, 95th {stats.p95}ms, worst {stats.worst}ms
    </p>
  )
}

/** Frame times over the last two seconds, written to the page without drawing React again. */
function FrameMeter() {
  const output = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const deltas: { at: number; took: number }[] = []
    let previous = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      deltas.push({ at: now, took: now - previous })
      previous = now
      while (deltas.length > 0 && deltas[0]!.at < now - 2000) deltas.shift()
      if (output.current && deltas.length % 12 === 0) {
        const stats = statsOf(deltas.map((delta) => delta.took))
        output.current.textContent = `${stats.underBudget}% under ${FRAME_BUDGET}ms · median ${stats.median} · 95th ${stats.p95} · worst ${stats.worst}`
      }
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  return <div ref={output} className="rv-float pointer-events-none absolute top-11 right-3.5 z-10 rounded-full px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground" />
}
