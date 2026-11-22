import { ChevronRight, Presentation } from 'lucide-react'
import { memo, useMemo } from 'react'
import type { CanvasState } from '#shared/protocol/canvas.ts'
import type { ProofRunSummary } from '#shared/protocol/proofs.ts'
import { labelFor } from '@/features/canvas-panel/rules.ts'
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
 *
 * While the main canvas is open and the menu keeps one row, the canvas's pill sits at the line's right end
 * (`menu-rows.ts`), so the menu grows no row for it and no page moves when it opens or closes. The places stay centered
 * whether it shows or not, and give way before they would reach it.
 */
export const Trail = memo(function Trail({ pill = null, dot = false }: {
  /** The main canvas, when its pill ends this line. */
  pill?: (CanvasState & { url: string }) | null
  /** It was redrawn and not seen since. */
  dot?: boolean
}) {
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
  const places = screen === 'canvas' ? [] : shown
  if (places.length === 0 && !pill) return null

  return (
    <nav aria-label="Trail" data-trail="" className="relative mt-0.5 flex h-5 w-full min-w-0 justify-center px-6">
      {/* Only the line itself takes the pointer: the gutters beside it leave the page under them alone. With the pill,
          the places keep clear of it on both sides, so they stay centered. */}
      {places.length ? <ol className={cn('pointer-events-auto flex h-5 min-w-0 items-center overflow-x-clip rounded-full bg-surface px-0.5 text-[12px] leading-5 font-medium whitespace-nowrap', pill && 'max-w-[calc(100%-21rem)]')}>
        {places.map((stop, at) => {
          const last = at === places.length - 1
          return (
            // The middle places give way, down to a few letters each; the ends keep their names, up to a share of the
            // canvas's width (the menu is its container), so where the trail starts and where the user is stay readable.
            // Shrinking goes by width, so the ends' share stays under a pixel until the middles can give no more.
            <li key={`${at}:${stop.screen}:${stop.about ?? ''}`} className={cn('flex min-w-10 items-center', at === 0 || last ? 'max-w-[28cqw] shrink-[0.0001]' : 'shrink')}>
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
      </ol> : null}
      {pill ? <CanvasPill canvas={pill} dot={dot} /> : null}
    </nav>
  )
})

/**
 * The main canvas while another page shows: its name at the right end of the trail's line, with a dot once it is
 * redrawn and not seen since, whose place is kept so nothing shifts. It goes back to the canvas, as Command with its
 * number does.
 */
function CanvasPill({ canvas, dot }: { canvas: CanvasState & { url: string }; dot: boolean }) {
  const label = labelFor(canvas.url, canvas.title, canvas.kind)
  return (
    <button
      type="button"
      title={label}
      aria-label={dot ? `${label}, redrawn` : label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const view = useView.getState()
        view.openCanvasPlace()
        view.engageCanvas()
        requestCanvasFocus()
      }}
      className="pointer-events-auto absolute top-0 right-6 flex h-5 max-w-40 items-center gap-1 rounded-full bg-surface px-1.5 text-[12px] leading-5 font-medium text-muted-foreground outline-offset-0 transition-colors duration-[160ms] ease-[ease] hover:bg-tone-1 hover:text-foreground"
    >
      <Presentation className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', dot ? 'bg-primary' : 'bg-transparent')} />
    </button>
  )
}

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
