import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { requestCanvasFocus } from '@/app/focus.ts'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useStops } from '@/app/stops.ts'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { rateChoices, readyCount, SAMPLE_YOLO, sampleAfter, yoloSays } from '@/features/settings/yolo.ts'
import { runCommand } from '@/lib/host/client.ts'
import { cn } from '@/lib/utils.ts'
import type { FinishedGroup, YoloProject, YoloState } from '#shared/protocol/work.ts'
import { SectionHeading, Segmented } from './parts.tsx'
import { runWork, useWorkView } from './store.ts'
import { openOnWork } from './work-target.ts'
import { readinessRow, sampleReadiness, waitingChange, type ReadinessPress, type ReadinessTone } from './yolo-page.ts'
import { ProjectModels, ProofSetup } from '@/features/proofs/ProjectModels.tsx'

type SetSample = Dispatch<SetStateAction<YoloState>>

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

/** Back to Work, onto the button that opened this page, as World's Back to Work does. */
export function backToWork() {
  useView.getState().openScreen('work')
  requestCanvasFocus('[data-opens="yolo"]')
}

/**
 * YOLO mode, a page of its own opened from Work's header, as World is (049-yolo-mode): the switch that lets small,
 * well-reviewed changes merge and deploy by themselves, the lowest general rate it accepts, and each project's
 * readiness, which runs from here whether the switch is on or off. Everything shown is hobkin's work status, live.
 * Without a host it shows sample data, and a click changes only that.
 */
export function YoloScreen() {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)
  const { work, live } = useWorkView()
  const [sample, setSample] = useState(SAMPLE_YOLO)
  const yolo = live ? (work?.yolo ?? null) : sample
  const now = useNow(true, 30_000)

  return (
    <div ref={root} className={SCREEN_SCROLLER}>
      <div className={`${SCREEN_COLUMN} flex flex-col gap-6 pb-20`}>
        <header className="flex items-center justify-between gap-4">
          <h1 className="eyebrow">Work / YOLO mode</h1>
          <Button data-stop="" onClick={backToWork}>
            Back to Work
          </Button>
        </header>
        {yolo ? (
          <>
            <Switchboard yolo={yolo} live={live} setSample={setSample} />
            <Readiness yolo={yolo} live={live} workOn={work?.enabled ?? false} finished={work?.finished ?? []} now={now} setSample={setSample} />
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
function Switchboard({ yolo, live, setSample }: { yolo: YoloState; live: boolean; setSample: SetSample }) {
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

/** What every readiness row needs besides its project: where the data comes from, whether work mode is on, Work's finished changes, and the time now. */
interface ReadinessContext {
  live: boolean
  workOn: boolean
  finished: FinishedGroup[]
  now: number
  setSample: SetSample
}

function Readiness({ yolo, live, workOn, finished, now, setSample }: ReadinessContext & { yolo: YoloState }) {
  return (
    <section aria-label="Readiness" className="flex flex-col gap-3">
      <SectionHeading label="Readiness" count={readyCount(yolo)} />
      <p className="px-1 text-[13px] leading-snug text-muted-foreground">
        A check is work mode&apos;s own work, on a branch for your yes. It merges and deploys nothing, so a project can be got ready before YOLO mode is on.
      </p>
      <ProofSetup live={live} />
      {yolo.projects.length ? (
        <ul aria-label="Projects" className="flex flex-col gap-2">
          {yolo.projects.map((project) => (
            <ProjectReadiness key={project.slug} project={project} live={live} workOn={workOn} finished={finished} now={now} setSample={setSample} />
          ))}
        </ul>
      ) : (
        <p className="px-1 text-[13px] text-muted-foreground">No projects yet. Take one on Work first.</p>
      )}
    </section>
  )
}

const TONES: Record<ReadinessTone, string> = {
  ok: 'bg-ok/15 text-ok-fg',
  live: 'bg-sun/20 text-sun-fg',
  warn: 'bg-warn/15 text-warn-fg',
  quiet: 'bg-surface-2 text-muted-foreground',
}

/** What hobkin said to the last press. */
interface Said {
  text: string
  tone: 'done' | 'refused'
}

/**
 * One project: where its readiness stands, when it was last checked, and the button that runs it now. While its branch
 * waits for the user's yes, the button is that yes, as the branch's card on Work offers it, or opens the card there
 * when it needs the user. The row has one height and its words two lines, so the button never moves while its status
 * changes live.
 */
function ProjectReadiness({ project, live, workOn, finished, now, setSample }: ReadinessContext & { project: YoloProject }) {
  const row = readinessRow(project, { workOn, now, zone: ZONE, waiting: waitingChange(project, finished) })
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<Said | null>(null)

  // hobkin's answer goes once the work moves on, except that a start which waits keeps saying why until it runs.
  useEffect(() => {
    setSaid((current) => (current?.tone === 'done' && project.work === 'queued' ? current : null))
  }, [project.work])

  const run = async (press: ReadinessPress) => {
    if (busy || !row.canRun) return
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
        // The same yes as its card on Work, at the commit the card shows. What hobkin says is the row's until the work moves on.
        const said = await runWork({ do: 'change', change: press.change, choice: press.choice }, { live, place: press.change.key })
        setSaid(said)
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

  const detail = said?.text || row.detail

  return (
    <li className="flex flex-col rounded-2xl bg-surface px-4 has-[[data-models]:not(:empty)]:pb-3">
      <div className="grid h-[84px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-heading text-[14px] font-medium">{project.name}</span>
            <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-2 font-heading text-[11px] font-semibold whitespace-nowrap', TONES[row.tone])}>{row.state}</span>
            <span className="shrink-0 truncate text-[12px] text-muted-foreground tabular-nums">{row.checked}</span>
          </div>
          <p
            role={said?.tone === 'refused' ? 'alert' : undefined}
            title={detail}
            className={cn('line-clamp-2 h-9 text-[12.5px] leading-[18px] break-words', said?.tone === 'refused' ? 'text-bad-fg' : 'text-muted-foreground')}
          >
            {detail}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          data-stop=""
          disabled={busy || !row.canRun}
          focusableWhenDisabled
          title={row.title}
          aria-label={`${row.title ?? row.action} on ${project.name}`}
          onClick={() => void run(row.press)}
          className="w-[120px] data-disabled:opacity-50"
        >
          {row.action}
        </Button>
      </div>
      {/* Its state machines' models on main, a part of its readiness when it has any (050-tla-proofs). */}
      <div data-models="" className="empty:hidden">
        <ProjectModels models={project.models ?? []} live={live} />
      </div>
    </li>
  )
}
