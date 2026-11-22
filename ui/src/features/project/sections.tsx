import { ArrowDown, ChevronRight, ExternalLink, Pause, Play } from 'lucide-react'
import { Fragment, memo, useCallback } from 'react'
import { requestCanvasFocus } from '@/app/focus.ts'
import { useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { Button, buttonVariants } from '@/components/ui/button.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { openOnGitHub } from '@/features/github/open.ts'
import { openTarget } from '@/features/home/navigate.ts'
import { DayBars } from '@/features/numbers/DayBars.tsx'
import { TileRow } from '@/features/numbers/StatTile.tsx'
import { ProjectModels } from '@/features/proofs/ProjectModels.tsx'
import { whenText } from '@/features/routines/words.ts'
import { GradeChip, ReviewBadge, SaidLine, Segmented } from '@/features/work/parts.tsx'
import { runWork, useWorkUi } from '@/features/work/store.ts'
import { openOnWork } from '@/features/work/work-target.ts'
import type { PartOpen, PartRow } from '@/features/work/yolo-page.ts'
import type { Grade } from '#shared/protocol/work.ts'
import { cn } from '@/lib/utils.ts'
import { SECTION_ID, type AgentRow, type Flow, type Heading, type MergedLine, type MergedSection, type QueueLine, type QueueSection, type ReadinessSection, type Section, type TakenPage, type TilesView, type WaitingRow } from './model.ts'
import { Block, Chip, Empty, Row } from './parts.tsx'
import { useProjectAgents } from './use-project.ts'

/**
 * The sections of a project's page, top to bottom: what it is and its controls, its tiles, the flow from queued to
 * merged, then what waits for the user, its agents, its queue, what merged lately, its models and its YOLO readiness.
 * Each is memoized and takes only its own part of the page, so a change to one draws only that one again.
 */

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const PRIORITIES: readonly { value: Grade; label: string }[] = (['P0', 'P1', 'P2', 'P3'] as const).map((value) => ({ value, label: value }))
const PAUSE_TITLE = 'Work mode stops on this project alone: its agents finish what they started, nothing new starts here, and the rest of work mode carries on.'
const LANDS: Record<string, string> = { off: 'on a local branch', draft: 'as a draft PR', published: 'as a PR' }

const TITLE = 'min-w-0 font-heading text-[26px] leading-tight font-semibold tracking-[-0.025em] break-words'

/** The project's name with its priority, where its work goes and its YOLO readiness, and its Pause and Priority controls. */
export const ProjectHeading = memo(function ProjectHeading({ heading, live }: { heading: Heading; live: boolean }) {
  const { slug, name } = heading
  const busy = useWorkUi((state) => Boolean(state.busy[slug]))
  const said = useWorkUi((state) => state.said[slug])
  const place = { live, place: slug }
  const github = heading.repo ? `https://github.com/${heading.repo}` : null

  return (
    <header className="flex flex-col gap-2 px-1">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className={TITLE}>{name}</h1>
          <span className="flex flex-wrap items-center gap-1.5">
            <GradeChip grade={heading.priority} />
            <Chip tone="quiet">{heading.prWords}</Chip>
            {heading.yolo ? (
              <Chip tone={heading.yolo.tone} title={heading.yolo.title}>
                {heading.yolo.label}
              </Chip>
            ) : null}
            {heading.paused ? <Chip tone="warn">Paused</Chip> : null}
          </span>
        </div>
        {/* The same height, at the right edge, and the same width whatever they say, so nothing beside them moves. */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" data-stop="" disabled={busy} focusableWhenDisabled title={PAUSE_TITLE} onClick={() => void runWork({ do: 'paused', slug, paused: !heading.paused }, place)} className="w-[104px]">
            {heading.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            {heading.paused ? 'Resume' : 'Pause'}
          </Button>
          <span className="eyebrow ml-2">Priority</span>
          <Segmented label={`Priority of ${name}`} name={`project-priority-${slug}`} value={heading.priority} options={PRIORITIES} disabled={busy} onChoose={(priority) => void runWork({ do: 'priority', slug, priority }, place)} />
          {github ? (
            <a href={github} target="_blank" rel="noopener noreferrer" data-stop="" onClick={(event) => openOnGitHub(event, github)} className={buttonVariants({ variant: 'ghost' })}>
              Open on GitHub
              <ExternalLink aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
      <p className="max-w-[72ch] text-[13.5px] leading-relaxed text-muted-foreground">
        {heading.paused
          ? 'Paused: its agents finish what they started, and nothing new starts here until you resume it.'
          : `Its work runs at the ${heading.level} level, and what it finishes waits for you ${LANDS[heading.prMode] ?? 'as hobkin sets'}.`}
      </p>
      {heading.lookError ? <p className="max-w-[72ch] text-[13px] leading-snug text-bad-fg">Last look failed: {heading.lookError}</p> : null}
      {said?.tone === 'refused' ? <SaidLine tone="refused">{said.text}</SaidLine> : null}
    </header>
  )
})

/** The same six tiles as Work, for this project, with a line when the numbers are missing or old. */
export const ProjectTiles = memo(function ProjectTiles({ tiles }: { tiles: TilesView }) {
  return (
    <div className="flex flex-col gap-2">
      <TileRow tiles={tiles.tiles} loading={tiles.loading} />
      {tiles.note ? <p className="px-1 text-[12.5px] leading-snug text-muted-foreground">{tiles.note}</p> : null}
    </div>
  )
})

const STEPS = [
  { key: 'queued', label: 'Queued', section: SECTION_ID.queue, to: 'Queue' },
  { key: 'working', label: 'Working', section: SECTION_ID.atWork, to: 'At work' },
  { key: 'waiting', label: 'Waiting for you', section: SECTION_ID.waiting, to: 'Waiting for you' },
  { key: 'merged', label: 'Merged (30 d)', section: SECTION_ID.merged, to: 'Merged lately' },
] as const

/**
 * The flow from queued to merged: four numbers in a row, each a button that brings its section into view and gives
 * the keyboard to its first row. How many work comes from this project's agents, read here alone, so an agent that
 * starts or ends draws only this row and At work again.
 */
export const ProjectFlow = memo(function ProjectFlow({ flow, slug }: { flow: Flow; slug: string }) {
  const working = useProjectAgents(slug).length
  const still = useStill()
  const figures: Record<(typeof STEPS)[number]['key'], number | null> = { ...flow, working }

  const go = (id: string) => {
    const section = document.getElementById(id)
    if (!section) return
    section.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' })
    section.querySelector<HTMLElement>('[data-stop]')?.focus({ preventScroll: true })
  }

  return (
    <nav aria-label="From queued to merged" className="@container">
      <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] @3xl:gap-x-1.5">
        {STEPS.map(({ key, label, section, to }, index) => {
          const figure = figures[key]
          return (
            <Fragment key={key}>
              {index ? <ChevronRight aria-hidden="true" className="hidden size-4 self-center text-muted-foreground @3xl:block" /> : null}
              <button
                type="button"
                data-stop=""
                data-opens={`flow-${key}`}
                aria-label={`${label}: ${figure ?? 'no data yet'}. Goes to ${to}.`}
                onClick={() => go(section)}
                className="pressable flex h-16 min-w-0 items-center justify-between gap-3 rounded-2xl bg-background px-4 text-left outline-offset-[-2px]"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[12.5px] text-muted-foreground">{label}</span>
                  <span className="font-heading text-[20px] leading-7 font-semibold tabular-nums">{figure ?? '–'}</span>
                </span>
                <ArrowDown aria-hidden="true" className="open-arrow size-4 shrink-0 text-muted-foreground" />
              </button>
            </Fragment>
          )
        })}
      </div>
    </nav>
  )
})

/** The finished changes of this project that wait for the user's yes or no, what needs them first. Each opens its review. */
export const WaitingBlock = memo(function WaitingBlock({ section }: { section: Section<WaitingRow> }) {
  return (
    <Block id={SECTION_ID.waiting} label="Waiting for you" count={section.rows.length}>
      {section.rows.length ? (
        <ul className="flex flex-col gap-1.5">
          {section.rows.map((row) => (
            <li key={row.key}>
              <WaitingLine row={row} />
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{section.empty}</Empty>
      )}
    </Block>
  )
})

function WaitingLine({ row }: { row: WaitingRow }) {
  const { review } = row
  const open = review ? () => useView.getState().openReviewFor(review) : undefined
  const line = [row.why, row.size].filter(Boolean).join(' · ')
  return (
    <Row onOpen={open} label={`${row.title}. ${line}.${open ? ' Opens its review.' : ''}`} mark={{ 'data-change': row.key }}>
      <span className="w-7 shrink-0">
        <GradeChip grade={row.grade} />
      </span>
      <span className="min-w-0 flex-1">
        <span title={row.title} className="block truncate text-[13.5px] leading-snug font-medium">
          {row.title}
        </span>
        <span title={line} className={cn('mt-0.5 block truncate text-[12px]', row.needsYou ? 'text-warn-fg' : 'text-muted-foreground')}>
          {line}
        </span>
      </span>
      {row.answer ? <ReviewBadge status={row.answer} /> : null}
    </Row>
  )
}

/** This project's agents at work. Each opens its canvas. */
export const AtWorkBlock = memo(function AtWorkBlock({ slug, empty }: { slug: string; empty: string }) {
  const rows = useProjectAgents(slug)
  return (
    <Block id={SECTION_ID.atWork} label="At work" count={rows.length}>
      {rows.length ? (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.id}>
              <AgentLine row={row} />
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{empty}</Empty>
      )}
    </Block>
  )
})

const AgentLine = memo(function AgentLine({ row }: { row: AgentRow }) {
  const open = useCallback(() => {
    useView.getState().openAgentCanvas(row.id)
    // The keyboard goes along to the agent's canvas.
    requestCanvasFocus()
  }, [row.id])
  const said = row.asks ? `Waiting for you: ${row.asks}` : row.doing
  return (
    <Row onOpen={open} label={`${row.title}, ${said}. Opens its canvas.`} mark={{ 'data-agent-node': row.id }}>
      <span aria-hidden="true" className="ml-1 size-2 shrink-0 rounded-full" style={{ background: `oklch(0.62 0.11 ${row.hue})` }} />
      <span className="min-w-0 flex-1">
        <span title={row.title} className="block truncate text-[13.5px] leading-snug font-medium">
          {row.title}
        </span>
        <span title={said} className={cn('mt-0.5 block truncate text-[12px]', row.asks ? 'text-sun-fg' : 'text-muted-foreground')}>
          {said}
        </span>
      </span>
    </Row>
  )
})

/** This project's rows of hobkin's queue, in hobkin's order, each in one line. Each opens its row on Work. */
export const QueueBlock = memo(function QueueBlock({ section }: { section: QueueSection }) {
  const queued = section.rows.filter(({ skipped }) => !skipped).length
  return (
    <Block id={SECTION_ID.queue} label="Queue" count={`${queued} queued`}>
      {section.note ? <p className="px-1 text-[12.5px] leading-snug text-warn-fg">{section.note}</p> : null}
      {section.rows.length ? (
        <ul className="flex flex-col gap-1.5">
          {section.rows.map((row) => (
            <li key={row.key}>
              <QueueRow row={row} opens={section.opens} />
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{section.empty}</Empty>
      )}
    </Block>
  )
})

function QueueRow({ row, opens }: { row: QueueLine; opens: boolean }) {
  const open = opens ? () => openOnWork(`[data-queue-row="${row.key}"]`) : undefined
  const line = [row.words, row.cost].filter(Boolean).join(' · ')
  return (
    <Row onOpen={open} label={`${row.grade ?? ''} ${row.title}. ${line}.${open ? ' Opens it on Work.' : ''}`} mark={{ 'data-queue-row': row.key }} className="min-h-10 py-1.5">
      <span className="w-7 shrink-0">
        <GradeChip grade={row.grade} />
      </span>
      <span title={row.title} className={cn('min-w-0 flex-1 truncate text-[13.5px] font-medium', row.skipped && 'text-muted-foreground')}>
        {row.title}
      </span>
      {row.picked && !row.skipped ? <span className="eyebrow shrink-0 text-sun-fg">Picked</span> : null}
      <span title={line} className={cn('max-w-[45%] min-w-0 shrink truncate text-[12px]', row.waits ? 'text-warn-fg' : 'text-muted-foreground')}>
        {line}
      </span>
    </Row>
  )
}

const OUTCOME_TONE = { 'merged-by-itself': 'live', 'merged-by-you': 'quiet', declined: 'bad' } as const

/**
 * What merged or was declined here lately, newest first: the day, the title, whether it merged by itself or on the
 * user's yes, and its rate and commit. A host that sends no list shows the merges by day in its place.
 */
export const MergedBlock = memo(function MergedBlock({ merged }: { merged: MergedSection }) {
  return (
    <Block id={SECTION_ID.merged} label="Merged lately" count={merged.kind === 'list' ? merged.count : undefined}>
      {merged.kind === 'list' ? (
        merged.rows.length ? (
          <>
            <ul className="flex flex-col gap-1.5">
              {merged.rows.map((row) => (
                <li key={row.item}>
                  <MergedRow row={row} />
                </li>
              ))}
            </ul>
            {merged.more ? <p className="px-1 text-[12.5px] text-muted-foreground">and {merged.more} more in 30 days</p> : null}
          </>
        ) : (
          <Empty>{merged.empty}</Empty>
        )
      ) : merged.kind === 'days' ? (
        <>
          <p className="px-1 text-[12.5px] leading-snug text-muted-foreground">{merged.note}</p>
          <DayBars
            title="Merged by day"
            counts="Changes merged each day, by itself in YOLO mode or on your yes. The line is the changes declined."
            figure={merged.figure}
            days={merged.days}
            series={merged.series}
            line={merged.line}
          />
        </>
      ) : (
        <Empty>{merged.note}</Empty>
      )}
    </Block>
  )
})

function MergedRow({ row }: { row: MergedLine }) {
  const { review } = row
  const open = review ? () => useView.getState().openReviewFor(review) : undefined
  const said = [row.words, row.sentBack, row.rate !== null ? `rated ${row.rate}` : null, row.head ? `at ${row.head}` : null].filter(Boolean).join(', ')
  return (
    <Row onOpen={open} label={`${row.when}: ${row.title}, ${said}.${open ? ' Opens its review.' : ''}`} mark={{ 'data-opens': `merged-${row.item}` }} className="min-h-10 py-1.5">
      <span className="w-[84px] shrink-0 text-[12px] text-muted-foreground tabular-nums">{row.when}</span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span title={row.title} className={cn('min-w-0 truncate text-[13.5px] font-medium', row.outcome === 'declined' && 'text-muted-foreground')}>
          {row.title}
        </span>
        {row.sentBack ? <span className="shrink-0 text-[12px] text-muted-foreground">{row.sentBack}</span> : null}
      </span>
      <span className="w-[64px] shrink-0 text-right text-[12px] text-muted-foreground tabular-nums">{row.rate !== null ? `rated ${row.rate}` : ''}</span>
      <Chip tone={OUTCOME_TONE[row.outcome]} className="w-[72px] justify-center">
        {row.words}
      </Chip>
      <span className="w-[56px] shrink-0 font-mono text-[11.5px] text-muted-foreground">{row.head ?? ''}</span>
    </Row>
  )
}

/** Its TLA+ models on the default branch and their last result, each opening its run. */
export const ModelsBlock = memo(function ModelsBlock({ models, live }: { models: TakenPage['models']; live: boolean }) {
  return (
    <Block id={SECTION_ID.models} label="Models" count={models.facts.length}>
      {models.facts.length ? <ProjectModels models={models.facts} live={live} /> : <Empty>{models.empty}</Empty>}
    </Block>
  )
})

function openYolo() {
  useView.getState().openScreen('yolo')
  requestCanvasFocus()
}

/** Its YOLO readiness as the YOLO page shows it: where it stands, the parts still to set up, and those in place. */
export const ReadinessBlock = memo(function ReadinessBlock({ readiness }: { readiness: ReadinessSection }) {
  return (
    <Block
      id={SECTION_ID.readiness}
      label="YOLO readiness"
      aside={
        <Button variant="ghost" size="sm" data-stop="" data-opens="yolo" onClick={openYolo} className="ml-auto text-muted-foreground">
          Open YOLO mode
        </Button>
      }
    >
      {readiness.known ? (
        <div className="flex flex-col gap-1.5 rounded-3xl bg-background px-5 py-4">
          <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={readiness.tone}>{readiness.state}</Chip>
            <Checked at={readiness.checkedAt} />
            {readiness.yoloOn ? null : <span className="text-[12px] text-muted-foreground">· YOLO mode is off</span>}
          </div>
          <p className="text-[13px] leading-snug text-foreground/85">{readiness.detail}</p>
          {readiness.groups.map(({ heading, rows }) => (
            <section key={heading} aria-label={heading} className="flex flex-col">
              <h3 className="pt-1.5 pb-0.5 text-[11.5px] font-medium text-muted-foreground">{heading}</h3>
              <ul className="flex flex-col">
                {rows.map((row) => (
                  <PartLine key={row.name} row={row} />
                ))}
              </ul>
            </section>
          ))}
          {readiness.inPlace ? (
            <p title={readiness.inPlace} className="truncate pt-1 text-[12.5px] text-muted-foreground">
              {readiness.inPlace}
            </p>
          ) : null}
        </div>
      ) : (
        <Empty>{readiness.empty}</Empty>
      )}
    </Block>
  )
})

/** When its readiness was last recorded. The one part of the page that follows the clock. */
function Checked({ at }: { at: string | null }) {
  const now = useNow(at !== null, 30_000)
  return <span className="text-[12px] text-muted-foreground tabular-nums">{at ? `Checked ${whenText(Date.parse(at), ZONE, now)}` : 'Not checked yet'}</span>
}

/** A part still to set up, with the same columns as on the YOLO page. */
function PartLine({ row }: { row: PartRow }) {
  return (
    <li className="grid min-h-7 grid-cols-[128px_140px_minmax(0,1fr)_80px] items-center gap-x-3 text-[12.5px]">
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
      <a href={open.url} target="_blank" rel="noopener noreferrer" data-stop="" aria-label={`${open.label} for ${label}`} onClick={(event) => openOnGitHub(event, open.url)} className={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), 'justify-self-end')}>
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

/** A project work mode has not taken: its name, that it is not taken, and the button that takes it, as Discovery's. */
export function NotTaken({ slug, name, state, line, live }: { slug: string; name: string; state: string; line: string; live: boolean }) {
  const busy = useWorkUi((store) => Boolean(store.busy[slug]))
  const said = useWorkUi((store) => store.said[slug])
  return (
    <header className="flex flex-col gap-3 px-1">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className={TITLE}>{name}</h1>
        <Chip tone="quiet">{state}</Chip>
      </div>
      <p className="max-w-[68ch] text-[13.5px] leading-relaxed text-muted-foreground">{line}</p>
      <div>
        <Button data-stop="" disabled={busy} focusableWhenDisabled onClick={() => void runWork({ do: 'proposal', slug, answer: 'take' }, { live, place: slug })}>
          Take it
        </Button>
      </div>
      {said?.tone === 'refused' ? <SaidLine tone="refused">{said.text}</SaidLine> : null}
    </header>
  )
}

/** A project the window cannot show: work mode is not known yet, or knows no project by that name. */
export function Unknown({ name, line }: { name: string; line: string }) {
  return (
    <header className="flex flex-col gap-2 px-1">
      <h1 className={TITLE}>{name}</h1>
      <p className="max-w-[68ch] text-[13.5px] leading-relaxed text-muted-foreground">{line}</p>
    </header>
  )
}
