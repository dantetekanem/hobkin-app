import { useMemo, useRef } from 'react'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useRunningAgents } from '@/app/running-agents.ts'
import { useStops } from '@/app/stops.ts'
import { useHost } from '@/lib/host/index.ts'
import { returnToWorldProject, useWorkView } from './store.ts'
import { WorldMap } from './WorldMap.tsx'

/** A contextual Work page: the three-project gate controls entry, not continued viewing. The way back is the trail's (053). */
export function WorldScreen() {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)
  const { work } = useWorkView()
  // A durable hobkin is the user's own and no work of hobkin's, so the map leaves it out (034-durable-hobkins).
  const listed = useRunningAgents()
  const agents = useMemo(() => listed.filter(agent => !agent.durable), [listed])
  const home = useHost(state => state.home)
  const epoch = useHost(state => state.epoch)
  const source = JSON.stringify([home, epoch])
  return <div ref={root} className={SCREEN_SCROLLER}>
    <div className={`${SCREEN_COLUMN} flex flex-col gap-6 pb-20`}>
      <header className="flex items-center justify-between gap-4">
        <h1 className="eyebrow">World</h1>
      </header>
      {work ? <WorldMap key={source} work={work} agents={agents} onProject={slug => { returnToWorldProject(slug, source) }} /> : <p className="text-muted-foreground">Work is not known for this source yet.</p>}
    </div>
  </div>
}
