import { ChevronRightIcon } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode, type Ref, type SetStateAction } from 'react'
import { requestCanvasFocus } from '@/app/focus.ts'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useStops } from '@/app/stops.ts'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { OpenArrow } from '@/components/ui/open-arrow.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { openGitHubPage, openOnGitHub } from '@/features/github/open.ts'
import { openTarget } from '@/features/home/navigate.ts'
import { ChartFrame, pressProps } from '@/features/numbers/ChartFrame.tsx'
import { DayBars } from '@/features/numbers/DayBars.tsx'
import { countWords } from '@/features/numbers/format.ts'
import { Funnel } from '@/features/numbers/Funnel.tsx'
import { StatTile } from '@/features/numbers/StatTile.tsx'
import { READ_WORDS, useWorkMetrics } from '@/features/numbers/use-work-metrics.ts'
import { ProjectModels, ProofSetup } from '@/features/proofs/ProjectModels.tsx'
import { useReports } from '@/features/reports/store.ts'
import { rateChoices, readyCount, SAMPLE_YOLO, SAMPLE_YOLO_REVIEWS, sampleAfter, yoloSays } from '@/features/settings/yolo.ts'
import { runCommand } from '@/lib/host/client.ts'
import { cn } from '@/lib/utils.ts'
import type { FinishedGroup, WorkProject, YoloProject, YoloState } from '#shared/protocol/work.ts'
import { NewProjectSheet } from './NewProjectSheet.tsx'
import { opensNewProject } from './new-project.ts'
import { SectionHeading, Segmented } from './parts.tsx'
import { runWork, useWorkView } from './store.ts'
import { useReviewList } from './use-review-list.ts'
import { openOnWork } from './work-target.ts'
import { projectCard, readinessLine, type Blocker, type CardChange } from './yolo-card.ts'
import {
  byItselfBars,
  changeOpens,
  gates,
  GATES_COUNTS,
  hasSwitch,
  inPlace,
  isOn,
  mergedDays,
  mergedLine,
  offLine,
  projectOpens,
  projectOrder,
  readinessRow,
  reviewsOf,
  sampleReadiness,
  pullsSay,
  sampleSwitch,
  stillToSetUp,
  switchesSay,
  trustTiles,
  waitingChange,
  yoloReportId,
  type ByItselfBars,
  type Gates,
  type MergedRow,
  type PartOpen,
  type PartRow,
  type ReadinessPress,
  type ReviewRatings,
  type TrustTile,
  type VerdictAction,
  type VerdictTone,
  type YoloOpen,
} from './yolo-page.ts'

type SetSample = Dispatch<SetStateAction<YoloState>>

const NO_REVIEWS: readonly ({ id: string } & ReviewRatings)[] = []

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

/** Work, onto the button that opened this page. Work on the trail before this page is gone back to (053). */
export function backToWork() {
  useView.getState().openScreen('work')
  requestCanvasFocus('[data-opens="yolo"]')
}

/** The switch and the rate, which the page's header and a project's "Set rate" both change. */
interface Setting {
  saving: boolean
  problem: string | null
  change: (next: { on?: boolean; rate?: number }) => Promise<void>
}

function useSetting(live: boolean, setSample: SetSample): Setting {
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const change = async (next: { on?: boolean; rate?: number }) => {
    if (saving) return
    setProblem(null)
    if (!live) {
      setSample((before) => sampleAfter(before, next))
      return
    }
    setSaving(true)
    try {
      // The host answers by publishing work mode's status again, which is what this draws.
      await runCommand('work.yolo', next)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }
  return { saving, problem, change }
}

/**
 * YOLO mode, a page of its own opened from Work's header, as World is (049-yolo-mode). Each project says first what YOLO
 * mode does there: whether it merges and deploys, and if not, hobkin's exact reason and the one press that moves it. Then
 * what waits to merge at what rate, what merged by itself and how its deploy held, and the readiness parts still to set
 * up. The switch and the lowest rate sit on top. Without a host it shows sample data, and a click changes only that.
 */
export function YoloScreen() {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)
  const { work, live } = useWorkView()
  // Each review the host knows, for the ratings of the changes waiting (spec 058). With no host, the YOLO sample's own.
  const { list: reviewList } = useReviewList(live)
  const reviews = live ? (reviewList?.reviews ?? NO_REVIEWS) : SAMPLE_YOLO_REVIEWS
  const [sample, setSample] = useState(SAMPLE_YOLO)
  // The New project popup, opened by the button in the Projects heading or by N (059). YOLO mode's switch starts on in it.
  const [adding, setAdding] = useState(false)
  const newProjectButton = useRef<HTMLButtonElement | null>(null)
  const openNewProject = () => setAdding(true)
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target
    if (event.defaultPrevented || adding || !(target instanceof HTMLElement) || target.matches('input, textarea, [contenteditable="true"]')) return
    if (!opensNewProject({ key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, repeat: event.repeat, handled: event.defaultPrevented, typing: false })) return
    event.preventDefault()
    openNewProject()
  }
  const yolo = live ? (work?.yolo ?? null) : sample
  const setting = useSetting(live, setSample)
  // The numbers of the last 30 days: what merged by itself, what regressed and what was held for the user (053).
  const { metrics, state } = useWorkMetrics(30)
  const reading = !metrics && state === 'loading'
  const days = metrics?.all.days ?? null
  // Why there are no numbers, while there are none.
  const missing = metrics ? null : READ_WORDS[state]
  const trust = useMemo(() => trustTiles(days, missing), [days, missing])
  const merged = useMemo(() => mergedLine(days, missing), [days, missing])
  const bars = useMemo(() => byItselfBars(days), [days])
  // What holds every merge, as each project card reads it: work mode off or waiting, and the projects paused on Work.
  const workOn = live ? (work?.enabled ?? false) : true
  const waits = yolo?.waits ?? (workOn ? null : 'work mode is off')
  // The paused projects' slugs in one string, so the gates are counted again only when which projects are paused changes.
  const pausedSlugs = (work?.projects ?? []).filter((project) => project.paused).map(({ slug }) => slug).join(' ')
  const paused = useMemo(() => new Set(pausedSlugs.split(' ').filter(Boolean)), [pausedSlugs])
  const counted = useMemo(() => (yolo ? gates(yolo, { waits, paused }) : null), [yolo, waits, paused])

  return (
    <div ref={root} onKeyDownCapture={onKeyDownCapture} className={SCREEN_SCROLLER}>
      <div className={`${SCREEN_COLUMN} flex flex-col gap-6 pb-20`}>
        {/* Where the page is, and the way back, are the trail's (053). */}
        <header className="flex items-center justify-between gap-4">
          <h1 className="eyebrow">YOLO mode</h1>
        </header>
        {yolo ? (
          <>
            <Switchboard yolo={yolo} setting={setting} />
            <TrustRow tiles={trust} loading={reading} />
            {counted ? <GatesRow counted={counted} rate={yolo.rate} merged={merged} /> : null}
            <ByItselfChart bars={bars} reading={reading} note={READ_WORDS[state] ?? undefined} />
            <Projects yolo={yolo} live={live} workOn={workOn} workProjects={work?.projects ?? []} finished={work?.finished ?? []} reviews={reviews} setting={setting} setSample={setSample} onNewProject={openNewProject} newProjectRef={newProjectButton} />
          </>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">This hobkin has not said how YOLO mode stands yet.</p>
        )}
        {live ? null : <p className="text-[12px] text-muted-foreground">Sample data. No host is running, so nothing here reaches hobkin.</p>}
      </div>
      <NewProjectSheet open={adding} from="yolo" live={live} onClose={() => setAdding(false)} returnTo={newProjectButton} />
    </div>
  )
}

/** The switch and the lowest rate. What the switch means sits in one line whatever it says, so nothing under it moves. */
function Switchboard({ yolo, setting: { saving, problem, change } }: { yolo: YoloState; setting: Setting }) {
  return (
    <section aria-label="YOLO mode" className="flex flex-col gap-3 rounded-3xl bg-background px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="flex items-center gap-3">
          <Switch checked={yolo.on} disabled={saving} onCheckedChange={(on) => void change({ on })} data-stop="" />
          <span className="font-heading text-[14px] font-medium">YOLO mode {yolo.on ? 'on' : 'off'}</span>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className="eyebrow">Lowest rate</span>
          <Segmented
            label="Lowest general rate that merges and deploys by itself"
            name="yolo-rate"
            value={String(yolo.rate)}
            options={rateChoices(yolo).map((rate) => ({ value: String(rate), label: String(rate) }))}
            disabled={saving}
            onChoose={(rate) => void change({ rate: Number(rate) })}
          />
        </div>
      </div>
      <p role={problem ? 'alert' : undefined} title={problem ? undefined : yoloSays(yolo)} className={cn('h-5 truncate text-[13px] leading-5', problem ? 'text-bad-fg' : 'text-muted-foreground')}>
        {problem ? `Not saved. ${problem}` : yoloSays(yolo)}
      </p>
    </section>
  )
}

/** Whether merging by itself can be trusted, over 30 days: the share made by itself, how many of those regressed, and how many were held for the user. */
const TrustRow = memo(function TrustRow({ tiles, loading }: { tiles: readonly TrustTile[]; loading: boolean }) {
  return (
    <section aria-label="How far merging by itself can be trusted, over 30 days" className="@container">
      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
        {tiles.map(({ key, ...tile }) => (
          <StatTile key={key} {...tile} loading={loading} />
        ))}
      </div>
    </section>
  )
})

/** The funnel's plot and the box beside it, as tall as its three gates. */
const GATES_BOX = 3 * 28 + 24

/**
 * The gates, as the changes finished now pass them, and beside them what holds the rest, in hobkin's words, with what
 * merged over 30 days under it. hobkin keeps no history of each gate, so the funnel counts now and says so.
 */
const GatesRow = memo(function GatesRow({ counted, rate, merged }: { counted: Gates; rate: number; merged: string }) {
  const { steps, waiting, holds, shown } = counted
  const finished = steps[0]!.count
  const said = holds.map(({ reason, count }) => `${countWords(count)}: ${reason}`).join(' ')
  const holdsSaid = waiting ? `${countWords(waiting)} wait for you. ${said}` : 'Nothing holds a finished change now.'
  return (
    <section aria-label="Gates" className="@container">
      <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Funnel
          title="Gates now"
          counts={GATES_COUNTS(rate)}
          steps={steps}
          aside={{ label: 'wait for you', count: waiting }}
          status={finished ? 'ready' : 'no-data'}
          note="No finished change waits now."
        />
        <ChartFrame
          title="What holds the rest"
          counts="Why each finished change that is not free to merge waits for you, in hobkin's words, and what merged over 30 days."
          figure={finished ? `${countWords(waiting)} wait for you` : undefined}
          summary={`${holdsSaid} ${merged}`}
          status="ready"
          height={GATES_BOX}
        >
          {shown.length ? (
            <ul className="flex flex-col">
              {shown.map(({ reason, count }) => (
                <li key={reason} className="grid h-7 grid-cols-[32px_minmax(0,1fr)] items-center gap-x-3">
                  <span className="text-right text-[13px] font-semibold tabular-nums">{countWords(count)}</span>
                  <span title={reason} className="truncate text-[12.5px] text-muted-foreground">
                    {reason}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] leading-7 text-muted-foreground">{finished ? 'Nothing holds a finished change now.' : 'No finished change waits now.'}</p>
          )}
          <p title={merged} className="absolute inset-x-0 bottom-0 h-5 truncate border-t border-border/60 pt-0.5 text-[12.5px] leading-5 text-foreground/85 tabular-nums">
            {merged}
          </p>
        </ChartFrame>
      </div>
    </section>
  )
})

const NO_DAYS: string[] = []
const NO_SERIES: ByItselfBars['series'] = []

/**
 * Merges by itself for each of the 30 days, over all projects. Its box keeps its size while the numbers load. Each project
 * card keeps its own list of what merged instead: a chart that tall on every card would repeat this one.
 */
function ByItselfChart({ bars, reading, note }: { bars: ByItselfBars | null; reading: boolean; note: string | undefined }) {
  return (
    <DayBars
      title="Merged by itself by day"
      counts="Changes hobkin merged by itself in YOLO mode each day, over all projects."
      figure={bars?.figure}
      days={bars?.days ?? NO_DAYS}
      series={bars?.series ?? NO_SERIES}
      status={bars ? 'ready' : reading ? 'loading' : 'no-data'}
      note={note}
    />
  )
}

/** What every project card needs besides its project. */
interface CardContext {
  yolo: YoloState
  live: boolean
  workOn: boolean
  finished: FinishedGroup[]
  setting: Setting
  setSample: SetSample
  /** The reviews the host knows, each with its id, commit and ratings. */
  reviews: readonly ({ id: string } & ReviewRatings)[]
}

/** The one line under Projects. The longer notes about switches and pull requests are its tooltip. */
const SAYS = 'Each project says whether changes merge there by themselves and what stops them.'

function Projects({ workProjects, onNewProject, newProjectRef, ...context }: CardContext & { workProjects: WorkProject[]; onNewProject: () => void; newProjectRef: Ref<HTMLButtonElement> }) {
  const { yolo, live } = context
  // The order the page opened with holds while it is open, so a card whose switch was just pressed stays under the pointer.
  const kept = useRef<string[] | null>(null)
  const ordered = projectOrder(yolo.projects, kept.current)
  if (!kept.current && ordered.length) kept.current = ordered.map(({ slug }) => slug)
  const switches = switchesSay(yolo)
  const pulls = pullsSay(yolo)
  return (
    <section aria-label="Projects" className="flex flex-col gap-3">
      <SectionHeading label="Projects" count={readyCount(yolo)}>
        <Button ref={newProjectRef} variant="ghost" size="sm" data-stop="" data-new-project="" className="ml-auto text-muted-foreground" onClick={onNewProject}>
          New project
        </Button>
      </SectionHeading>
      <p title={[SAYS, switches, pulls].filter(Boolean).join(' ')} className="h-5 truncate px-1 text-[13px] leading-5 text-muted-foreground">
        {SAYS}
      </p>
      <ProofSetup live={live} />
      {ordered.length ? (
        <ul aria-label="Projects" className="flex flex-col gap-3">
          {ordered.map((project) => (
            <ProjectCard key={project.slug} project={project} workProject={workProjects.find(({ slug }) => slug === project.slug)} {...context} />
          ))}
        </ul>
      ) : (
        <p className="px-1 text-[13px] text-muted-foreground">No projects yet. New project adds one, or take one on Work.</p>
      )}
    </section>
  )
}

const TONES: Record<VerdictTone, { dot: string; text: string }> = {
  ok: { dot: 'bg-ok-fg', text: 'text-ok-fg' },
  live: { dot: 'bg-sun', text: 'text-sun-fg' },
  warn: { dot: 'bg-warn-fg', text: 'text-warn-fg' },
  quiet: { dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
  bad: { dot: 'bg-bad-fg', text: 'text-bad-fg' },
}

/** Where something stands: a dot and a word or three in its tone. It only says, so it has no pill that would look like a button. */
function Mark({ tone, children, className }: { tone: VerdictTone; children: string; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center gap-1.5 font-heading text-[11.5px] font-semibold whitespace-nowrap', TONES[tone].text, className)}>
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', TONES[tone].dot)} />
      {children}
    </span>
  )
}

/** What hobkin said to the last press. */
interface Said {
  text: string
  tone: 'done' | 'refused'
}

/**
 * One project, in the order the user reads it: whether changes merge there by themselves, the few things that stop them
 * each with its press, the changes waiting one line each, what merged by itself, then its readiness in one closed line.
 * The switch and the verdict keep their place whatever the data says.
 */
function ProjectCard({ project, workProject, yolo, live, workOn, finished, reviews, setting, setSample, initiallyOpen = false }: CardContext & { project: YoloProject; workProject: WorkProject | undefined; initiallyOpen?: boolean }) {
  // The card says when readiness was last checked, so it follows the clock itself: the page around it does not.
  const now = useNow(true, 30_000)
  const readiness = readinessRow(project, { workOn, now, zone: ZONE, waiting: waitingChange(project, finished) })
  const context = {
    on: yolo.on,
    rate: yolo.rate,
    lowest: yolo.lowest,
    waits: yolo.waits ?? (workOn ? null : 'work mode is off'),
    paused: workProject?.paused ?? false,
    pullRequests: yolo.pullRequests ?? false,
    readiness,
  }
  const card = projectCard(project, context, reviewsOf(project, reviews))
  // Readiness is one closed line that opens to its parts.
  const [open, setOpen] = useState(initiallyOpen)
  const reportId = useReports((state) => yoloReportId(project, state.inbox.reports))
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<Said | null>(null)
  // The project's own switch shows the press at once, until hobkin's state says the same or the host refuses it.
  const [pending, setPending] = useState<boolean | null>(null)
  const [switching, setSwitching] = useState(false)
  const on = pending ?? isOn(project)

  // hobkin's answer goes once the work moves on, except that a start which waits keeps saying why until it runs.
  useEffect(() => {
    setSaid((current) => (current?.tone === 'done' && project.work === 'queued' ? current : null))
  }, [project.work])
  useEffect(() => setPending(null), [project.on])

  const toggle = async (next: boolean) => {
    if (switching) return
    setSaid(null)
    setPending(next)
    if (!live) {
      setSample((before) => sampleSwitch(before, project.slug, next))
      return
    }
    setSwitching(true)
    try {
      // The host answers by publishing work mode's status again, with this project's switch as hobkin now keeps it.
      await runCommand('work.yolo.project', { slug: project.slug, on: next })
    } catch (error) {
      setPending(null)
      setSaid({ text: error instanceof Error ? error.message : String(error), tone: 'refused' })
    } finally {
      setSwitching(false)
    }
  }

  const runReadiness = async (press: ReadinessPress) => {
    if (busy || !readiness.canRun) return
    if (press.do === 'open') {
      if (press.key) openOnWork(`[data-change="${press.key}"]`)
      else backToWork()
      return
    }
    setSaid(null)
    if (press.do === 'run' && !live) {
      setSample((before) => sampleReadiness(before, project.slug))
      return
    }
    setBusy(true)
    try {
      if (press.do === 'yes') {
        // The same yes as its card on Work, at the commit the card shows. What hobkin says is the card's until the work moves on.
        setSaid(await runWork({ do: 'change', change: press.change, choice: press.choice }, { live, place: press.change.key }))
      } else {
        const { message } = await runCommand('work.yolo.ready', { slug: project.slug })
        setSaid({ text: message, tone: 'done' })
      }
    } catch (error) {
      setSaid({ text: error instanceof Error ? error.message : String(error), tone: 'refused' })
    } finally {
      setBusy(false)
    }
  }

  const act = ({ press }: VerdictAction) => {
    switch (press.do) {
      case 'readiness':
        return void runReadiness(readiness.press)
      case 'action':
        return openTarget({ to: 'action', id: press.id })
      case 'pr':
        return openGitHubPage(press.url)
      case 'work':
        return press.key ? openOnWork(`[data-change="${press.key}"]`) : backToWork()
      case 'review':
        return go(changeOpens(project.slug, press.item, live))
      case 'rate':
        return void setting.change({ rate: press.rate })
    }
  }

  // The switch leads the heading, so it sits in the same place on every card, open or folded.
  const heading = (
    <div className="flex h-8 items-center gap-2">
      {hasSwitch(project) ? (
        <Switch checked={on} disabled={switching} onCheckedChange={(next) => void toggle(next)} aria-label={`YOLO mode on ${project.name}`} data-stop="" data-yolo-project={project.slug} className="mr-1" />
      ) : null}
      <h3 className="min-w-0 font-heading text-[15px] font-semibold">
        {/* A box rather than a button: WebKit lays a button's content out in a box of its own, which cut the name short. */}
        <span {...pressProps(() => go(projectOpens(project.slug)))} aria-label={`${project.name}: opens its page`} className="pressable -mx-1.5 flex h-7 min-w-0 items-center gap-1 rounded-lg px-1.5">
          <span className="truncate">{project.name}</span>
          <OpenArrow className="size-3.5" />
        </span>
      </h3>
      <Mark tone={on ? card.verdict.tone : 'quiet'}>{on ? card.verdict.text : 'Off'}</Mark>
      {/* Last on the line, so nothing before it moves when hobkin writes the first one. */}
      {on && reportId ? (
        <Button variant="ghost" size="xs" data-stop="" aria-label={`YOLO report on ${project.name}`} onClick={() => openTarget({ to: 'report', id: reportId })} className="ml-auto shrink-0">
          Report
        </Button>
      ) : null}
    </div>
  )

  // Off, the card folds to its heading and one quiet line of what is not happening.
  if (!on) {
    const refused = said?.tone === 'refused'
    const line = refused ? `Not saved. ${said.text}` : offLine(project)
    return (
      <li aria-label={project.name} className="flex flex-col gap-1 rounded-2xl bg-background px-4 py-3">
        {heading}
        <p role={refused ? 'alert' : undefined} title={line} className={cn('h-5 truncate pl-11 text-[13px] leading-5', refused ? 'text-bad-fg' : 'text-muted-foreground')}>
          {line}
        </p>
      </li>
    )
  }

  const days = mergedDays(project, { zone: ZONE, now })
  const setUp = stillToSetUp(project)
  const placed = inPlace(project)

  return (
    <li aria-label={project.name} className="flex flex-col gap-2 rounded-2xl bg-background px-4 py-3">
      {heading}
      {said ? (
        <p role={said.tone === 'refused' ? 'alert' : undefined} title={said.text} className={cn('truncate text-[13px] leading-5', said.tone === 'refused' ? 'text-bad-fg' : 'text-foreground/85')}>
          {said.text}
        </p>
      ) : null}
      {card.blockers.length ? (
        <ul aria-label={`What stops changes merging on ${project.name}`} className="flex flex-col">
          {card.blockers.map((blocker) => (
            <BlockerLine key={blocker.key} blocker={blocker} name={project.name} busy={busy || setting.saving} onPress={act} />
          ))}
        </ul>
      ) : null}
      {card.changes.length ? (
        <Part heading="Waiting" count={card.changes.length}>
          {card.changes.map((row) => (
            <ChangeLine key={row.item} row={row} name={project.name} onReview={() => go(changeOpens(project.slug, row.item, live))} />
          ))}
        </Part>
      ) : null}
      {days.length ? (
        <Part heading="Merged by itself" count={project.merged?.length ?? 0}>
          {days.map(({ day, rows }) => (
            <li key={day} className="flex flex-col">
              <h5 className="pt-1 pb-0.5 text-[11.5px] font-medium text-muted-foreground">{day}</h5>
              <ul className="flex flex-col">
                {rows.map((row) => (
                  <MergedLine key={row.item} row={row} />
                ))}
              </ul>
            </li>
          ))}
        </Part>
      ) : null}
      <section aria-label={`Readiness of ${project.name}`} className="flex flex-col gap-1">
        <div className="flex h-7 items-center gap-2">
          <button
            type="button"
            data-stop=""
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
            className="pressable -mx-1.5 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 text-left text-[12.5px] text-muted-foreground hover:text-foreground"
          >
            <ChevronRightIcon aria-hidden="true" className={cn('size-3.5 shrink-0', open && 'rotate-90')} />
            <span className="truncate tabular-nums">{readinessLine(project, readiness)}</span>
          </button>
          <Button
            variant="ghost"
            size="xs"
            data-stop=""
            disabled={busy || !readiness.canRun}
            focusableWhenDisabled
            title={readiness.title}
            aria-label={`${readiness.title ?? readiness.action} on ${project.name}`}
            onClick={() => void runReadiness(readiness.press)}
            className="shrink-0 data-disabled:opacity-50"
          >
            {readiness.action}
          </Button>
        </div>
        {open ? (
          <>
            {setUp.map(({ heading, rows }) => (
              <section key={heading} aria-label={heading} className="flex flex-col">
                <h5 className="pt-1 pb-0.5 text-[11.5px] font-medium text-muted-foreground">{heading}</h5>
                <ul className="flex flex-col">
                  {rows.map((row) => (
                    <PartLine key={row.name} row={row} />
                  ))}
                </ul>
              </section>
            ))}
            {placed ? (
              <p title={placed} className="truncate pt-1 text-[12.5px] text-muted-foreground">
                {placed}
              </p>
            ) : null}
            {/* Its state machines' models on main, a part of its readiness when it has any (050-tla-proofs). */}
            <div data-models="" className="empty:hidden">
              <ProjectModels models={project.models ?? []} live={live} />
            </div>
          </>
        ) : null}
      </section>
    </li>
  )
}

/** Where a click goes: a project's page, a change's review in Change Review, or the change's card on Work when there is no review to name. */
function go(open: YoloOpen) {
  if (open.to === 'project') useView.getState().openProject(open.slug)
  else if (open.to === 'review') useView.getState().openReviewFor(open.id)
  else openOnWork(open.target)
}

/** One thing that stops changes merging: the reason, how many changes it holds, and the press that moves it. Each keeps its column, so nothing moves. */
function BlockerLine({ blocker, name, busy, onPress }: { blocker: Blocker; name: string; busy: boolean; onPress: (action: VerdictAction) => void }) {
  const { press } = blocker
  return (
    <li className="grid h-7 grid-cols-[minmax(0,1fr)_64px_136px] items-center gap-x-3 text-[12.5px]">
      <span title={blocker.detail ? `${blocker.text}\n${blocker.detail}` : blocker.text} className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warn-fg" />
        <span className="truncate">{blocker.text}</span>
      </span>
      <span className="text-right text-muted-foreground tabular-nums">{blocker.count ? `holds ${blocker.count}` : ''}</span>
      {press ? (
        <Button
          variant="outline"
          size="xs"
          data-stop=""
          disabled={busy}
          focusableWhenDisabled
          title={press.title}
          aria-label={`${press.title ?? press.label} on ${name}`}
          onClick={() => onPress(press)}
          className="w-[136px] justify-self-end data-disabled:opacity-50"
        >
          {press.label}
        </Button>
      ) : (
        <span aria-hidden="true" />
      )}
    </li>
  )
}

function Part({ heading, count, children }: { heading: string; count: number; children: ReactNode }) {
  return (
    <section aria-label={heading} className="flex flex-col gap-0.5">
      <h4 className="eyebrow flex h-6 items-center gap-2">
        {heading}
        <span className="tabular-nums">{count}</span>
      </h4>
      <ul className="flex flex-col">{children}</ul>
    </section>
  )
}

/**
 * A change waiting to merge, in one line: its title, its rate with the review's five numbers, and where it stands. The reason and the review's scores are the
 * line's tooltip. The row opens the change's review, and its arrow shows that it does.
 */
function ChangeLine({ row, name, onReview }: { row: CardChange; name: string; onReview: () => void }) {
  return (
    <li className="border-t border-border/60 first:border-t-0">
      <div
        {...pressProps(onReview)}
        title={row.tip}
        aria-label={`${row.title} on ${name}: ${row.state}, rate ${row.rate}, ${row.grades ? `grades ${row.grades}` : 'not graded'}. Opens its review.`}
        className="pressable -mx-2 grid h-8 grid-cols-[minmax(0,1fr)_150px_156px_16px] items-center gap-x-3 rounded-lg px-2 outline-offset-[-2px]"
      >
        <span className="truncate text-[13px] font-medium">{row.title}</span>
        <span className="text-right text-[12px] text-muted-foreground tabular-nums">
          <span className="font-semibold text-foreground">{row.rate}</span> · {row.grades ?? 'not graded'}
        </span>
        <Mark tone={row.tone}>{row.state}</Mark>
        <OpenArrow className="justify-self-end" />
      </div>
    </li>
  )
}

/** A change YOLO mode merged by itself: what it was and at which commit, then what became of its deploy, with how it held. */
function MergedLine({ row }: { row: MergedRow }) {
  return (
    <li className="grid h-12 grid-cols-[minmax(0,1fr)_minmax(0,auto)_84px] grid-rows-2 items-center gap-x-3 border-t border-border/60 first:border-t-0">
      <span title={row.title} className="truncate text-[13px] font-medium">
        {row.title}
      </span>
      <span title={row.what} className="truncate text-right text-[12px] text-muted-foreground tabular-nums">
        {row.what}
      </span>
      <span className="row-span-2 justify-self-end">{row.held ? <Mark tone={row.tone}>{row.held}</Mark> : null}</span>
      <span title={row.deploy} className="col-span-2 truncate text-[12.5px] text-muted-foreground">
        {row.deploy}
      </span>
    </li>
  )
}

/** A part still to set up: where it stands, hobkin's line, and its PR, its Action Item or its branch's card. Every line has the same columns. */
function PartLine({ row }: { row: PartRow }) {
  return (
    <li className="grid h-7 grid-cols-[128px_140px_minmax(0,1fr)_80px] items-center gap-x-3 text-[12.5px]">
      <span className="truncate font-medium">{row.label}</span>
      <Mark tone={row.tone} className="justify-self-start">
        {row.state}
      </Mark>
      <span title={row.line} className="truncate text-muted-foreground">
        {row.line}
      </span>
      <PartButton open={row.open} label={row.label} />
    </li>
  )
}

/** A part's PR opens on GitHub, its Action Item under Action Items, and a branch whose PR did not open its card on Work. */
function PartButton({ open, label }: { open: PartOpen | null; label: string }) {
  if (!open) return <span aria-hidden="true" />
  if (open.to === 'pr') {
    return (
      <a
        href={open.url}
        target="_blank"
        rel="noopener noreferrer"
        data-stop=""
        aria-label={`${open.label} for ${label}`}
        onClick={(event) => openOnGitHub(event, open.url)}
        className="justify-self-end text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {open.label}
      </a>
    )
  }
  const go = () => (open.to === 'action' ? openTarget({ to: 'action', id: open.id }) : openOnWork(`[data-change="${open.key}"]`))
  return (
    <Button variant="ghost" size="xs" data-stop="" aria-label={`${open.label} for ${label}`} onClick={go} className="justify-self-end">
      {open.label}
    </Button>
  )
}
