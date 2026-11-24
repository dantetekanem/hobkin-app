import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
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
import { rateChoices, readyCount, SAMPLE_YOLO, sampleAfter, yoloSays } from '@/features/settings/yolo.ts'
import { runCommand } from '@/lib/host/client.ts'
import { cn } from '@/lib/utils.ts'
import type { FinishedGroup, WorkProject, YoloProject, YoloState } from '#shared/protocol/work.ts'
import { SectionHeading, Segmented } from './parts.tsx'
import { runWork, useWorkView } from './store.ts'
import { openOnWork } from './work-target.ts'
import {
  byItselfBars,
  changeOpens,
  changeRows,
  gates,
  GATES_COUNTS,
  hasSwitch,
  inPlace,
  isOn,
  mergedDays,
  mergedLine,
  mergesHeld,
  offLine,
  projectOpens,
  projectOrder,
  readinessRow,
  sampleReadiness,
  sampleSwitch,
  stillToSetUp,
  switchesSay,
  trustTiles,
  waitingChange,
  yoloReportId,
  yoloVerdict,
  type ByItselfBars,
  type ChangeRow,
  type Gates,
  type MergedRow,
  type PartOpen,
  type PartRow,
  type ReadinessPress,
  type StatusLine,
  type TrustTile,
  type VerdictAction,
  type VerdictTone,
  type YoloOpen,
} from './yolo-page.ts'

type SetSample = Dispatch<SetStateAction<YoloState>>

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
  const [sample, setSample] = useState(SAMPLE_YOLO)
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
    <div ref={root} className={SCREEN_SCROLLER}>
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
            <Projects yolo={yolo} live={live} workOn={workOn} workProjects={work?.projects ?? []} finished={work?.finished ?? []} setting={setting} setSample={setSample} />
          </>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">This hobkin has not said how YOLO mode stands yet.</p>
        )}
        {live ? null : <p className="text-[12px] text-muted-foreground">Sample data. No host is running, so nothing here reaches hobkin.</p>}
      </div>
    </div>
  )
}

/** The switch and the lowest rate. What the switch means sits in two lines whatever it says, so nothing under it moves. */
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
      <p role={problem ? 'alert' : undefined} className={cn('line-clamp-2 h-10 text-[13px] leading-5', problem ? 'text-bad-fg' : 'text-muted-foreground')}>
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
}

function Projects({ workProjects, ...context }: CardContext & { workProjects: WorkProject[] }) {
  const { yolo, live } = context
  // The order the page opened with holds while it is open, so a card whose switch was just pressed stays under the pointer.
  const kept = useRef<string[] | null>(null)
  const ordered = projectOrder(yolo.projects, kept.current)
  if (!kept.current && ordered.length) kept.current = ordered.map(({ slug }) => slug)
  const switches = switchesSay(yolo)
  return (
    <section aria-label="Projects" className="flex flex-col gap-3">
      <SectionHeading label="Projects" count={readyCount(yolo)} />
      <p className="px-1 text-[13px] leading-snug text-muted-foreground">
        Each project says what YOLO mode does there and, when it does nothing, why and the one thing that moves it. Readiness sets up the rest as PRs for your merge and asks you only for what you alone can give, with YOLO mode on or off.
        {switches ? ` ${switches}` : null}
      </p>
      <ProofSetup live={live} />
      {ordered.length ? (
        <ul aria-label="Projects" className="flex flex-col gap-3">
          {ordered.map((project) => (
            <ProjectCard key={project.slug} project={project} workProject={workProjects.find(({ slug }) => slug === project.slug)} {...context} />
          ))}
        </ul>
      ) : (
        <p className="px-1 text-[13px] text-muted-foreground">No projects yet. Take one on Work first.</p>
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
 * One project, in the order the user reads it: what YOLO mode does there and the one press that moves it, what waits to
 * merge, what merged by itself, then its readiness. The header and the two status lines keep their height whatever they
 * say, so the press never moves while the status changes live.
 */
function ProjectCard({ project, workProject, yolo, live, workOn, finished, setting, setSample }: CardContext & { project: YoloProject; workProject: WorkProject | undefined }) {
  // The card says when readiness was last checked, so it follows the clock itself: the page around it does not.
  const now = useNow(true, 30_000)
  const readiness = readinessRow(project, { workOn, now, zone: ZONE, waiting: waitingChange(project, finished) })
  const context = {
    on: yolo.on,
    rate: yolo.rate,
    lowest: yolo.lowest,
    waits: yolo.waits ?? (workOn ? null : 'work mode is off'),
    paused: workProject?.paused ?? false,
    prMode: workProject?.prMode ?? 'off',
    readiness,
  }
  const verdict = yoloVerdict(project, context)
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
    <div className="grid h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
      <div className="flex min-w-0 items-center gap-2">
        {hasSwitch(project) ? (
          <Switch checked={on} disabled={switching} onCheckedChange={(next) => void toggle(next)} aria-label={`YOLO mode on ${project.name}`} data-stop="" className="mr-1" />
        ) : null}
        <h3 className="min-w-0 font-heading text-[15px] font-semibold">
          {/* A box rather than a button: WebKit lays a button's content out in a box of its own, which cut the name short. */}
          <span {...pressProps(() => go(projectOpens(project.slug)))} aria-label={`${project.name}: opens its page`} className="pressable -mx-1.5 flex h-7 min-w-0 items-center gap-1 rounded-lg px-1.5">
            <span className="truncate">{project.name}</span>
            <OpenArrow className="size-3.5" />
          </span>
        </h3>
        {on ? <Mark tone={readiness.tone}>{readiness.state}</Mark> : null}
        {/* Last on the line, so nothing before it moves when hobkin writes the first one. */}
        {on && reportId ? (
          <Button variant="ghost" size="xs" data-stop="" aria-label={`YOLO report on ${project.name}`} onClick={() => openTarget({ to: 'report', id: reportId })} className="shrink-0">
            Report
          </Button>
        ) : null}
      </div>
      {on ? <PrimaryPress action={verdict.action} busy={busy || setting.saving} name={project.name} onPress={act} /> : null}
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

  const changes = changeRows(project, { rate: yolo.rate, holds: mergesHeld(project, context) })
  const days = mergedDays(project, { zone: ZONE, now })
  const setUp = stillToSetUp(project)
  const placed = inPlace(project)

  return (
    <li aria-label={project.name} className="flex flex-col gap-3 rounded-2xl bg-background px-4 py-3">
      {heading}
      <dl className="grid grid-cols-[64px_88px_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
        <Status label="Merges" line={verdict.merges} said={said} />
        <Status label="Deploys" line={verdict.deploys} said={null} />
      </dl>
      {changes.length ? (
        <Part heading="Next to merge" count={changes.length}>
          {changes.map((row) => (
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
          <h4 className="eyebrow">Readiness</h4>
          <span className="truncate text-[12px] text-muted-foreground tabular-nums">{readiness.checked}</span>
          <Button
            variant="ghost"
            size="xs"
            data-stop=""
            disabled={busy || !readiness.canRun}
            focusableWhenDisabled
            title={readiness.title}
            aria-label={`${readiness.title ?? readiness.action} on ${project.name}`}
            onClick={() => void runReadiness(readiness.press)}
            className="ml-auto data-disabled:opacity-50"
          >
            {readiness.action}
          </Button>
        </div>
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

/** The one press that moves YOLO mode on the project. Its place keeps its width when there is none, so the line beside it never moves. */
function PrimaryPress({ action, busy, name, onPress }: { action: VerdictAction | null; busy: boolean; name: string; onPress: (action: VerdictAction) => void }) {
  if (!action) return <span aria-hidden="true" className="w-[136px]" />
  return (
    <Button
      variant="default"
      size="sm"
      data-stop=""
      disabled={busy}
      focusableWhenDisabled
      title={action.title}
      aria-label={`${action.title ?? action.label} on ${name}`}
      onClick={() => onPress(action)}
      className="w-[136px] data-disabled:opacity-50"
    >
      {action.label}
    </Button>
  )
}

/** One status line: what, where it stands, and why, in two lines at most. hobkin's answer to the last press takes the line until the work moves on. */
function Status({ label, line, said }: { label: string; line: StatusLine; said: Said | null }) {
  const text = said?.text || line.text
  return (
    <>
      <dt className="eyebrow flex h-5 items-center">{label}</dt>
      <dd className="flex h-5 items-center">
        <Mark tone={line.tone}>{line.state}</Mark>
      </dd>
      <dd
        role={said?.tone === 'refused' ? 'alert' : undefined}
        title={text}
        className={cn('line-clamp-2 h-10 text-[13px] leading-5 break-words', said?.tone === 'refused' ? 'text-bad-fg' : 'text-foreground/85')}
      >
        {text}
      </dd>
    </>
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
 * A change waiting to merge: its title, kind and rate against the user's on the first line, and why it asks on the second.
 * Every row has the same columns. The row opens the change's review, and its arrow shows that it does.
 */
function ChangeLine({ row, name, onReview }: { row: ChangeRow; name: string; onReview: () => void }) {
  return (
    <li className="border-t border-border/60 first:border-t-0">
      <div
        {...pressProps(onReview)}
        aria-label={`${row.title} on ${name}: ${row.kind}, rated ${row.rate}, ${row.against}. Opens its review.`}
        className="pressable -mx-2 grid h-12 grid-cols-[minmax(0,1fr)_136px_44px_112px_16px] grid-rows-2 items-center gap-x-3 rounded-lg px-2 outline-offset-[-2px]"
      >
        <span title={row.title} className="truncate text-[13px] font-medium">
          {row.title}
        </span>
        <span title={row.kind} className="truncate text-right text-[12px] text-muted-foreground">
          {row.kind}
        </span>
        <Mark tone={row.tone} className="justify-self-start tabular-nums">
          {row.rate}
        </Mark>
        <span className="truncate text-[12px] text-muted-foreground tabular-nums">{row.against}</span>
        <OpenArrow className="row-span-2 justify-self-end" />
        <span title={row.why} className="col-span-4 truncate text-[12.5px] text-muted-foreground">
          {row.why}
        </span>
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
