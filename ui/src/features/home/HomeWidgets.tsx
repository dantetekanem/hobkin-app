import type { ReactNode } from 'react'
import { ArrowUpRight, Bot, CircleAlert, Folder, GitPullRequest, ListChecks, Timer } from 'lucide-react'
import { openTarget } from './navigate.ts'
import type { DayStrip, HomeModel, HomeRow, HomeTarget, HomeTone } from './types.ts'

const DOT: Record<HomeTone, string> = {
  accent: 'bg-sun', bad: 'bg-bad-fg', warn: 'bg-warn-fg', ok: 'bg-ok-fg', info: 'bg-code-fg', quiet: 'bg-muted-foreground',
}

export function ToneDot({ tone }: { tone: HomeTone }) {
  return <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[tone]}`} />
}

function Widget({ title, icon, target, aside, children }: { title: string; icon: ReactNode; target: HomeTarget; aside?: string | null; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-4 rounded-[20px] border border-border bg-surface p-5">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow flex items-center gap-2">{icon}{title}</h2>
        <button type="button" aria-label={`Open ${title}`} onClick={() => openTarget(target)} className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <span className="break-words">{aside ?? 'Open'}</span><ArrowUpRight aria-hidden="true" className="size-3 shrink-0" />
        </button>
      </header>
      {children}
    </section>
  )
}

function Rows({ rows, empty }: { rows: HomeRow[]; empty: string }) {
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">{empty}</p>
  return (
    <ul className="flex flex-col gap-1">
      {rows.map(row => <li key={row.id}>
        <button type="button" onClick={() => openTarget(row.action.target)} className="group flex w-full min-w-0 items-start gap-3 rounded-xl py-2 text-left hover:bg-surface-2">
          <span className="pt-1.5"><ToneDot tone={row.tone} /></span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-medium">{row.title}</span>
            {row.detail ? <span className="mt-0.5 block break-words text-xs leading-relaxed text-muted-foreground">{row.detail}</span> : null}
            {row.aside ? <span className="mt-1 block text-xs text-muted-foreground tabular-nums">{row.aside}</span> : null}
          </span>
          <span className="max-w-[30%] shrink-0 break-words rounded-lg border border-border-strong px-2 py-1 text-xs group-hover:bg-surface-2">{row.action.label}</span>
        </button>
      </li>)}
    </ul>
  )
}

function More({ count, target }: { count: number; target: HomeTarget }) {
  return count > 0 ? <button type="button" onClick={() => openTarget(target)} className="self-start text-xs text-muted-foreground hover:text-foreground">+{count} more</button> : null
}

function DayTimeline({ day }: { day: DayStrip }) {
  const position = (at: number) => `${Math.max(0, Math.min(100, (at - day.start) / (day.end - day.start) * 100))}%`
  return (
    <div>
      <div role="img" aria-label={`Today: ${day.marks.filter(mark => mark.state === 'done').length} done, ${day.marks.filter(mark => mark.state === 'failed').length} failed, ${day.marks.filter(mark => mark.state === 'next').length} upcoming`} className="relative mx-1 h-9">
        <span className="absolute inset-x-0 top-4 h-0.5 rounded-full bg-border-strong" />
        {day.marks.map((mark, index) => <span key={`${mark.at}:${index}`} style={{ left: position(mark.at) }} className={`absolute top-[13px] size-2 -translate-x-1/2 rounded-full ${mark.state === 'next' ? 'border border-muted-foreground bg-surface' : mark.state === 'failed' ? 'bg-bad-fg' : 'bg-muted-foreground'}`} />)}
        <span style={{ left: position(day.now) }} className="absolute top-1 h-7 w-0.5 -translate-x-1/2 rounded-full bg-sun" />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground"><span>Midnight</span><span className="text-sun">Now</span><span>Midnight</span></div>
    </div>
  )
}

function Week({ week, unavailable }: { week: HomeModel['week']; unavailable: boolean }) {
  const most = Math.max(1, ...week.days.map(day => day.completed + day.failed + day.stopped))
  return (
    <Widget title="This week" icon={<ListChecks aria-hidden="true" className="size-3.5" />} target={{ to: 'screen', screen: 'reports' }} aside={week.wins ? `${week.wins.streak}-day streak` : null}>
      {unavailable ? <p className="text-[13px] text-muted-foreground">Waiting for Home.</p> : <>
        {week.wins ? <div className="flex flex-wrap gap-6">
          <div><p className="font-heading text-3xl font-light tabular-nums">{week.wins.merged}</p><p className="text-xs text-muted-foreground">merged today</p></div>
          <div><p className="font-heading text-3xl font-light tabular-nums">{week.wins.decided}</p><p className="text-xs text-muted-foreground">decided today</p></div>
        </div> : <p className="text-xs text-muted-foreground">Today's wins are not available yet.</p>}
        <ul aria-label="Runs by day" className="flex items-end gap-2">
          {week.days.map(day => <li key={day.key} className="min-w-0 flex-1">
            <button type="button" disabled={!day.openId} onClick={() => day.openId && openTarget({ to: 'report', id: day.openId })} aria-label={`${day.label}: ${day.completed} completed, ${day.failed} failed, ${day.stopped} stopped`} className="flex w-full flex-col items-center gap-2 rounded-sm">
              <span className="flex h-12 w-full flex-col justify-end gap-0.5 border-b border-border">
                <span style={{ height: `${day.completed / most * 100}%` }} className={`w-full rounded-t-sm ${day.today ? 'bg-muted-foreground' : 'bg-border-strong'}`} />
                <span style={{ height: `${(day.failed + day.stopped) / most * 100}%` }} className="w-full bg-bad-fg" />
              </span>
              <span className={`text-[10px] ${day.today ? 'text-foreground' : 'text-muted-foreground'}`}>{day.label}</span>
            </button>
          </li>)}
        </ul>
        <p className="text-xs text-muted-foreground tabular-nums">{week.completed} completed · {week.unfinished} failed or stopped</p>
      </>}
    </Widget>
  )
}

/** Fixed reading order; the model supplies every count, row, limit and target. */
export function HomeWidgets({ model, unavailable, stack }: { model: HomeModel; unavailable: boolean; stack: ReactNode }) {
  const waiting = 'Waiting for Home.'
  return (
    <div className="grid grid-cols-1 items-stretch gap-4 @[720px]:grid-cols-2">
      {stack}
      <Widget title="Needs you" icon={<ListChecks aria-hidden="true" className="size-3.5" />} target={{ to: 'screen', screen: 'actions' }}>
        <Rows rows={model.needs.rows} empty={unavailable ? waiting : 'Nothing is waiting for you.'} />
        <More count={model.needs.more} target={{ to: 'screen', screen: 'actions' }} />
      </Widget>
      <Widget title="Running now" icon={<Bot aria-hidden="true" className="size-3.5" />} target={{ to: 'screen', screen: 'work' }} aside={model.running.slots}>
        <Rows rows={model.running.rows} empty={unavailable ? waiting : 'No agents are running.'} />
        {model.running.held ? <p className="rounded-xl border border-warn-fg/20 bg-warn/10 p-3 text-[13px] text-warn-fg">{model.running.held}</p> : null}
      </Widget>
      <Widget title="Coming up" icon={<Timer aria-hidden="true" className="size-3.5" />} target={{ to: 'screen', screen: 'routines' }} aside={model.upcoming.summary || null}>
        {!unavailable ? <DayTimeline day={model.upcoming.day} /> : null}
        <Rows rows={model.upcoming.rows} empty={unavailable ? waiting : 'No runs are scheduled next.'} />
      </Widget>
      <Widget title="Problems" icon={<CircleAlert aria-hidden="true" className="size-3.5" />} target={{ to: 'screen', screen: 'reports' }}>
        <Rows rows={model.problems.rows} empty={unavailable ? waiting : 'No unread problems.'} />
        <More count={model.problems.more} target={{ to: 'screen', screen: 'reports' }} />
      </Widget>
      <Widget title="Projects" icon={<Folder aria-hidden="true" className="size-3.5" />} target={{ to: 'screen', screen: 'work' }}>
        <Rows rows={model.projects.rows} empty={unavailable ? waiting : 'No chosen projects yet.'} />
      </Widget>
      <Widget title="GitHub" icon={<GitPullRequest aria-hidden="true" className="size-3.5" />} target={{ to: 'screen', screen: 'github' }}>
        {model.github.known ? <>
          <div className="flex flex-wrap gap-6">
            <div><p className="font-heading text-3xl font-light tabular-nums">{model.github.reviews}</p><p className="text-xs text-muted-foreground">reviews for you</p></div>
            <div><p className="font-heading text-3xl font-light text-bad-fg tabular-nums">{model.github.failing}</p><p className="text-xs text-muted-foreground">PRs failing</p></div>
          </div>
          <Rows rows={model.github.rows} empty="Nothing waiting on GitHub." />
        </> : <p className="text-[13px] text-muted-foreground">GitHub is not connected.</p>}
      </Widget>
      <Week week={model.week} unavailable={unavailable} />
    </div>
  )
}
