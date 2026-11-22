import { useCallback } from 'react'
import { useView } from '@/app/view-store.ts'
import type { NumbersOpen } from '@/features/numbers/board-model.ts'
import { NumbersBoard } from '@/features/numbers/NumbersBoard.tsx'
import { useWorkMetrics } from '@/features/numbers/use-work-metrics.ts'
import { chartOpens } from './numbers-open.ts'
import { useWorkTab } from './tab.ts'

/**
 * Work's third tab, Numbers (053, "Work"): the charts and the table of projects for 7, 30 or 90 days, its period kept
 * while the app is open. It is mounted only while it shows, so its numbers are read only then. A tile on Work opens it
 * at the chart the tile stands for. A chart opens the changes it counts, AI reviews open their tab, and a project's
 * row its page. Proofs and tokens have no list behind them.
 */
export function NumbersTab() {
  const period = useWorkTab((state) => state.period)
  const setPeriod = useWorkTab((state) => state.setPeriod)
  const at = useWorkTab((state) => state.at)
  const { metrics, state } = useWorkMetrics(period)

  // What a chart opens: the changes behind it in a panel over the page, the AI Reviews tab, or a project's page.
  const onOpen = useCallback((what: NumbersOpen) => {
    const target = chartOpens(what)
    if (!target) return
    if ('project' in target) useView.getState().openProject(target.project)
    else if ('tab' in target) useWorkTab.getState().choose(target.tab)
    else useWorkTab.getState().openList(target.list)
  }, [])

  return <NumbersBoard metrics={metrics} state={state} period={period} onPeriod={setPeriod} onOpen={onOpen} at={at} />
}
