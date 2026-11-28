import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useStill } from '@/app/still.ts'
import { useStops } from '@/app/stops.ts'
import { Button } from '@/components/ui/button.tsx'
import { runCommand } from '@/lib/host/client.ts'
import { useLudicrous } from '@/lib/host/hooks.ts'
import { cn } from '@/lib/utils.ts'
import type { LudicrousArea, LudicrousFolder, LudicrousMinute, LudicrousPlan, LudicrousRun, LudicrousState, LudicrousTierAgents } from '#shared/protocol/ludicrous.ts'
import type { WorkProject } from '#shared/protocol/work.ts'
import {
  BOX_LABEL, BOX_UNDER, controlsOf, DETOURS, NOBODY_ELSE, numbersOf, OPENING, PATH_STEPS, pathOf, phaseLine, startingTier, TIER_LABEL, tierWords,
  type Detour, type Path, type PathStep,
} from './ludicrous-page.ts'
import { areaLine, mapOf, mapTotals } from './ludicrous-map.ts'
import { SAMPLE_LUDICROUS } from './ludicrous-sample.ts'
import { NewProjectSheet } from './NewProjectSheet.tsx'
import { Segmented } from './parts.tsx'
import { useWorkView } from './store.ts'
import { IslandLand, nameStyle, plotStyle, SEA, WEATHER } from './WorldMap.tsx'
import './ludicrous.css'

/**
 * Ludicrous mode's page in Work (_specs/076-ludicrous-mode), beside YOLO: before a run, what it does, the project, how hard to push the
 * computer and the box; then the run's path, its numbers, the map of its areas and their history. Two controls only, the main button and
 * Stop, always under the box or the phase line. With no host it shows a sample run, and nothing reaches hobkin.
 */
export function LudicrousScreen() {
  const { work, live } = useWorkView()
  const hosted = useLudicrous()
  const projects = (work?.projects ?? []).filter((project) => project.state === 'chosen' && project.kind !== 'goal')
  return <LudicrousPage state={live ? hosted : SAMPLE_LUDICROUS} projects={projects} live={live} />
}

export interface LudicrousPageProps {
  state: LudicrousState | null
  /** The code projects Work has, which a run can take. */
  projects: WorkProject[]
  live: boolean
  /** What the page starts with, and the folder as read, in place of the host's answer. */
  start?: { slug?: string; idea?: string; tier?: LudicrousTierAgents; folder?: LudicrousFolder }
}

export function LudicrousPage(props: LudicrousPageProps) {
  // A host from before Ludicrous sends no state, so there is nothing to plan with yet.
  if (!props.state) return <NoLudicrousYet />
  return <LudicrousRunPage {...props} />
}

function NoLudicrousYet() {
  return (
    <div className={SCREEN_SCROLLER}>
      <div className={`${SCREEN_COLUMN} flex flex-col gap-6 pb-20`}>
        <h1 className="eyebrow">Ludicrous mode</h1>
        <Opening />
        <p className="text-[13.5px] text-muted-foreground">This hobkin's host does not run Ludicrous mode yet. It does once the host starts again.</p>
      </div>
    </div>
  )
}

function LudicrousRunPage({ state, projects, live, start = {} }: LudicrousPageProps) {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)
  const run = state?.run ?? null
  const [slug, setSlug] = useState<string | null>(start.slug ?? run?.slug ?? null)
  const [idea, setIdea] = useState(start.idea ?? '')
  const [tier, setTier] = useState<LudicrousTierAgents>(() => start.tier ?? startingTier(state))
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const newProject = useRef<HTMLButtonElement | null>(null)
  const read = useFolder(live, slug)
  const folder = start.folder ?? read
  const controls = controlsOf({ state, slug, idea, folder })

  // A run on the page names its project, and the box opens again on it after a stop in planning.
  useEffect(() => {
    if (run?.slug) setSlug((was) => was ?? run.slug)
  }, [run?.slug])

  const send = async (asked: () => Promise<unknown>) => {
    if (!live) return
    setSending(true)
    setProblem(null)
    try {
      await asked()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }
  const press = () =>
    send(() => (controls.main.action === 'plan' && slug ? runCommand('work.ludicrous.plan', { slug, idea: idea.trim(), tier }) : runCommand('work.ludicrous.go', { answers })))
  const stop = () => send(() => runCommand('work.ludicrous.stop', {}))
  const picked = projects.find((project) => project.slug === slug) ?? null

  return (
    <div ref={root} className={SCREEN_SCROLLER}>
      <div className={`${SCREEN_COLUMN} flex flex-col gap-6 pb-20`}>
        <header className="flex items-center justify-between gap-4">
          <h1 className="eyebrow">Ludicrous mode</h1>
          {run ? <span className="rounded-full bg-background px-3 py-1 font-mono text-[11px] text-muted-foreground">{run.name}</span> : null}
        </header>
        <RunPath path={pathOf(run)} />
        {controls.box ? (
          <>
            <Opening />
            <section aria-label="The run" className="grid gap-5 rounded-3xl bg-background px-5 py-4 sm:grid-cols-2">
              <ProjectField projects={projects} slug={slug} onPick={setSlug} onNew={() => setAdding(true)} newRef={newProject} live={live} />
              <TierField state={state} tier={tier} onPick={setTier} />
              {picked ? (
                <div className="sm:col-span-2">
                  <span className="eyebrow">Who else works here</span>
                  <p className="mt-1.5 text-[13px] leading-relaxed">{NOBODY_ELSE}</p>
                </div>
              ) : null}
            </section>
          </>
        ) : null}
        <section aria-label="Ludicrous controls" className="flex flex-col gap-3 rounded-3xl bg-background px-5 py-4">
          {controls.box ? (
            <label className="flex flex-col gap-2">
              <span className="font-heading text-[14px] font-medium">{BOX_LABEL}</span>
              <textarea
                value={idea}
                onChange={(event) => setIdea(event.target.value)}
                rows={5}
                className="w-full resize-y rounded-2xl border border-border bg-transparent px-3.5 py-2.5 text-[13.5px] leading-relaxed outline-none focus-visible:border-ring"
              />
              <span className="text-[12px] text-muted-foreground">{BOX_UNDER}</span>
            </label>
          ) : run ? (
            <div>
              <h2 className="font-heading text-[18px] font-semibold">
                {run.name}
                <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">{run.tier} at once</span>
              </h2>
              <p aria-live="polite" className="mt-1 text-[13.5px] text-muted-foreground">
                {phaseLine(run)}
              </p>
              {run.pr ? (
                <p className="mt-1 text-[12.5px]">
                  Pull request: <a href={run.pr.url} className="underline underline-offset-2">{run.pr.url}</a>
                  {run.pr.draft ? ' (draft)' : ''}
                </p>
              ) : null}
              {run.lines.map((line) => (
                <p key={line} className="mt-1 text-[12.5px] text-muted-foreground">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" data-stop="" disabled={controls.main.disabled || sending} onClick={() => void press()}>
              {controls.main.label}
            </Button>
            <Button type="button" variant="outline" data-stop="" disabled={controls.stop.disabled || sending} onClick={() => void stop()}>
              Stop
            </Button>
            {controls.main.reason ? <span className="text-[12.5px] text-muted-foreground">{controls.main.reason}</span> : null}
            {problem ? <span className="text-[12.5px] text-destructive">{problem}</span> : null}
          </div>
        </section>
        {run && !controls.box ? <Numbers run={run} /> : null}
        {run?.phase === 'planning' ? <Planning run={run} /> : null}
        {run?.plan && (run.phase === 'plan-ready' || run.phase === 'stopped') ? <Plan plan={run.plan} answers={answers} onAnswer={setAnswers} /> : null}
        {run && run.areas.length && !controls.box ? <LudicrousMap areas={run.areas} name={run.name} /> : null}
        {run && run.history.length > 1 && !controls.box ? <History history={run.history} tier={run.tier} /> : null}
        {live ? null : <p className="text-[12px] text-muted-foreground">Sample run. No host is running, so nothing here reaches hobkin.</p>}
      </div>
      <NewProjectSheet open={adding} from="work" live={live} onClose={() => setAdding(false)} returnTo={newProject} />
    </div>
  )
}

/** The picked project's folder as the host reads it, again every few seconds while the box shows, so a commit enables the button. */
function useFolder(live: boolean, slug: string | null): LudicrousFolder | null {
  const [folder, setFolder] = useState<LudicrousFolder | null>(null)
  useEffect(() => {
    setFolder(null)
    if (!slug) return
    if (!live) {
      setFolder({ clean: true, reason: null })
      return
    }
    let gone = false
    const read = () =>
      runCommand('work.ludicrous.folder', { slug }).then(
        (read) => (gone ? null : setFolder(read)),
        (error: unknown) => (gone ? null : setFolder({ clean: false, reason: error instanceof Error ? error.message : String(error) })),
      )
    void read()
    const every = setInterval(() => void read(), 4000)
    return () => {
      gone = true
      clearInterval(every)
    }
  }, [live, slug])
  return folder
}

function Opening() {
  return (
    <section aria-label="What Ludicrous does" className="flex max-w-[72ch] flex-col gap-3 text-[14px] leading-relaxed">
      <p className="font-heading text-[22px] font-semibold leading-snug">{OPENING.lead}</p>
      {OPENING.paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph.map((part, at) => (part.bold ? <strong key={at}>{part.text}</strong> : <span key={at}>{part.text}</span>))}</p>
      ))}
    </section>
  )
}

function ProjectField({ projects, slug, onPick, onNew, newRef, live }: {
  projects: WorkProject[]
  slug: string | null
  onPick: (slug: string | null) => void
  onNew: () => void
  newRef: RefObject<HTMLButtonElement | null>
  live: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="eyebrow">Project</span>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="A project Work has"
          value={slug ?? ''}
          onChange={(event) => onPick(event.target.value || null)}
          className="h-8 min-w-[12rem] rounded-full border border-border bg-transparent px-3 text-[13px]"
        >
          <option value="">Pick a project Work has</option>
          {projects.map((project) => (
            <option key={project.slug} value={project.slug}>
              {project.name}
            </option>
          ))}
        </select>
        <Button ref={newRef} type="button" size="sm" variant="outline" data-stop="" disabled={!live} onClick={onNew}>
          New project
        </Button>
      </div>
    </div>
  )
}

function TierField({ state, tier, onPick }: { state: LudicrousState | null; tier: LudicrousTierAgents; onPick: (tier: LudicrousTierAgents) => void }) {
  const machine = state?.machine
  const chosen = machine?.tiers.find((each) => each.agents === tier)
  const words = chosen && machine ? tierWords(chosen, machine.picked) : null
  return (
    <div className="flex flex-col gap-2">
      <span className="eyebrow">{TIER_LABEL}</span>
      <Segmented
        label={TIER_LABEL}
        name="ludicrous-tier"
        value={String(tier)}
        options={(machine?.tiers ?? []).map((each) => ({ value: String(each.agents), label: each.agents === machine?.picked ? `${each.agents} · hobkin's pick` : String(each.agents) }))}
        onChoose={(value) => onPick(Number(value) as LudicrousTierAgents)}
      />
      {words ? <p className="text-[12.5px] text-muted-foreground">{words.line}</p> : null}
      {words?.risk ? <p className="text-[12.5px] text-destructive">{words.risk}</p> : null}
    </div>
  )
}

// The path's geometry, in a box 1000 wide: the steps along one line, Building a stretch of it, and the detours above and below it.
const LINE_Y = 76
const X: Record<PathStep, number> = { idea: 60, planning: 250, plan: 440, building: 610, done: 940 }
const BUILD_END = 800
const DETOUR_PATH: Record<Detour, string> = {
  waiting: `M ${X.building + 20} ${LINE_Y} C ${X.building + 50} 18, ${BUILD_END - 50} 18, ${BUILD_END - 20} ${LINE_Y}`,
  stopped: `M ${X.building + 20} ${LINE_Y} C ${X.building + 50} 134, ${BUILD_END - 50} 134, ${BUILD_END - 20} ${LINE_Y}`,
}
const DETOUR_LABEL_Y: Record<Detour, number> = { waiting: 24, stopped: 146 }

/** The run's path: passed steps solid, steps ahead dotted, the detours fainter, and the step at work glowing with a flow along its line. */
function RunPath({ path }: { path: Path }) {
  const still = useStill()
  const segments = PATH_STEPS.slice(0, -1).map((step, index) => {
    const next = PATH_STEPS[index + 1]!
    const from = X[step.id] + 14
    const to = step.id === 'building' ? X.done - 14 : X[next.id] - 14
    return { id: step.id, from, to, passed: path.passed.includes(next.id) || (path.passed.includes(step.id) && path.at === next.id) }
  })
  const nodeState = (id: PathStep | Detour) => (path.at === id ? 'now' : path.passed.includes(id as PathStep) ? 'passed' : 'ahead')
  return (
    <nav aria-label="Where the run is" className="ludicrous-path rounded-3xl bg-background px-3 py-2" data-still={still || undefined}>
      <svg viewBox="0 0 1000 156" role="img" aria-label={`The run is at ${[...PATH_STEPS, ...DETOURS].find(({ id }) => id === path.at)?.label ?? 'its idea'}.`} className="w-full">
        {segments.map((segment) => (
          <line key={segment.id} x1={segment.from} y1={LINE_Y} x2={segment.to} y2={LINE_Y} className="line" data-passed={segment.passed || undefined} />
        ))}
        {path.working && path.at !== 'waiting' && path.at !== 'stopped' ? <line x1={X[path.at as PathStep] + 14} y1={LINE_Y} x2={path.at === 'building' ? BUILD_END : X[path.at as PathStep] + 120} y2={LINE_Y} className="flow" /> : null}
        {DETOURS.map(({ id, label }) => (
          <g key={id} className="detour" data-now={path.at === id || undefined}>
            <path d={DETOUR_PATH[id]} className="line" />
            {path.at === id && path.working ? <path d={DETOUR_PATH[id]} className="flow" /> : null}
            <text x={(X.building + BUILD_END) / 2} y={DETOUR_LABEL_Y[id]} textAnchor="middle" className="label" data-state={nodeState(id)}>
              {label}
            </text>
          </g>
        ))}
        {PATH_STEPS.map(({ id, label }) => (
          <g key={id}>
            <circle cx={X[id]} cy={LINE_Y} r={id === path.at ? 11 : 8} className="node" data-state={nodeState(id)} />
            <text x={X[id]} y={id === 'building' ? LINE_Y - 20 : LINE_Y + 34} textAnchor="middle" className="label" data-state={nodeState(id)}>
              {label}
            </text>
          </g>
        ))}
      </svg>
    </nav>
  )
}

function Numbers({ run }: { run: LudicrousRun }) {
  return (
    <section aria-label="The run in numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {numbersOf(run).map(({ label, figure, after }) => (
        <div key={label} className="rounded-2xl bg-background px-4 py-3">
          <span className="eyebrow">{label}</span>
          <p className="mt-1 font-heading text-[26px] font-semibold tabular-nums leading-none">
            {figure}
            {after ? <small className="ml-1 text-[13px] font-normal text-muted-foreground">{after}</small> : null}
          </p>
        </div>
      ))}
    </section>
  )
}

const ROUNDS = ['Each planner drafts alone', 'Each reads the other four and answers them', 'One plan, then a spec for every area', 'Each checks the whole set against its lens']

function Planning({ run }: { run: LudicrousRun }) {
  const round = typeof run.round === 'number' ? run.round : 4
  return (
    <section aria-label="Planning" className="flex flex-col gap-3 rounded-3xl bg-background px-5 py-4">
      <span className="eyebrow">Five planners, four rounds</span>
      <ol className="flex flex-col gap-1.5 text-[13.5px]">
        {ROUNDS.map((words, index) => (
          <li key={words} className={cn('flex items-center gap-2', index + 1 < round ? 'text-muted-foreground line-through' : index + 1 === round ? 'font-medium' : 'text-muted-foreground')}>
            <span className="inline-grid size-5 place-items-center rounded-full border border-border font-mono text-[10px]">{index + 1}</span>
            {words}
          </li>
        ))}
      </ol>
      <blockquote className="border-l-2 border-border pl-3 text-[13px] text-muted-foreground">{run.idea}</blockquote>
    </section>
  )
}

function Plan({ plan, answers, onAnswer }: { plan: LudicrousPlan; answers: Record<string, string>; onAnswer: (next: Record<string, string>) => void }) {
  return (
    <section aria-label="The plan" className="flex flex-col gap-4 rounded-3xl bg-background px-5 py-4">
      <div>
        <span className="eyebrow">The areas</span>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {plan.areas.map((area) => (
            <li key={area.id} className="text-[13px]">
              <b className="font-medium">{area.name}</b>
              {area.depends.length ? <span className="text-muted-foreground"> · builds on {area.depends.join(', ')}</span> : null}
              {area.summary ? <p className="text-[12.5px] text-muted-foreground">{area.summary}</p> : null}
            </li>
          ))}
        </ul>
      </div>
      {plan.questions.length ? (
        <div className="flex flex-col gap-3">
          <span className="eyebrow">Questions that change the plan</span>
          {plan.questions.map((question) => (
            <fieldset key={question.id} className="flex flex-col gap-1.5">
              <legend className="text-[13.5px] font-medium">{question.question}</legend>
              {question.options.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="radio"
                    name={`ludicrous-${question.id}`}
                    checked={(answers[question.id] ?? question.pick) === option.id}
                    onChange={() => onAnswer({ ...answers, [question.id]: option.id })}
                  />
                  {option.label}
                  {option.id === question.pick ? <span className="text-[11px] text-muted-foreground">the planners' pick</span> : null}
                </label>
              ))}
              {question.why ? <p className="text-[12px] text-muted-foreground">{question.why}</p> : null}
            </fieldset>
          ))}
          <p className="text-[12px] text-muted-foreground">Go Ludicrous takes the planners' pick for any question you leave as it is.</p>
        </div>
      ) : null}
    </section>
  )
}

/** The plan's areas as islands on hobkin's globe, each with its agents now, its leader and its steps. */
export function LudicrousMap({ areas, name }: { areas: readonly LudicrousArea[]; name: string }) {
  const still = useStill()
  const charted = mapOf(areas)
  return (
    <section aria-label="The map" className="relative">
      <header className="mb-4">
        <h2 className="eyebrow">{name} · {charted.length} areas</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">{mapTotals(areas)}</p>
      </header>
      <div
        role="img"
        aria-label={`The plan's ${charted.length} areas as islands: ${charted.map(({ area }) => `${area.name}, ${areaLine(area)}`).join('; ')}.`}
        className="world @container relative mx-auto aspect-square w-full max-w-[clamp(420px,calc(100vh_-_300px),780px)]"
        data-still={still || undefined}
      >
        {SEA}
        {charted.map(({ island, area }, order) => (
          <IslandLand key={island.slug} island={island} order={order} live={area.agents > 0} paused={!area.open && !area.done} active={false} focused={false} still={still} landing={undefined} />
        ))}
        {WEATHER}
        {charted.map(({ island, area }) => (
          <div key={island.slug} aria-hidden="true" className="absolute left-0 top-0" style={plotStyle(island)}>
            <span className="world-name" style={nameStyle(island)}>
              <span className="block truncate font-heading text-[13px] font-semibold leading-[1.25]">{area.name}</span>
              <span className="block truncate font-mono text-[10px] leading-[1.35] text-muted-foreground">{areaLine(area)}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** A line of the minutes in a small chart, from zero at the bottom to `most` at the top. */
function Chart({ label, now, points, most }: { label: string; now: string; points: number[]; most: number }) {
  const width = 440
  const height = 120
  const step = points.length > 1 ? width / (points.length - 1) : width
  const line = points.map((value, index) => `${(index * step).toFixed(1)},${(height - (value / Math.max(1, most)) * height).toFixed(1)}`).join(' ')
  return (
    <figure className="rounded-2xl bg-background px-4 py-3">
      <figcaption className="flex items-baseline justify-between text-[12.5px]">
        <b className="font-medium">{label}</b>
        <span className="font-mono text-muted-foreground">{now}</span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${now}`} className="ludicrous-chart mt-2 w-full">
        <polyline points={line} />
      </svg>
    </figure>
  )
}

function History({ history, tier }: { history: LudicrousMinute[]; tier: number }): ReactNode {
  const last = history.at(-1)!
  return (
    <section aria-label="History" className="grid gap-3 sm:grid-cols-2">
      <Chart label="Agents running" now={`${last.running} of ${tier}`} points={history.map((minute) => minute.running)} most={tier} />
      <Chart label="Agents spawned" now={String(last.spawned)} points={history.map((minute) => minute.spawned)} most={Math.max(...history.map((minute) => minute.spawned))} />
    </section>
  )
}
