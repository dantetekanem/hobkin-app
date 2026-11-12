import { motion } from 'motion/react'
import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LEVEL_WORDS, type AssessmentStatus, type ChangeAssessment, type Level, type Unit } from '#shared/review/assessment.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { LevelBadge } from '../graph/kinds.tsx'
import { useRig, useSession, useSessionStore } from '../state/context.tsx'
import { readUnitHeading, unitOfHeading } from './model.ts'

/** What the frame's menu covers at the top of the canvas, which the page starts under. */
const MENU_DEPTH = 112

/** The words of the parts that hold the units, as the story heads them. */
const SECTION_LEVEL = new Map<string, Level>(Object.entries(LEVEL_WORDS).map(([level, words]) => [words, level as Level]))

/** The plain words inside rendered children. */
function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : ''))
    .join('')
}

/**
 * The story view: a finished change's change review, read top to bottom (spec 032), on a calm page of its own beside
 * the panel. Every unit's heading leads with its level, Needs you, Worth a look or Safe, marks it when it is critical,
 * and can show its nodes in the graph. While the review is under way the page says how far along it is; when it
 * failed, why, with a way to run it again.
 */
export function StoryView({ assessment, status, live, again }: { assessment: ChangeAssessment | null; status: AssessmentStatus | null; live: boolean; again: () => void }) {
  const rig = useRig()
  const page = useRef<HTMLDivElement>(null)

  // The keyboard that comes to the review comes to the page, so the arrows, Space and the page keys scroll it. Back in
  // the graph, it goes back to the review, where the graph's keys are.
  useEffect(() => {
    const element = page.current
    const root = element?.closest<HTMLElement>('[data-rv-root]')
    if (!element || !root) return
    const take = (event: FocusEvent) => {
      if (event.target === root) element.focus({ preventScroll: true })
    }
    root.addEventListener('focus', take)
    if (document.activeElement === root || document.activeElement === document.body) element.focus({ preventScroll: true })
    return () => {
      root.removeEventListener('focus', take)
      const active = document.activeElement
      if (!active || active === document.body || element.contains(active)) root.focus({ preventScroll: true })
    }
  }, [])

  return (
    <motion.div ref={page} tabIndex={-1} data-rv-reading aria-label="The change review" className="rv-reading rv-scroll absolute inset-y-0 right-0 z-[12] overflow-y-auto" style={{ left: rig.side }}>
      <div className="mx-auto flex max-w-[740px] flex-col px-8 pb-24" style={{ paddingTop: MENU_DEPTH }}>
        {assessment ? <Story assessment={assessment} /> : <Underway status={status} live={live} again={again} />}
      </div>
    </motion.div>
  )
}

/** The story, with the review's summary over it. */
function Story({ assessment }: { assessment: ChangeAssessment }) {
  const store = useSessionStore()
  const nodes = useSession((session) => session.view.nodes)
  const units = useMemo(() => assessment.units?.units ?? [], [assessment.units])
  const told = useMemo(() => new Set(nodes.flatMap((node) => (node.unit ? [node.unit] : []))), [nodes])
  const { summary } = assessment

  const components = useMemo<Components>(
    () => ({
      h1: ({ children }) => <h1 className="font-heading text-[28px] leading-[1.2] font-semibold tracking-[-0.02em] text-balance">{children}</h1>,
      h2: ({ children }) => {
        const level = SECTION_LEVEL.get(textOf(children).trim())
        return (
          <h2 className="rv-section font-heading text-[21px] leading-[1.25] font-semibold tracking-[-0.015em]" data-level={level}>
            {children}
          </h2>
        )
      },
      h3: ({ children }) => {
        const heading = readUnitHeading(textOf(children))
        if (!heading) return <h3 className="mt-8 font-heading text-[18px] leading-[1.3] font-semibold">{children}</h3>
        const unit = unitOfHeading(units, heading)
        return <UnitHeading number={heading.number} title={heading.title} level={heading.level} critical={heading.critical} unit={unit} canShow={unit != null && told.has(unit.id)} show={() => unit && store.getState().showUnit(unit.id)} />
      },
      h4: ({ children }) => <h4 className="mt-6 font-heading text-[16px] font-semibold">{children}</h4>,
      p: ({ children }) => <p className="my-3 text-[16px] leading-[1.65] text-pretty">{children}</p>,
      ul: ({ children }) => <ul className="my-3 list-disc pl-6 text-[16px] leading-[1.6] marker:text-muted-foreground [&_ul]:my-1">{children}</ul>,
      ol: ({ children }) => <ol className="my-3 list-decimal pl-6 text-[16px] leading-[1.6] marker:text-muted-foreground [&_ol]:my-1">{children}</ol>,
      li: ({ children }) => <li className="my-1 pl-1 text-pretty">{children}</li>,
      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
      em: ({ children }) => <em className="text-muted-foreground italic">{children}</em>,
      blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-border-strong pl-4 text-muted-foreground">{children}</blockquote>,
      hr: () => <hr className="my-8 border-border" />,
      code: ({ children }) => <code className="rounded-md bg-surface-2 px-1 py-0.5 font-mono text-[0.88em] [overflow-wrap:anywhere]">{children}</code>,
      pre: ({ children }) => {
        const code = Children.toArray(children)[0]
        const props = isValidElement<{ className?: string; children?: ReactNode }>(code) ? code.props : null
        const text = textOf(props?.children ?? children).replace(/\n$/, '')
        if (props?.className?.split(/\s+/).includes('language-diff')) return <ChangedLines text={text} />
        return <pre className="rv-story-diff px-4 whitespace-pre-wrap">{text}</pre>
      },
      table: ({ children }) => (
        <div className="my-4 overflow-x-auto">
          <table className="w-full border-collapse text-[15px]">{children}</table>
        </div>
      ),
      th: ({ children }) => <th className="border-b border-border-strong px-2.5 py-1.5 text-left font-semibold">{children}</th>,
      td: ({ children }) => <td className="border-b border-border px-2.5 py-1.5 align-top">{children}</td>,
      // Links open outside the app, and a picture is never fetched: it shows as its words.
      a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-border-strong underline-offset-2 hover:decoration-foreground">
          {children}
        </a>
      ),
      img: ({ alt }) => <span>{alt || 'An image'}</span>,
    }),
    [store, told, units],
  )

  return (
    <article className="flex flex-col">
      <header className="flex flex-col gap-2.5 border-b border-border pb-5">
        <p className="font-heading text-[12.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">The change review</p>
        <div className="flex flex-wrap items-center gap-2">
          <LevelBadge level={summary.level} size="large" />
          {summary.critical ? <span className="rv-critical">Critical</span> : null}
          <span className="font-heading text-[14px] font-semibold text-muted-foreground tabular-nums">
            {summary.needsYou} need you · {summary.worthALook} worth a look · {summary.safe} safe
          </span>
        </div>
        <p className="text-[14px] leading-snug text-muted-foreground">
          {summary.storyBy === 'model'
            ? `Written by a model from the facts the review found${assessment.blind?.ran ? ', then checked by a second, blind one' : ''}.`
            : 'Written from the facts alone: no model was asked.'}{' '}
          <span className="inline-flex items-center gap-1">
            <Kbd>T</Kbd> shows the graph.
          </span>
        </p>
      </header>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {assessment.story}
      </ReactMarkdown>
    </article>
  )
}

/** A unit's heading: its level and whether it is critical, its number and claim, and the way to it in the graph. */
function UnitHeading({ number, title, level, critical, unit, canShow, show }: { number: number; title: string; level: Level; critical: boolean; unit: Unit | undefined; canShow: boolean; show: () => void }) {
  return (
    <div className="rv-unit flex flex-col gap-2" data-level={level}>
      <div className="flex flex-wrap items-center gap-2">
        <LevelBadge level={level} size="large" />
        {critical ? <span className="rv-critical">Critical</span> : null}
        <span className="font-heading text-[13px] font-semibold text-muted-foreground tabular-nums">
          Unit {number}
          {unit?.reading_minutes ? ` · about ${Math.max(1, Math.round(unit.reading_minutes))} min` : ''}
        </span>
        {canShow ? (
          <Button size="sm" variant="outline" data-stop className="ml-auto h-8 px-3 text-[13px]" onClick={show}>
            Show in graph
          </Button>
        ) : null}
      </div>
      <h3 className="font-heading text-[19px] leading-[1.3] font-semibold text-pretty [overflow-wrap:anywhere]">{title}</h3>
    </div>
  )
}

/** Changed lines from the story's ```diff blocks: each tinted by what happened to it, with its marker. */
function ChangedLines({ text }: { text: string }) {
  return (
    <div className="rv-story-diff" role="group" aria-label="Changed lines">
      {text.split('\n').map((line, index) => {
        const kind = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'context'
        const words = kind === 'context' ? (line.startsWith(' ') ? line.slice(1) : line) : line.slice(1)
        return (
          <div key={index} className="rv-story-line" data-kind={kind}>
            <span className="rv-story-mark" aria-hidden="true">
              {kind === 'added' ? '+' : kind === 'removed' ? '−' : ''}
            </span>
            <span className="rv-story-text">
              {kind === 'context' ? null : <span className="sr-only">{kind === 'added' ? 'Added: ' : 'Removed: '}</span>}
              {words || ' '}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** A step of a change review, in plain words. */
const STEP_WORDS: Record<string, string> = {
  triage: 'Sorting the files',
  'map-search': 'Mapping what changed',
  'map-proof': "Running the project's tests for proof",
  'risk-floor': 'Rating each part from its facts',
  'risk-model': 'A careful second look',
  shape: 'Putting the parts into units',
  story: 'Writing the story',
  'blind-check': 'A blind check of the story',
}
const STATUS_WORDS: Record<string, string> = { pending: 'Waiting', running: 'Now', done: 'Done', skipped: 'Skipped', failed: 'Failed' }

/** A step as the status may carry it, when the host passes them on. */
interface StepLine {
  id: string
  status: string
  seconds: number | null
  done?: number
  total?: number
  note?: string
}

const minutesLeft = (seconds: number) => (seconds < 60 ? 'less than a minute left' : `about ${Math.round(seconds / 60)} minute${Math.round(seconds / 60) === 1 ? '' : 's'} left`)

/** No story yet: how far along its review is, why it stopped, or that there is none, with a way to run one. */
function Underway({ status, live, again }: { status: AssessmentStatus | null; live: boolean; again: () => void }) {
  const [asked, setAsked] = useState(false)
  const state = status?.state ?? 'idle'
  const percent = Math.max(0, Math.min(100, Math.round(status?.percent ?? 0)))
  const steps = (status as (AssessmentStatus & { steps?: StepLine[] }) | null)?.steps ?? []
  useEffect(() => setAsked(false), [state])
  const runAgain = (
    <Button
      className="self-start"
      data-stop
      disabled={!live || asked}
      onClick={() => {
        setAsked(true)
        again()
      }}
    >
      {asked ? 'Asked to review it again' : state === 'failed' ? 'Review again' : 'Review it'}
    </Button>
  )

  if (state === 'queued' || state === 'running') {
    return (
      <section aria-label="The change review is under way" className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Hob mood="searching" size={64} stage="var(--hb-surface)" />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="font-heading text-[24px] leading-[1.2] font-semibold tracking-[-0.02em]">Reviewing this change</h1>
            <p className="text-[16px] leading-snug text-pretty text-muted-foreground">{state === 'queued' ? 'Waiting its turn: one change review runs at a time.' : status?.now ? `${status.now.charAt(0).toUpperCase()}${status.now.slice(1)}.` : 'Under way.'}</p>
          </div>
        </div>
        {state === 'running' ? (
          <div className="flex flex-col gap-2">
            <div className="rv-progress" role="progressbar" aria-label="How far along the change review is" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <span style={{ transform: `scaleX(${percent / 100})` }} />
            </div>
            <p className="text-[14px] text-muted-foreground tabular-nums">
              {percent}%{status?.eta != null ? `, ${minutesLeft(status.eta)}` : ''}
            </p>
          </div>
        ) : null}
        {steps.length > 0 ? (
          <ol className="flex flex-col gap-1.5 text-[15px]">
            {steps.map((step) => (
              <li key={step.id} className="flex items-baseline gap-3" data-status={step.status}>
                <span className="w-16 shrink-0 font-heading text-[12.5px] font-semibold text-muted-foreground uppercase">{STATUS_WORDS[step.status] ?? step.status}</span>
                <span className="min-w-0 flex-1">
                  {STEP_WORDS[step.id] ?? step.id}
                  {step.total ? ` · ${step.done ?? 0} of ${step.total}` : ''}
                  {step.note ? <span className="text-muted-foreground"> · {step.note}</span> : null}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{step.seconds != null ? `${Math.round(step.seconds)}s` : ''}</span>
              </li>
            ))}
          </ol>
        ) : null}
        <p className="text-[14px] leading-snug text-muted-foreground">
          The story opens here when it is ready. Meanwhile <Kbd>T</Kbd> shows the graph.
        </p>
      </section>
    )
  }

  if (state === 'failed') {
    return (
      <section aria-label="The change review stopped" className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Hob mood="confused" size={64} stage="var(--hb-surface)" />
          <h1 className="font-heading text-[24px] leading-[1.2] font-semibold tracking-[-0.02em]">The change review stopped</h1>
        </div>
        <p role="status" className="text-[16px] leading-[1.6] text-pretty text-bad-fg [overflow-wrap:anywhere]">
          {status?.error ?? 'It stopped before it finished.'}
        </p>
        {runAgain}
        <p className="text-[14px] text-muted-foreground">
          <Kbd>T</Kbd> shows the graph.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="No change review yet" className="flex flex-col gap-4">
      <h1 className="font-heading text-[24px] leading-[1.2] font-semibold tracking-[-0.02em]">No change review yet</h1>
      <p className="text-[16px] leading-[1.6] text-muted-foreground">This commit has not been reviewed. The graph shows the change meanwhile.</p>
      {runAgain}
    </section>
  )
}
