import { lazy, Suspense, useDeferredValue, useLayoutEffect, useState, type RefObject } from 'react'
import { PageTabs, type PageTab } from '@/features/work/PageTabs.tsx'
import type { ProofRun } from '#shared/protocol/proofs.ts'
import { keep, useKept, type ProofTab } from './kept.ts'
import { MathView } from './math/MathView.tsx'
import { layoutOf, type ProofLayout } from './proof-layout.ts'
import { RunSummary, RunView } from './run/RunView.tsx'

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

/** The state graph brings React Flow and dagre, so its code loads when a proof opens and not at startup. */
export const loadGraphView = () => import('./graph/GraphView.tsx')
const GraphView = lazy(() => loadGraphView().then((module) => ({ default: module.GraphView })))

const TABS: readonly PageTab<ProofTab>[] = [
  { value: 'run', label: 'Run' },
  { value: 'graph', label: 'State graph' },
  { value: 'math', label: 'Math' },
]

/** The graph's height at its widest, held empty while its code is on its way. */
const GRAPH_ROOM = <div aria-hidden className="h-[610px]" />

export interface ProofBodyProps {
  run: ProofRun
  /** A still moment for the run's time, for the sample. Null reads the clock where the time shows. */
  now: number | null
  layout: ProofLayout
  /** The tab list's id, unique on the screen: `proof` on the page, `proof-panel` beside another page. */
  tabsId: string
  /** Shows a part: its tab in tabs, and side by side the keyboard goes to it. */
  onPart: (part: ProofTab) => void
  onCode: ((where: string) => void) | null
}

/**
 * A proof run's views (053-work-control-room, "Proofs"). Side by side, what the run found leads, then the trace or state
 * graph at the left and the math with the proof tree at the right, then the rest of the run. In tabs, Run, State graph
 * and Math show one at a time, as they always have. Only what shows is mounted, and every card keeps its height.
 */
export function ProofBody({ run, now, layout, tabsId, onPart, onCode }: ProofBodyProps) {
  // The tab is drawn deferred: should the graph's code still be on its way, the tab shown stays until it is there.
  const tab = useDeferredValue(useKept(run.id, 'tab'))

  if (layout === 'side') {
    return (
      <>
        <RunSummary run={run} onTab={onPart} />
        <div className="grid grid-cols-2 items-start gap-5">
          <div data-proof-zone="graph" className="min-w-0">
            <Suspense fallback={GRAPH_ROOM}>
              <GraphView run={run} onCode={onCode} />
            </Suspense>
          </div>
          <div data-proof-zone="math" className="min-w-0">
            <MathView run={run} proofFirst />
          </div>
        </div>
        <RunView run={run} now={now} zone={ZONE} onTab={onPart} onCode={onCode} summary={false} />
      </>
    )
  }

  return (
    <>
      <PageTabs id={tabsId} label="Proof run views" tabs={TABS} value={tab} onChoose={(next) => keep(run.id, { tab: next })} />
      <div role="tabpanel" id={`${tabsId}-panel-${tab}`} aria-labelledby={`${tabsId}-tab-${tab}`}>
        <Suspense fallback={GRAPH_ROOM}>
          <TabPanel tab={tab} run={run} now={now} onPart={onPart} onCode={onCode} />
        </Suspense>
      </div>
    </>
  )
}

function TabPanel({ tab, run, now, onPart, onCode }: Pick<ProofBodyProps, 'run' | 'now' | 'onPart' | 'onCode'> & { tab: ProofTab }) {
  switch (tab) {
    case 'run':
      return <RunView run={run} now={now} zone={ZONE} onTab={onPart} onCode={onCode} />
    case 'graph':
      return <GraphView run={run} onCode={onCode} />
    case 'math':
      return <MathView run={run} />
  }
}

/** Where the keyboard lands in each part: what the run found, the graph's canvas, or the proof step or block picked. */
const LANDING: Readonly<Record<ProofTab, readonly string[]>> = {
  run: ['[data-proof-part="run"]'],
  graph: ['[data-proof-part="graph"]'],
  math: ['[data-proof-step][data-lit="true"]', '[data-block][aria-pressed="true"]', '[data-proof-step]', '[data-block]'],
}

/**
 * Gives a part the keyboard, once it is there: a tab that just opened, or the graph whose code is still on its way, is
 * waited for a few frames. `target` is a selector for one element of it instead, such as a proof step.
 */
export function focusPart(root: HTMLElement | null, part: ProofTab, target?: string): void {
  let frames = 40
  const tryNow = () => {
    const found = (target ? [target] : LANDING[part]).map((selector) => root?.querySelector<HTMLElement>(selector)).find(Boolean)
    if (found) {
      found.focus({ preventScroll: true })
      found.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      return
    }
    if (--frames > 0) requestAnimationFrame(tryNow)
  }
  tryNow()
}

/** The box's width inside its padding, which is what the layout has to fill. */
function contentWidth(element: HTMLElement): number {
  const style = getComputedStyle(element)
  return element.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0)
}

/**
 * The layout for the box `box` names, read before it first paints and again as it resizes. A still render passes the
 * layout it wants and nothing is measured.
 */
export function useBoxLayout(box: RefObject<HTMLElement | null>, given?: ProofLayout): ProofLayout {
  const [layout, setLayout] = useState<ProofLayout>(given ?? 'tabs')
  useLayoutEffect(() => {
    const element = box.current
    if (given || !element) return
    const measure = () => setLayout(layoutOf(contentWidth(element)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [box, given])
  return given ?? layout
}
