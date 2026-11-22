import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { requestCanvasFocus } from '@/app/focus.ts'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useStops } from '@/app/stops.ts'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { openGitHubPage, openOnGitHub } from '@/features/github/open.ts'
import { openTarget } from '@/features/home/navigate.ts'
import { StatTile } from '@/features/numbers/StatTile.tsx'
import { READ_WORDS, useWorkMetrics } from '@/features/numbers/use-work-metrics.ts'
import { ProjectModels, ProofSetup } from '@/features/proofs/ProjectModels.tsx'
import { useReports } from '@/features/reports/store.ts'
import { finishedReviewId } from '@/features/review/entry.ts'
import { rateChoices, readyCount, SAMPLE_YOLO, sampleAfter, yoloSays } from '@/features/settings/yolo.ts'
import { runCommand } from '@/lib/host/client.ts'
import { cn } from '@/lib/utils.ts'
import type { FinishedGroup, WorkProject, YoloProject, YoloState } from '#shared/protocol/work.ts'
import { SectionHeading, Segmented } from './parts.tsx'
import { runWork, useWorkView } from './store.ts'
import { openOnWork } from './work-target.ts'
import {
  changeRows,
  inPlace,
  mergedDays,
  mergesHeld,
  readinessRow,
  sampleReadiness,
  stillToSetUp,
  trustTiles,
  waitingChange,
  yoloReportId,
  yoloVerdict,
  type ChangeRow,
  type MergedRow,
  type PartOpen,
  type PartRow,
  type ReadinessPress,
  type StatusLine,
  type TrustTile,
  type VerdictAction,
  type VerdictTone,
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
  const trust = useMemo(() => trustTiles(metrics?.all.days ?? null, metrics ? null : READ_WORDS[state]), [metrics, state])

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
            <Projects yolo={yolo} live={live} workOn={live ? (work?.enabled ?? false) : true} workProjects={work?.projects ?? []} finished={work?.finished ?? []} setting={setting} setSample={setSample} />
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
    <section aria-label="YOLO mode" className="flex flex-col gap-3 rounded-3xl bg-surface px-5 py-4">
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
  return (
    <section aria-label="Projects" className="flex flex-col gap-3">
      <SectionHeading label="Projects" count={readyCount(yolo)} />
      <p className="px-1 text-[13px] leading-snug text-muted-foreground">
        Each project says what YOLO mode does there and, when it does nothing, why and the one thing that moves it. Readiness sets up the rest as PRs for your merge and asks you only for what you alone can give, with YOLO mode on or off.
      </p>
      <ProofSetup live={live} />
      {yolo.projects.length ? (
        <ul aria-label="Projects" className="flex flex-col gap-3">
          {yolo.projects.map((project) => (
            <ProjectCard key={project.slug} project={project} workProject={workProjects.find(({ slug }) => slug === project.slug)} {...context} />
          ))}
        </ul>
      ) : (
        <p className="px-1 text-[13px] text-muted-foreground">No projects yet. Take one on Work first.</p>
      )}
    </section>
  )
}

const TONES: Record<VerdictTone, string> = {
  ok: 'bg-ok/15 text-ok-fg',
  live: 'bg-sun/20 text-sun-fg',
  warn: 'bg-warn/15 text-warn-fg',
  quiet: 'bg-surface-2 text-muted-foreground',
  bad: 'bg-bad/15 text-bad-fg',
}

function Chip({ tone, children, className }: { tone: VerdictTone; children: string; className?: string }) {
  return <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-2 font-heading text-[11px] font-semibold whitespace-nowrap', TONES[tone], className)}>{children}</span>
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

  // hobkin's answer goes once the work moves on, except that a start which waits keeps saying why until it runs.
  useEffect(() => {
    setSaid((current) => (current?.tone === 'done' && project.work === 'queued' ? current : null))
  }, [project.work])

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
        return openReview(project.slug, press.item, live)
      case 'rate':
        return void setting.change({ rate: press.rate })
    }
  }

  const changes = changeRows(project, { rate: yolo.rate, holds: mergesHeld(project, context) })
  const days = mergedDays(project, { zone: ZONE, now })
  const setUp = stillToSetUp(project)
  const placed = inPlace(project)

  return (
    <li aria-label={project.name} className="flex flex-col gap-3 rounded-2xl bg-surface px-4 py-3">
      <div className="grid h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate font-heading text-[15px] font-semibold">{project.name}</h3>
          <Chip tone={readiness.tone}>{readiness.state}</Chip>
          {/* Last on the line, so nothing before it moves when hobkin writes the first one. */}
          {reportId ? (
            <Button variant="ghost" size="xs" data-stop="" aria-label={`YOLO report on ${project.name}`} onClick={() => openTarget({ to: 'report', id: reportId })} className="shrink-0">
              Report
            </Button>
          ) : null}
        </div>
        <PrimaryPress action={verdict.action} busy={busy || setting.saving} name={project.name} onPress={act} />
      </div>
      <dl className="grid grid-cols-[64px_88px_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
        <Status label="Merges" line={verdict.merges} said={said} />
        <Status label="Deploys" line={verdict.deploys} said={null} />
      </dl>
      {changes.length ? (
        <Part heading="Next to merge" count={changes.length}>
          {changes.map((row) => (
            <ChangeLine key={row.item} row={row} name={project.name} onReview={() => openReview(project.slug, row.item, live)} />
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

/** A change's review in Change Review, or its card on Work when the window cannot name its review. */
function openReview(slug: string, item: string, live: boolean) {
  const reviewId = finishedReviewId({ slug, item }, live)
  if (reviewId && live) useView.getState().openReviewFor(reviewId)
  else openOnWork(`[data-change="${slug}:${item}"]`)
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
        <Chip tone={line.tone}>{line.state}</Chip>
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

/** A change waiting to merge: its title, kind and rate against the user's on the first line, and why it asks on the second. Every row has the same columns. */
function ChangeLine({ row, name, onReview }: { row: ChangeRow; name: string; onReview: () => void }) {
  return (
    <li className="grid h-12 grid-cols-[minmax(0,1fr)_136px_40px_112px_72px] grid-rows-2 items-center gap-x-3 border-t border-border/60 first:border-t-0">
      <span title={row.title} className="truncate text-[13px] font-medium">
        {row.title}
      </span>
      <span title={row.kind} className="truncate text-right text-[12px] text-muted-foreground">
        {row.kind}
      </span>
      <Chip tone={row.tone} className="justify-self-center tabular-nums">
        {row.rate}
      </Chip>
      <span className="truncate text-[12px] text-muted-foreground tabular-nums">{row.against}</span>
      <Button variant="ghost" size="xs" data-stop="" aria-label={`Review "${row.title}" on ${name}`} onClick={onReview} className="row-span-2 justify-self-end">
        Review
      </Button>
      <span title={row.why} className="col-span-4 truncate text-[12.5px] text-muted-foreground">
        {row.why}
      </span>
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
      <span className="row-span-2 justify-self-end">{row.held ? <Chip tone={row.tone}>{row.held}</Chip> : null}</span>
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
      <Chip tone={row.tone} className="justify-self-start">
        {row.state}
      </Chip>
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
