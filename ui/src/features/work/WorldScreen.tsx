import { useRef } from 'react'
import { requestCanvasFocus } from '@/app/focus.ts'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useRunningAgents } from '@/app/running-agents.ts'
import { useStops } from '@/app/stops.ts'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { useHost } from '@/lib/host/index.ts'
import { returnToWorldProject, useWorkView } from './store.ts'
import { WorldMap } from './WorldMap.tsx'

/** A contextual Work page: the three-project gate controls entry, not continued viewing. */
export function WorldScreen() {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)
  const { work } = useWorkView()
  const agents = useRunningAgents()
  const home = useHost(state => state.home)
  const epoch = useHost(state => state.epoch)
  const source = JSON.stringify([home, epoch])
  return <div ref={root} className={SCREEN_SCROLLER}>
    <div className={`${SCREEN_COLUMN} flex flex-col gap-6 pb-20`}>
      <header className="flex items-center justify-between gap-4">
        <h1 className="eyebrow">Work / World</h1>
        <Button data-stop="" onClick={() => {
          useView.getState().openScreen('work')
          requestCanvasFocus('[data-opens="world"]')
        }}>Back to Work</Button>
      </header>
      {work ? <WorldMap key={source} work={work} agents={agents} onProject={slug => { returnToWorldProject(slug, source) }} /> : <p className="text-muted-foreground">Work is not known for this source yet.</p>}
    </div>
  </div>
}
