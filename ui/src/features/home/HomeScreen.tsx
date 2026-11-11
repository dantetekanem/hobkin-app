import { useMemo } from 'react'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useView } from '@/app/view-store.ts'
import { newestFirst } from '@/features/reports/inbox.ts'
import { Overview } from '@/features/reports/Overview.tsx'
import { useReports } from '@/features/reports/store.ts'

/** Home keeps ideas and the existing Briefing together, independently of the Reports reader. */
export function HomeScreen() {
  const inbox = useReports((state) => state.inbox)
  const list = useMemo(() => newestFirst(inbox.reports), [inbox.reports])
  return (
    <div className={`${SCREEN_SCROLLER} pb-6`}>
      <div className={SCREEN_COLUMN}>
        <Overview standalone list={list} read={inbox.read} now={Date.now()} onOpen={(id) => {
          useReports.getState().open(id)
          useView.getState().openScreen('reports')
        }} />
      </div>
    </div>
  )
}
