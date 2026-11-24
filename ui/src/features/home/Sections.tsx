import { useState, type ReactNode } from 'react'
import { CalendarClock, Check, CircleCheck, Folder, GitMerge, GitPullRequest, LayoutGrid, Lightbulb, MessageCircleQuestion, Plug, Rocket, Signpost, X } from 'lucide-react'
import { Hob } from '@/avatar/Hob.tsx'
import { cn } from '@/lib/utils.ts'
import { useStill } from '@/features/reports/still.ts'
import { clockTime, timeOf, waited } from '../reports/time.ts'
import { dismiss } from './dismissals.ts'
import { openTarget } from './navigate.ts'
import { Empty, More, Row, Rows, ToneDot, Widget } from './parts.tsx'
import type { CustomWidget, DayMark, HomeModel, HomeTarget, HomeYolo, NeedKind, NeedRow } from './types.ts'

const WAITING = 'Waiting for hobkin.'

const screen = (name: Extract<HomeTarget, { to: 'screen' }>['screen']): HomeTarget => ({ to: 'screen', screen: name })

/** A link in a section's header: "See all", or where the section's subject lives. */
function HeaderLink({ target, children }: { target: HomeTarget; children: ReactNode }) {
  return (
    <button type="button" onClick={() => openTarget(target)} className="min-w-0 shrink truncate rounded-md text-[13px] text-muted-foreground hover:text-foreground">
      {children}
    </button>
  )
}

function Section({ title, aside, className, children }: { title: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={cn('flex h-full min-w-0 flex-col gap-3 rounded-[20px] border border-border bg-surface px-5 py-[18px]', className)}>
      <header className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="shrink-0 text-base font-semibold">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  )
}

const HOURS = [6, 12, 18]
const hourLabel = (hour: number) => (hour === 12 ? 'Noon' : new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour)))

const RUN_LOOK: Record<DayMark['state'], string> = {
  done: 'size-3 bg-border-strong',
  failed: 'size-3.5 bg-bad',
  next: 'size-3.5 border-2 border-border-strong bg-surface',
}
const RUN_NOTE: Record<DayMark['state'], string> = { done: 'done', failed: 'failed', next: 'coming up' }

/** Today from midnight to midnight: every run as a dot, now as a yellow line, and the chosen run named under it. */
export function Today({ upcoming, unavailable }: { upcoming: HomeModel['upcoming']; unavailable: boolean }) {
  const still = useStill()
  const { day } = upcoming
  const [picked, setPicked] = useState<number | null>(null)
  // Until the user picks a run, the next one to come is named, or the last one when nothing is left today.
  const firstNext = day.marks.findIndex(mark => mark.state === 'next')
  const fallback = firstNext >= 0 ? firstNext : day.marks.length - 1
  const index = picked !== null && picked < day.marks.length ? picked : fallback
  const mark = day.marks[index]
  const next = upcoming.rows[0]
  const summary = [upcoming.summary, next ? `next: ${next.title} at ${next.aside}` : null].filter(Boolean).join(' · ')
  const position = (at: number) => `${Math.max(0, Math.min(100, (at - day.start) / (day.end - day.start) * 100))}%`
  const hourAt = (hour: number) => new Date(new Date(day.start).setHours(hour)).getTime()

  return (
    <Section title="Today" aside={summary ? <p className="min-w-0 truncate text-[13px] text-muted-foreground">{summary}</p> : null}>
      {unavailable ? (
        <Empty icon={<CalendarClock />}>{WAITING}</Empty>
      ) : (
        <>
          <div role="group" aria-label="Today's runs" className="relative h-16">
            <span aria-hidden="true" className="absolute inset-x-0 top-[30px] h-1 rounded-full bg-tone-1" />
            <span aria-hidden="true" style={{ width: position(day.now) }} className="absolute left-0 top-[30px] h-1 rounded-full bg-border-strong/50" />
            {day.marks.map((run, at) => (
              <button
                key={`${run.at}:${at}`}
                type="button"
                aria-label={`${clockTime(run.at)} ${run.title}, ${RUN_NOTE[run.state]}`}
                aria-pressed={at === index}
                onClick={() => setPicked(at)}
                style={{ left: position(run.at) }}
                className="absolute top-[18px] -ml-3.5 grid size-7 place-items-center rounded-full"
              >
                <span className={cn('block rounded-full', RUN_LOOK[run.state], at === index ? 'ring-2 ring-sun ring-offset-2 ring-offset-surface' : '')} />
              </button>
            ))}
            <span aria-hidden="true" style={{ left: position(day.now) }} className="pointer-events-none absolute top-2 -ml-px h-12 w-0.5 rounded-full bg-sun" />
            <span aria-hidden="true" data-still={still || undefined} style={{ left: position(day.now) }} className="home-pulse pointer-events-none absolute top-[26px] -ml-1.5 size-3 rounded-full bg-sun" />
            {HOURS.map(hour => (
              <span key={hour} aria-hidden="true" style={{ left: position(hourAt(hour)) }} className="absolute bottom-[-2px] -translate-x-1/2 font-mono text-[11px] text-muted-foreground">{hourLabel(hour)}</span>
            ))}
          </div>
          <div className="flex min-h-5 min-w-0 items-baseline gap-1.5 text-[13.5px]">
            {mark ? (
              <>
                <span className="min-w-0 truncate font-semibold">{clockTime(mark.at)} {mark.title}</span>
                <span className="shrink-0 text-muted-foreground">{RUN_NOTE[mark.state]}</span>
                <button type="button" onClick={() => openTarget(mark.target)} className="ml-auto shrink-0 rounded-md text-[13px] text-muted-foreground hover:text-foreground">
                  {mark.target.to === 'report' ? 'Read report' : 'See routine'}
                </button>
              </>
            ) : (
              <span className="text-muted-foreground">No runs today yet.</span>
            )}
          </div>
        </>
      )}
    </Section>
  )
}

const NEED_ICON: Record<NeedKind, ReactNode> = {
  question: <MessageCircleQuestion />,
  decision: <Signpost />,
  review: <GitMerge />,
  integration: <GitPullRequest />,
  connection: <Plug />,
  proposal: <Lightbulb />,
}

export function Needs({ needs, unavailable }: { needs: HomeModel['needs']; unavailable: boolean }) {
  const actions = screen('actions')
  const icon = (row: NeedRow) => (row.action.target.to === 'review' ? <GitMerge /> : NEED_ICON[row.kind])
  return (
    <Section title="Needs you" aside={<HeaderLink target={actions}>See all</HeaderLink>}>
      {needs.rows.length ? (
        <Rows>
          {needs.rows.map(row => (
            <Row key={row.id} row={row} list={needs.rows} icon={icon(row)} onDismiss={row.id.startsWith('reminder:') ? undefined : () => dismiss(row.id)} />
          ))}
        </Rows>
      ) : (
        <Empty icon={<CircleCheck className="text-ok-fg" />}>{unavailable ? WAITING : 'Nothing is waiting for you.'}</Empty>
      )}
      <More count={needs.more} target={actions} />
    </Section>
  )
}

/** YOLO mode as it stands, and how far each project is. Its switch and readiness checks live on its own page, which the header link opens. */
export function Yolo({ yolo }: { yolo: HomeYolo | null }) {
  const page = screen('yolo')
  const allReady = yolo !== null && yolo.projects.length > 0 && yolo.projects.every(project => project.ready)
  return (
    <Section title="YOLO mode" aside={<HeaderLink target={page}>Open</HeaderLink>}>
      {!yolo ? (
        <Empty icon={<Rocket />}>hobkin has not said how YOLO mode stands yet.</Empty>
      ) : (
        <>
          <p className={cn('flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[13px] font-semibold', yolo.on ? 'border-sun/50 bg-sun/20' : 'border-border text-muted-foreground')}>
            <span aria-hidden="true" className={cn('size-2.5 rounded-full', yolo.on ? 'bg-sun' : 'bg-border-strong')} />
            {yolo.on ? `On · rate ${yolo.rate}+` : 'Off'}
          </p>
          {yolo.on ? (
            <>
              <p className="text-sm">
                <span className="font-semibold">{allReady ? 'Every project is ready.' : 'Getting projects ready first.'}</span>{' '}
                <span className="text-muted-foreground">{yolo.summary}. Only ready projects merge and deploy by themselves.</span>
              </p>
              {yolo.projects.length ? (
                <ul aria-label="Projects in YOLO mode" className="flex flex-col gap-2">
                  {yolo.projects.map(project => (
                    <li key={project.slug} className="flex min-w-0 items-center gap-2.5 text-[13px]">
                      <span aria-hidden="true" className={cn('grid size-[18px] shrink-0 place-items-center rounded-full text-[11px] font-bold text-primary-foreground', project.ready ? 'bg-ok' : 'bg-warn')}>
                        {project.ready ? <Check className="size-3" strokeWidth={3} /> : '!'}
                      </span>
                      <span className="shrink-0 font-medium">{project.name}</span>
                      <span title={project.note} className="min-w-0 flex-1 truncate text-right text-muted-foreground">{project.note}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">{yolo.says}</p>
          )}
        </>
      )}
    </Section>
  )
}

export function Problems({ problems, unavailable }: { problems: HomeModel['problems']; unavailable: boolean }) {
  const any = problems.rows.length > 0
  const face = any
    ? <Hob mood="sad" tint="var(--hb-bad-fg)" eye="var(--hb-surface)" stage="var(--hb-surface)" size={44} still className="-my-2.5" title="hobkin, sad" />
    : <Hob mood="happy" stage="var(--hb-surface)" size={44} still className="-my-2.5" title="hobkin, happy" />
  return (
    <Section title="Problems" aside={face}>
      {any ? (
        <ul className="flex flex-col gap-2">
          {problems.rows.map(row => (
            <li key={row.id} className={cn('flex min-w-0 items-start rounded-[14px] border border-border', row.tone === 'bad' ? 'bg-bad/10' : 'bg-warn/10')}>
              <button type="button" onClick={() => openTarget(row.action.target)} className="flex min-w-0 flex-1 flex-col gap-[3px] py-2.5 pl-3 text-left">
                <span className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold">{row.title}</span>
                  {row.aside ? <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{row.aside}</span> : null}
                </span>
                {row.detail ? <span className="line-clamp-2 text-[13px] text-muted-foreground">{row.detail}</span> : null}
              </button>
              <button type="button" aria-label={`Dismiss: ${row.title}`} onClick={() => dismiss(row.id)} className="m-1.5 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground">
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={<CircleCheck className="text-ok-fg" />}>{unavailable ? WAITING : 'No unread problems.'}</Empty>
      )}
      <More count={problems.more} target={screen('reports')} />
    </Section>
  )
}

/** The tallest bar's height, in pixels. */
const BAR = 96

export function Week({ week, unavailable }: { week: HomeModel['week']; unavailable: boolean }) {
  const still = useStill()
  const most = Math.max(1, ...week.days.map(day => day.completed + day.failed + day.stopped))
  const won = week.wins !== null && week.wins.merged + week.wins.decided > 0
  const footer = [
    week.wins ? `${week.wins.merged} merged and ${week.wins.decided} decided today` : null,
    `${week.completed} runs done, ${week.unfinished} failed or stopped this week`,
  ].filter(Boolean).join(' · ')
  return (
    <Section title="This week" aside={week.wins && week.wins.streak > 1 ? <span className="text-[13px] font-semibold text-sun-fg">{week.wins.streak}-day streak</span> : null}>
      {unavailable ? (
        <Empty icon={<CalendarClock />}>{WAITING}</Empty>
      ) : (
        <>
          <ul aria-label="Runs by day" className="flex h-[156px] items-end gap-2.5">
            {week.days.map(day => {
              const total = day.completed + day.failed + day.stopped
              return (
                <li key={day.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                  {day.today ? <Hob mood={won ? 'happy' : 'idle'} still={still} size={44} stage="var(--hb-surface)" className="-mb-3 shrink-0" /> : null}
                  <button
                    type="button"
                    disabled={!day.openId}
                    onClick={() => day.openId && openTarget({ to: 'report', id: day.openId })}
                    aria-label={`${day.label}: ${day.completed} completed, ${day.failed} failed, ${day.stopped} stopped`}
                    style={{ height: Math.max(6, total / most * BAR) }}
                    className="flex w-full max-w-[34px] flex-col overflow-hidden rounded-t-lg rounded-b-sm enabled:hover:opacity-80"
                  >
                    {total ? (
                      <>
                        <span style={{ height: `${(day.failed + day.stopped) / total * 100}%` }} className="w-full shrink-0 bg-bad" />
                        <span className={cn('w-full flex-1', day.today ? 'bg-sun' : 'bg-border-strong')} />
                      </>
                    ) : (
                      <span className={cn('w-full flex-1', day.today ? 'bg-sun' : 'bg-border')} />
                    )}
                  </button>
                  <span className={cn('font-mono text-[11px]', day.today ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{day.label}</span>
                </li>
              )
            })}
          </ul>
          <p className="text-[13px] text-muted-foreground tabular-nums">{footer}</p>
        </>
      )}
    </Section>
  )
}

export function Projects({ projects, connections, unavailable }: { projects: HomeModel['projects']; connections: HomeModel['connections']; unavailable: boolean }) {
  const aside = connections.known && connections.summary
    ? <HeaderLink target={screen('integrations')}>Connections: {connections.summary}</HeaderLink>
    : null
  return (
    <Section title="Projects" aside={aside}>
      {projects.rows.length ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5">
          {projects.rows.map(row => (
            <li key={row.id} className="min-w-0">
              <button
                type="button"
                onClick={() => openTarget(row.action.target)}
                className="flex h-full w-full min-w-0 flex-col gap-2 rounded-[14px] border border-border bg-tone-2 px-3.5 py-3 text-left transition-colors hover:border-border-strong"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ToneDot tone={row.tone} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{row.title}</span>
                  {row.aside ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{row.aside}</span> : null}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{row.detail ?? 'All quiet'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={<Folder />}>{unavailable ? WAITING : 'No chosen projects yet.'}</Empty>
      )}
    </Section>
  )
}

/** A widget hobkin authored: it carries its own values, so the client only lays them out and offers a "×" to dismiss it. */
export function Custom({ spec, now }: { spec: CustomWidget; now: number }) {
  const at = spec.updatedAt ? timeOf(spec.updatedAt) : null
  const aside = at !== null ? `updated ${waited(at, now)} ago` : null
  return (
    <Widget title={spec.title} icon={<LayoutGrid />} aside={aside} onDismiss={() => dismiss(`custom:${spec.id}`)}>
      {spec.body.kind === 'stat' ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-heading text-[28px] leading-none font-light tabular-nums">{spec.body.value}</span>
          {spec.body.label ? <span className="text-xs text-muted-foreground">{spec.body.label}</span> : null}
        </div>
      ) : null}
      {spec.body.kind === 'keyvalue' ? (
        <dl className="flex flex-col gap-1.5">
          {spec.body.rows.map((row, index) => (
            <div key={`${row.k}:${index}`} className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
              <dt className="min-w-0 truncate text-muted-foreground">{row.k}</dt>
              <dd className="shrink-0 font-medium tabular-nums">{row.v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {spec.body.kind === 'text' ? (
        <p className="break-words text-sm leading-relaxed text-muted-foreground">{spec.body.text}</p>
      ) : null}
    </Widget>
  )
}
