import { useView } from '@/app/view-store.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { useHost } from '@/lib/host/hooks.ts'
import { activityOf, homeIdeas, ideaTarget } from './home-ideas.ts'
import type { Report } from './report.ts'

/** Reusable above the Briefing, including the later standalone Home shell. */
export function HomeIdeas({ list, read, now, onOpen }: {
  list: readonly Report[]
  read: ReadonlySet<string>
  now: number
  onOpen: (id: string, from: HTMLElement) => void
}) {
  const work = useHost((state) => state.work)
  const question = useHost((state) => state.question)
  const activity = activityOf({ work, question })
  const ideas = homeIdeas(list, read, work, now)
  return (
    <section aria-label="Ideas" className="flex flex-col gap-3">
      <header>
        <h2 className="eyebrow">Ideas</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Activity unknown — full live activity coverage is not available.</p>
        {activity.waiting ? <p className="text-[13px]">An answer is waiting in the conversation.</p> : null}
        {activity.held ? <p className="text-[13px]">Work held: {activity.held}</p> : null}
        <p className="text-[12px] text-muted-foreground">From the reports and work last received. Open to check the current details.</p>
      </header>
      <ul className="flex flex-col gap-2">
        {ideas.map((idea) => (
          <li key={idea.id}>
            <button type="button" className="flex w-full items-center gap-3 rounded-xl bg-surface-2/60 p-3 text-left focus-visible:outline focus-visible:outline-2"
              onClick={(event) => {
                const target = ideaTarget(idea)
                if (target.page === 'reports') onOpen(target.reportId, event.currentTarget)
                else useView.getState().openScreen(target.page)
              }}>
              <Hob size={36} still mood={idea.tone === 'critical' ? 'surprised' : idea.tone === 'blocked' ? 'confused' : 'idle'} className="shrink-0" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{idea.title}</span>
                <span className="block text-[12px] text-muted-foreground">{idea.detail}{idea.kind === 'report' ? idea.age === null ? ' · age unknown' : ` · ${Math.floor(idea.age / 86400000)}d old` : ''}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {ideas.length === 0 ? <p className="text-[13px] text-muted-foreground">No suggestions in the available data.</p> : null}
    </section>
  )
}
