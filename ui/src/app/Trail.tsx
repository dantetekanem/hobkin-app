import { ChevronRight } from 'lucide-react'
import { memo, useMemo } from 'react'
import type { ProofRunSummary } from '#shared/protocol/proofs.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import { SAMPLE_PROOFS } from '@/features/proofs/sample.ts'
import { useWorkUi } from '@/features/work/store.ts'
import { useGitHub, useHasHost, useHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { requestCanvasFocus } from './focus.ts'
import { useAgent } from './running-agents.ts'
import { modelName, placeName, reviewTitleOf, shownTrail, type Stop } from './trail.ts'
import { useView } from './view-store.ts'

/**
 * The trail (053), the one way a page says where it is: one line under the menu, on every page, of the places the user
 * came through to it, oldest first. Each earlier place is a button back to it; the last is the page itself, in plain
 * text. It is always one line of the same height: a long trail shortens its middle places first, then its ends.
 * Escape goes back one place too (`keys.ts`).
 */
export const Trail = memo(function Trail() {
  const screen = useView((view) => view.screen)
  const trail = useView((view) => view.trail)
  const openAgent = useView((view) => view.openAgent)
  const openReview = useView((view) => view.openReview)
  const openProof = useView((view) => view.openProof)
  const project = useView((view) => view.project)
  const settingsReturn = useView((view) => view.settingsReturn)
  const githubReturn = useView((view) => view.githubReturn)
  const mindReturn = useView((view) => view.mindReturn)
  const canvasReturn = useView((view) => view.canvasReturn)
  const shown = useMemo(
    () => shownTrail({ screen, trail, openAgent, openReview, openProof, project, settingsReturn, githubReturn, mindReturn, canvasReturn }),
    [screen, trail, openAgent, openReview, openProof, project, settingsReturn, githubReturn, mindReturn, canvasReturn],
  )
  // The canvas names itself in the menu, and its drawing starts right under it.
  if (screen === 'canvas') return null

  return (
    <nav aria-label="Trail" data-trail="" className="mt-0.5 flex h-5 max-w-full min-w-0 px-6">
      {/* Only the line itself takes the pointer: the gutters beside it leave the page under them alone. */}
      <ol className="pointer-events-auto flex h-5 min-w-0 items-center rounded-full bg-surface px-0.5 text-[12px] leading-5 font-medium whitespace-nowrap">
        {shown.map((stop, at) => {
          const last = at === shown.length - 1
          return (
            // The middle places give way, down to a few letters each; the ends keep their names, up to a share of the
            // canvas's width (the menu is its container), so where the trail starts and where the user is stay readable.
            <li key={`${at}:${stop.screen}:${stop.about ?? ''}`} className={cn('flex min-w-0 items-center', at === 0 || last ? 'max-w-[28cqw] shrink-0' : 'min-w-10 shrink')}>
              {at > 0 ? <ChevronRight aria-hidden="true" className="mx-0.5 size-3 shrink-0 text-muted-foreground/70" /> : null}
              {last ? (
                <span aria-current="page" className="min-w-0 truncate px-1.5 text-foreground">
                  <PlaceName stop={stop} />
                </span>
              ) : (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => goBackTo(at)}
                  className="h-5 min-w-0 truncate rounded-full px-1.5 text-muted-foreground outline-offset-0 transition-colors duration-[160ms] ease-[ease] hover:bg-tone-1 hover:text-foreground"
                >
                  <PlaceName stop={stop} />
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
})

/** Back to a place of the trail, with the keyboard in the page there, as the menu's items do. */
function goBackTo(index: number) {
  const view = useView.getState()
  view.backTo(index)
  view.engageCanvas()
  requestCanvasFocus()
}

/** A place's name. What it is about is read only for the places that show it, each from its own narrow selection. */
function PlaceName({ stop }: { stop: Stop }) {
  switch (stop.screen) {
    case 'project':
      return <ProjectName stop={stop} />
    case 'review':
      return <ReviewName stop={stop} />
    case 'proof':
      return <ProofName stop={stop} />
    case 'agent':
      return <AgentName stop={stop} />
    default:
      return placeName(stop)
  }
}

function ProjectName({ stop }: { stop: Stop }) {
  const live = useHasHost()
  const hosted = useHost((state) => state.work?.projects.find(({ slug }) => slug === stop.about)?.name)
  const sample = useWorkUi((state) => state.sample.projects.find(({ slug }) => slug === stop.about)?.name)
  return placeName(stop, live ? hosted : sample)
}

const changeTitle = (work: WorkState | null | undefined, id: string) => (work ? reviewTitleOf(id, work.finished.flatMap(({ changes }) => changes), []) : undefined)

function ReviewName({ stop }: { stop: Stop }) {
  const id = stop.about ?? ''
  const live = useHasHost()
  const hosted = useHost((state) => changeTitle(state.work, id))
  const sample = useWorkUi((state) => changeTitle(state.sample, id))
  const github = useGitHub()
  const pull = useMemo(() => reviewTitleOf(id, [], [...github.pulls, ...github.reviews]), [id, github])
  return placeName(stop, (live ? hosted : sample) ?? pull)
}

/** A run's model, by its id, or the newest run's when it names none, as its page shows it. */
const modelOf = (runs: readonly ProofRunSummary[] | undefined, id: string | undefined) => {
  const run = id ? runs?.find((entry) => entry.id === id) : runs?.[0]
  return run ? modelName(run.spec) : undefined
}

function ProofName({ stop }: { stop: Stop }) {
  const live = useHasHost()
  const hosted = useHost((state) => modelOf(state.proofs?.runs, stop.about))
  return placeName(stop, live ? hosted : modelOf(SAMPLE_PROOFS.runs, stop.about))
}

function AgentName({ stop }: { stop: Stop }) {
  const agent = useAgent(stop.about ?? null)
  return placeName(stop, agent?.title)
}
