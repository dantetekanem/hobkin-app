import type { ReactNode } from 'react'
import {
  Bot, CalendarClock, ChartColumn, CircleCheck, CirclePause, Coffee, Folder, GitMerge, GitPullRequest, LayoutGrid, Lightbulb,
  ListChecks, ListOrdered, MessageCircleQuestion, Plug, Signpost, Timer, TriangleAlert,
} from 'lucide-react'
import { AgentHood } from '@/components/Mark.tsx'
import { cn } from '@/lib/utils.ts'
import { ServiceMark } from '../integrations/ServiceMark.tsx'
import { clockTime, timeOf, waited } from '../reports/time.ts'
import { dismiss } from './dismissals.ts'
import { openTarget } from './navigate.ts'
import { Empty, More, Row, Rows, ToneDot, TEXT, Widget } from './parts.tsx'
import { SmartStack } from './SmartStack.tsx'
import { WidgetCell, WidgetCells } from './cells.ts'
import { WIDGET_ORDER } from './widgets.ts'
import type { ConnectionTile, CustomWidget, DayMark, DayStrip, HomeModel, HomeRow, HomeTarget, HomeWidget, NeedKind, NeedRow, WidgetKind } from './types.ts'

const NEED_ICON: Record<NeedKind, ReactNode> = {
  question: <MessageCircleQuestion />,
  decision: <Signpost />,
  review: <GitMerge />,
  github: <GitPullRequest />,
  connection: <Plug />,
  proposal: <Lightbulb />,
}

/** A row about a change shows the merge icon, whichever kind of need brought it. */
function needIcon(row: NeedRow): ReactNode {
  return row.action.target.to === 'review' ? <GitMerge /> : NEED_ICON[row.kind]
}

function problemIcon(row: HomeRow): ReactNode {
  if (row.action.target.to === 'routine') return <CirclePause />
  if (row.action.target.to === 'screen') return <Plug />
  return <TriangleAlert />
}

const MARK: Record<DayMark['state'], string> = {
  done: 'bg-muted-foreground',
  failed: 'bg-bad-fg',
  next: 'border border-muted-foreground bg-surface',
}

const WAITING = 'Waiting for hobkin.'

/** A big number with its label. With a target it is a button that goes there. */
function Stat({ value, label, alarm = false, target }: { value: number | undefined; label: string; alarm?: boolean; target?: HomeTarget }) {
  const body = (
    <>
      <span className={cn('block font-heading text-2xl font-light tabular-nums', alarm ? 'text-bad-fg' : '')}>{value ?? '–'}</span>
      <span className="block text-xs text-muted-foreground">{label}</span>
    </>
  )
  const box = 'rounded-xl bg-surface-2/60 px-3 py-2 text-left'
  if (!target) return <div className={box}>{body}</div>
  return (
    <button type="button" onClick={() => openTarget(target)} className={cn(box, 'transition-colors hover:bg-surface-2')}>
      {body}
    </button>
  )
}

function Needs({ needs, unavailable }: { needs: HomeModel['needs']; unavailable: boolean }) {
  const total = needs.rows.length + needs.more
  return (
    <Widget title="Needs you" icon={<ListChecks />} target={{ to: 'screen', screen: 'actions' }} count={total}>
      {needs.rows.length ? (
        <Rows>
          {needs.rows.map(row => (
            <Row key={row.id} row={row} icon={needIcon(row)} onDismiss={row.id.startsWith('reminder:') ? undefined : () => dismiss(row.id)} />
          ))}
        </Rows>
      ) : (
        <Empty icon={<CircleCheck className="text-ok-fg" />}>{unavailable ? WAITING : 'Nothing is waiting for you.'}</Empty>
      )}
      <More count={needs.more} target={{ to: 'screen', screen: 'actions' }} />
    </Widget>
  )
}

function Running({ running, unavailable }: { running: HomeModel['running']; unavailable: boolean }) {
  return (
    <Widget title="Running now" icon={<Bot />} target={{ to: 'screen', screen: 'work' }} count={running.rows.length} aside={running.slots}>
      {running.held ? (
        <p className="flex items-start gap-2.5 rounded-xl border border-warn-fg/25 bg-warn/10 px-3 py-2.5 text-[13px] text-warn-fg">
          <CirclePause aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{running.held}</span>
        </p>
      ) : null}
      {running.rows.length ? (
        <Rows>
          {running.rows.map(row => (
            <Row
              key={row.id}
              row={row}
              lead={row.face ? (
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2">
                  <AgentHood hue={row.face.hue} size={22} mood={row.face.mood} asking={row.face.asking} />
                </span>
              ) : undefined}
              icon={<Bot />}
            />
          ))}
        </Rows>
      ) : (
        <Empty icon={<Coffee />}>{unavailable ? WAITING : 'Nobody is working right now.'}</Empty>
      )}
      {!running.rows.length && running.queue.length ? (
        <div className="flex flex-col gap-1">
          <p className="eyebrow px-0.5 pt-1">Up next in the queue</p>
          <Rows>
            {running.queue.map(row => <Row key={row.id} row={row} icon={<ListOrdered />} />)}
          </Rows>
        </div>
      ) : null}
    </Widget>
  )
}

const HOURS = [6, 12, 18]
const hourLabel = (hour: number) => (hour === 12 ? 'Noon' : new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour)))

function DayTimeline({ day }: { day: DayStrip }) {
  const position = (at: number) => `${Math.max(0, Math.min(100, (at - day.start) / (day.end - day.start) * 100))}%`
  const hourAt = (hour: number) => new Date(new Date(day.start).setHours(hour)).getTime()
  const count = (state: string) => day.marks.filter(mark => mark.state === state).length
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 px-3 pt-3 pb-2">
      <div role="img" aria-label={`Today: ${count('done')} done, ${count('failed')} failed, ${count('next')} upcoming`} className="relative h-10">
        <span className="absolute inset-x-0 top-[19px] h-0.5 rounded-full bg-border" />
        <span style={{ width: position(day.now) }} className="absolute left-0 top-[19px] h-0.5 rounded-full bg-border-strong" />
        {HOURS.map(hour => (
          <span key={hour} style={{ left: position(hourAt(hour)) }} className="absolute top-3.5 h-3 w-px -translate-x-1/2 bg-border" />
        ))}
        {day.marks.map((mark, index) => (
          <span
            key={`${mark.at}:${index}`}
            title={`${clockTime(mark.at)} · ${mark.state}`}
            style={{ left: position(mark.at) }}
            className={cn('absolute top-4 size-2.5 -translate-x-1/2 rounded-full ring-2 ring-surface', MARK[mark.state])}
          />
        ))}
        <span style={{ left: position(day.now) }} className="absolute top-1 h-8 w-0.5 -translate-x-1/2 rounded-full bg-sun" />
      </div>
      <div className="relative h-4 text-[10px] text-muted-foreground">
        {HOURS.map(hour => (
          <span key={hour} style={{ left: position(hourAt(hour)) }} className="absolute -translate-x-1/2">{hourLabel(hour)}</span>
        ))}
      </div>
    </div>
  )
}

function Upcoming({ upcoming, unavailable }: { upcoming: HomeModel['upcoming']; unavailable: boolean }) {
  return (
    <Widget title="Coming up" icon={<Timer />} target={{ to: 'screen', screen: 'routines' }} aside={upcoming.summary ? `Today: ${upcoming.summary}` : null}>
      {!unavailable ? <DayTimeline day={upcoming.day} /> : null}
      {upcoming.rows.length ? (
        <Rows>
          {upcoming.rows.map(row => (
            <Row
              key={row.id}
              row={{ ...row, aside: null }}
              lead={(
                <span className={cn('flex h-8 w-16 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums', TEXT[row.tone])}>
                  {row.aside}
                </span>
              )}
            />
          ))}
        </Rows>
      ) : (
        <Empty icon={<CalendarClock />}>{unavailable ? WAITING : 'No runs are scheduled next.'}</Empty>
      )}
    </Widget>
  )
}

function Problems({ problems, unavailable }: { problems: HomeModel['problems']; unavailable: boolean }) {
  return (
    <Widget title="Problems" icon={<TriangleAlert />} target={{ to: 'screen', screen: 'reports' }} count={problems.rows.length + problems.more}>
      {problems.rows.length ? (
        <Rows>
          {problems.rows.map(row => (
            <Row key={row.id} row={row} icon={problemIcon(row)} onDismiss={() => dismiss(row.id)} />
          ))}
        </Rows>
      ) : (
        <Empty icon={<CircleCheck className="text-ok-fg" />}>{unavailable ? WAITING : 'No unread problems.'}</Empty>
      )}
      <More count={problems.more} target={{ to: 'screen', screen: 'reports' }} />
    </Widget>
  )
}

function Projects({ projects, unavailable }: { projects: HomeModel['projects']; unavailable: boolean }) {
  return (
    <Widget title="Projects" icon={<Folder />} target={{ to: 'screen', screen: 'work' }} count={projects.rows.length}>
      {projects.rows.length ? (
        <Rows>
          {projects.rows.map(row => (
            <Row
              key={row.id}
              row={{ ...row, aside: null, detail: row.detail ?? 'All quiet' }}
              lead={(
                <span className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-[11px] font-semibold text-muted-foreground tabular-nums">
                  {row.aside}
                  <ToneDot tone={row.tone} className="absolute -top-0.5 -right-0.5 ring-2 ring-surface" />
                </span>
              )}
            />
          ))}
        </Rows>
      ) : (
        <Empty icon={<Folder />}>{unavailable ? WAITING : 'No chosen projects yet.'}</Empty>
      )}
    </Widget>
  )
}

function ConnectionButton({ tile }: { tile: ConnectionTile }) {
  // A failure's message is too long for a tile; Problems carries it.
  const status = tile.note && tile.tone !== 'bad' ? `${tile.status} · ${tile.note}` : tile.status
  return (
    <button
      type="button"
      onClick={() => openTarget(tile.target)}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
    >
      <ServiceMark look={tile.mark} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{tile.name}</span>
        <span className={cn('flex items-center gap-1.5 text-[11px]', tile.tone === 'quiet' ? 'text-muted-foreground' : TEXT[tile.tone])}>
          <ToneDot tone={tile.tone} className="size-1.5" />
          <span className="truncate">{status}</span>
        </span>
      </span>
    </button>
  )
}

function Connections({ connections, github }: { connections: HomeModel['connections']; github: HomeModel['github'] }) {
  return (
    <Widget title="Connections" icon={<Plug />} target={{ to: 'screen', screen: 'integrations' }} aside={connections.summary} link="Manage">
      {!connections.known ? (
        <Empty icon={<Plug />}>{WAITING}</Empty>
      ) : connections.tiles.length ? (
        <ul className="grid grid-cols-2 gap-2">
          {connections.tiles.map(tile => (
            <li key={tile.key} className="min-w-0">
              <ConnectionButton tile={tile} />
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={<Plug />}>No services connected yet. Add Linear, Sentry, Home Assistant and more in Integrations.</Empty>
      )}
      {github.known ? (
        <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
          <Stat value={github.reviews} label="reviews for you" target={{ to: 'screen', screen: 'github' }} />
          <Stat value={github.failing} label="PRs failing checks" alarm={github.failing > 0} target={{ to: 'screen', screen: 'github' }} />
        </div>
      ) : null}
    </Widget>
  )
}

function Week({ week, unavailable }: { week: HomeModel['week']; unavailable: boolean }) {
  const maxDailyRuns = Math.max(1, ...week.days.map(day => day.completed + day.failed + day.stopped))
  return (
    <Widget title="This week" icon={<ChartColumn />} target={{ to: 'screen', screen: 'reports' }} aside={week.wins && week.wins.streak > 1 ? `${week.wins.streak}-day streak` : null}>
      {unavailable ? (
        <Empty icon={<ChartColumn />}>{WAITING}</Empty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat value={week.wins?.merged} label="merged today" />
            <Stat value={week.wins?.decided} label="decided today" />
            <Stat value={week.completed} label="runs done" />
          </div>
          <ul aria-label="Runs by day" className="flex items-end gap-2">
            {week.days.map(day => (
              <li key={day.key} className="min-w-0 flex-1">
                <button
                  type="button"
                  disabled={!day.openId}
                  onClick={() => day.openId && openTarget({ to: 'report', id: day.openId })}
                  aria-label={`${day.label}: ${day.completed} completed, ${day.failed} failed, ${day.stopped} stopped`}
                  className="group flex w-full flex-col items-center gap-1.5 rounded-md"
                >
                  <span className="flex h-16 w-full flex-col justify-end gap-0.5 rounded-md bg-surface-2/40 p-0.5">
                    <span
                      style={{ height: `${(day.failed + day.stopped) / maxDailyRuns * 100}%` }}
                      className="w-full rounded-sm bg-bad-fg/80"
                    />
                    <span
                      style={{ height: `${day.completed / maxDailyRuns * 100}%` }}
                      className={cn('w-full rounded-sm transition-colors group-enabled:group-hover:bg-foreground/60', day.today ? 'bg-sun' : 'bg-muted-foreground/50')}
                    />
                  </span>
                  <span className={cn('text-[10px]', day.today ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{day.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground tabular-nums">{week.completed} completed · {week.unfinished} failed or stopped</p>
        </>
      )}
    </Widget>
  )
}

/** A widget hobkin authored: it carries its own values, so the client only lays them out and offers a "×" to dismiss it. */
function Custom({ spec, now }: { spec: CustomWidget; now: number }) {
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

/** Each widget drawn from its kind, so the screen renders a data-driven manifest without knowing the order ahead of time. */
function widgetBody(widget: HomeWidget, model: HomeModel, unavailable: boolean): ReactNode {
  if (widget.kind === 'custom') return widget.custom ? <Custom spec={widget.custom} now={model.upcoming.day.now} /> : null
  const kind: WidgetKind = widget.kind
  switch (kind) {
    case 'needs': return <Needs needs={model.needs} unavailable={unavailable} />
    case 'running': return <Running running={model.running} unavailable={unavailable} />
    case 'upcoming': return <Upcoming upcoming={model.upcoming} unavailable={unavailable} />
    case 'problems': return <Problems problems={model.problems} unavailable={unavailable} />
    case 'projects': return <Projects projects={model.projects} unavailable={unavailable} />
    case 'connections': return <Connections connections={model.connections} github={model.github} />
    case 'week': return <Week week={model.week} unavailable={unavailable} />
  }
}

/**
 * The dashboard: the smart stack first when something needs the user, then the widgets the model ordered by urgency.
 * Nothing is placed by hand here. The grid rides `layout`, so as the order changes the cards glide to their new spots,
 * a dismissed one leaves and the rest close up. Reduced motion keeps only the fades. Offline, the full set shows its
 * waiting states in the fixed reading order.
 */
export function HomeWidgets({ model, unavailable }: { model: HomeModel; unavailable: boolean }) {
  // Offline, hobkin has sent nothing, so the built-ins show their waiting states in the fixed reading order.
  const widgets: HomeWidget[] = unavailable
    ? WIDGET_ORDER.map(kind => ({ id: kind, kind, weight: 0 }))
    : model.widgets
  return (
    <div className="grid grid-cols-1 items-stretch gap-4 @[720px]:grid-cols-2">
      <WidgetCells>
        {model.stack.length ? (
          <WidgetCell key="stack"><SmartStack cards={model.stack} onDismiss={dismiss} /></WidgetCell>
        ) : null}
        {widgets.map(widget => (
          <WidgetCell key={widget.id}>{widgetBody(widget, model, unavailable)}</WidgetCell>
        ))}
      </WidgetCells>
    </div>
  )
}
