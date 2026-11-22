import { useCallback } from 'react'
import { useView } from '@/app/view-store.ts'
import type { NumbersOpen } from '@/features/numbers/board-model.ts'
import { NumbersBoard } from '@/features/numbers/NumbersBoard.tsx'
import { useWorkMetrics } from '@/features/numbers/use-work-metrics.ts'
import { useWorkTab } from './tab.ts'

/**
 * Work's third tab, Numbers (053, "Work"): the charts and the table of projects for 7, 30 or 90 days, its period kept
 * while the app is open. It is mounted only while it shows, so its numbers are read only then. A tile on Work opens it
 * at the chart the tile stands for.
 */
export function NumbersTab() {
  const period = useWorkTab((state) => state.period)
  const setPeriod = useWorkTab((state) => state.setPeriod)
  const at = useWorkTab((state) => state.at)
  const { metrics, state } = useWorkMetrics(period)

  const onOpen = useCallback((what: NumbersOpen) => {
    if ('project' in what) useView.getState().openProject(what.project)
    else if (what.chart === 'ai-reviews') useWorkTab.getState().choose('reviews')
  }, [])

  return <NumbersBoard metrics={metrics} state={state} period={period} onPeriod={setPeriod} onOpen={onOpen} at={at} />
}
