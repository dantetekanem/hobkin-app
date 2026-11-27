import { useMemo, useRef } from 'react'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useStops } from '@/app/stops.ts'
import { useWorkMetrics } from '@/features/numbers/use-work-metrics.ts'
import { SAMPLE_YOLO } from '@/features/settings/yolo.ts'
import { isGoal } from '@/features/work/projects.ts'
import { useWorkView } from '@/features/work/store.ts'
import { projectPage, type ProjectPage as Page } from './model.ts'
import { withSampleDecided, withSampleModels } from './sample.ts'
import { RunGuideBlock } from './RunGuide.tsx'
import { AtWorkBlock, MergedBlock, ModelsBlock, NotTaken, ProjectFlow, ProjectHeading, ProjectTiles, QueueBlock, ReadinessBlock, Unknown, WaitingBlock } from './sections.tsx'
import { useKeptPage, useProjectReviews, useRunGuide, type GuideControl } from './use-project.ts'

/**
 * One project's page (_specs/053-work-control-room, "A page for each project"), top to bottom: what waits for the user
 * here, what it is doing, and how it has been going. Everything on it is what the window already knows: Work's state,
 * YOLO mode, the numbers (read once through the shared hook), the AI reviews, its run guide for a code project, and its
 * agents, which the two parts that show them read alone. Without a host, the samples.
 */
export function ProjectPage({ slug }: { slug: string }) {
  const { work, live } = useWorkView()
  const { metrics, state } = useWorkMetrics()
  const reviews = useProjectReviews(live, slug)
  const yolo = live ? (work?.yolo ?? null) : SAMPLE_YOLO
  const shownWork = useMemo(() => (live || !work ? work : withSampleModels(work)), [live, work])
  const shownMetrics = useMemo(() => (state === 'sample' && metrics ? withSampleDecided(metrics) : metrics), [state, metrics])
  const project = shownWork?.projects.find((candidate) => candidate.slug === slug)
  const guide = useRunGuide(live, slug, project?.state === 'chosen' && !isGoal(project))
  const made = useMemo(
    () => projectPage({ slug, work: shownWork, yolo, metrics: shownMetrics, metricsState: state, reviews, runGuide: guide.read, live }),
    [slug, shownWork, yolo, shownMetrics, state, reviews, guide.read, live],
  )
  const page = useKeptPage(made)
  return <ProjectView slug={slug} page={page} live={live} guide={guide.control} />
}

const NO_PRESS: GuideControl = { pressing: false, said: null, press: () => {} }

/**
 * The page drawn from what `projectPage` says. Up and Down walk its rows and controls, and a way back along the trail
 * returns to the row it was left at and its scroll.
 */
export function ProjectView({ slug, page, live, guide = NO_PRESS }: { slug: string; page: Page; live: boolean; /** The run guide's button. */ guide?: GuideControl }) {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)

  return (
    <div ref={root} className={`${SCREEN_SCROLLER} pb-20`}>
      <div className={`${SCREEN_COLUMN} flex flex-col gap-10`}>
        {page.kind === 'taken' ? (
          <>
            <div className="flex flex-col gap-5">
              <ProjectHeading heading={page.heading} live={live} />
              <ProjectTiles tiles={page.tiles} />
              <ProjectFlow flow={page.flow} slug={slug} />
            </div>
            <WaitingBlock section={page.waiting} />
            <AtWorkBlock slug={slug} empty={page.atWork.empty} />
            <QueueBlock section={page.queue} />
            <MergedBlock merged={page.merged} />
            <ModelsBlock models={page.models} live={live} />
            <ReadinessBlock readiness={page.readiness} />
            {page.runGuide ? <RunGuideBlock read={page.runGuide} control={guide} /> : null}
          </>
        ) : page.kind === 'not-taken' ? (
          <NotTaken slug={slug} name={page.name} state={page.state} line={page.line} live={live} />
        ) : (
          <Unknown name={page.name} line={page.line} />
        )}
        {live ? null : <p className="px-1 text-[12px] text-muted-foreground">Sample data. No host is running, so nothing here reaches hobkin.</p>}
      </div>
    </div>
  )
}
