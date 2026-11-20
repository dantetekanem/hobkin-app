import type { FitViewOptions } from '@xyflow/react'
import { ChevronLeft, ChevronRight, Code, Search } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useStill } from '@/app/still.ts'
import { Segmented } from '@/features/work/parts.tsx'
import { cn } from '@/lib/utils.ts'
import type { ProofRun } from '#shared/protocol/proofs.ts'
import { TlaLine } from '../math/TlaLine.tsx'
import { GraphCanvas, type NodeMarks } from './canvas.tsx'
import { placePath, placePicture, type Spacing } from './layout.ts'
import { aroundPicture, defaultLens, groupedPicture, pathPicture, stateGraph, type Picture, type PictureNode, type StateGraph } from './model.ts'
import { findStates, parseQuery } from './search.ts'
import { stateFacts, stepWindow, type Cell, type Picked, type StateFacts, type Verdict } from './step.ts'
import { count, formatValue, lensValue, lensesOf } from './values.ts'

type View = 'path' | 'around' | 'grouped'

const VIEWS: readonly { value: View; label: string }[] = [
  { value: 'path', label: 'The counterexample' },
  { value: 'around', label: 'Around it' },
  { value: 'grouped', label: 'By a variable' },
]
const AROUND: Spacing = { nodesep: 14, ranksep: 56 }
/** Groups stand far enough apart for the longest action name between two of them, in 11px mono. */
const groupSpacing = (picture: Picture): Spacing => {
  const longest = Math.max(0, ...picture.edges.filter((edge) => !edge.loop).flatMap((edge) => edge.labels.map((label) => label.text.length)))
  return { nodesep: 104, ranksep: Math.min(280, Math.max(100, Math.ceil(longest * 6.6) + 32)) }
}
const FIT: Record<View, FitViewOptions> = {
  path: { padding: 0.08, minZoom: 0.6, maxZoom: 1.15 },
  around: { padding: 0.08, minZoom: 0.2, maxZoom: 1.1 },
  grouped: { padding: 0.06, minZoom: 0.35, maxZoom: 1.1 },
}
const EMPTY: Picture = { nodes: [], edges: [], note: '' }

/** Where the view starts: the state where the run broke, else a state the model starts in. */
function firstPick(graph: StateGraph): Picked | null {
  if (graph.path.length > 0) return { id: graph.path.at(-1)!, step: graph.path.length - 1 }
  const start = [...graph.nodes.values()].find((node) => node.initial) ?? graph.nodes.values().next().value
  return start ? { id: start.id } : null
}

/** The step of the counterexample a state is at, or leaves from, for stepping on from a state off it. */
function anchorStep(graph: StateGraph, picked: Picked): number {
  if (picked.step != null) return picked.step
  const on = graph.path.indexOf(picked.id)
  if (on >= 0) return on
  const from = (graph.into.get(picked.id) ?? []).map((move) => graph.path.indexOf(move.from)).filter((at) => at >= 0)
  return from.length > 0 ? Math.min(...from) : 0
}

/**
 * The visual proof (_specs/050-tla-proofs, screen 2): the state graph in three views, a step bar through the
 * counterexample, and the selected state beside it with its variables and the rule read at that state. It works with
 * TLC's dump of the graph, with the counterexample alone when there is no dump, and with no counterexample when the
 * model holds, where it starts grouped by a variable. Left and Right step through the counterexample while the graph
 * or its step bar has focus.
 */
export function GraphView({ run, onCode = null }: { run: ProofRun; onCode?: ((where: string) => void) | null }) {
  const still = useStill()
  const { graph: dump, trace, outcome, stats, actions } = run
  const graph = useMemo(() => stateGraph({ graph: dump, trace, outcome, stats }), [dump, trace, outcome, stats])
  const hasPath = graph.path.length > 0
  const lenses = useMemo(() => {
    const first = graph.nodes.values().next().value
    return first ? lensesOf(first.vars) : []
  }, [graph])

  const [chosenView, setChosenView] = useState<View | null>(null)
  const view: View = chosenView === 'path' && !hasPath ? 'grouped' : (chosenView ?? (hasPath ? 'path' : 'grouped'))
  const [lensLabel, setLensLabel] = useState<string | null>(null)
  const lens = useMemo(() => lenses.find((entry) => entry.label === lensLabel) ?? defaultLens(graph), [lenses, lensLabel, graph])
  const [chosen, setChosen] = useState<Picked | null>(null)
  const picked = chosen && graph.nodes.has(chosen.id) ? chosen : firstPick(graph)

  const [query, setQuery] = useState('')
  const parsed = useMemo(() => parseQuery(query, lenses), [query, lenses])
  const found = useMemo(() => (parsed?.ok ? new Set(findStates(graph, parsed.query)) : null), [graph, parsed])
  const matchText = parsed?.ok ? parsed.query.text : ''
  const match = useMemo(() => (found ? { ids: found, text: matchText } : undefined), [found, matchText])

  // A model still being checked has every action at 0 so far, which says nothing yet.
  const silent = outcome === 'checking' ? undefined : actions
  const picture = useMemo(() => {
    if (view === 'path') return pathPicture(graph)
    if (view === 'around') return aroundPicture(graph, match ? { match } : {})
    return lens ? groupedPicture(graph, lens, silent) : EMPTY
  }, [view, graph, match, lens, silent])
  const positions = useMemo(() => (view === 'path' ? placePath(picture) : placePicture(picture, view === 'around' ? AROUND : groupSpacing(picture))), [picture, view])

  const marks = useCallback(
    (node: PictureNode): NodeMarks => {
      const selected = picked != null && (node.look === 'group' ? node.states.includes(picked.id) : node.id === picked.id)
      const hit = found != null && node.states.some((id) => found.has(id))
      return { selected, dim: found != null && node.look !== 'ghost' && !hit && !selected, match: hit }
    },
    [picked, found],
  )
  const focus = picked ? (view === 'grouped' ? (picture.nodes.find((node) => node.look === 'group' && node.states.includes(picked.id))?.id ?? null) : picked.id) : null

  const pick = (node: PictureNode) => {
    if (node.look === 'ghost') return
    if (node.look !== 'group') return setChosen(node.step != null ? { id: node.id, step: node.step } : { id: node.id })
    if (picked && node.states.includes(picked.id)) return
    setChosen(node.step != null ? { id: graph.path[node.step]!, step: node.step } : { id: node.states[0]! })
  }
  const last = graph.path.length - 1
  const step = picked && hasPath ? (picked.step ?? (graph.path.indexOf(picked.id) >= 0 ? graph.path.indexOf(picked.id) : null)) : null
  const go = (delta: number) => {
    if (!hasPath || !picked) return
    // From a state off the path, Next goes on from the step it left, and Previous back to that step.
    const anchor = anchorStep(graph, picked)
    const next = Math.max(0, Math.min(last, step != null ? step + delta : delta > 0 ? anchor + 1 : anchor))
    setChosen({ id: graph.path[next]!, step: next })
  }

  const area = useRef<HTMLDivElement | null>(null)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !hasPath) return
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    go(delta)
  }

  const facts = picked ? stateFacts(run, graph, picked) : null
  const example = lens && picked ? `${lens.label} = ${formatValue(lensValue(graph.nodes.get(picked.id)!.vars, lens) ?? { kind: 'raw', text: '…' })}` : 'variable = value'
  const note = parsed && !parsed.ok ? parsed.reason : found?.size === 0 ? `No state has ${matchText}.` : picture.note
  const options = hasPath ? VIEWS : VIEWS.filter((option) => option.value !== 'path')

  return (
    <div className="pf-graph @container" data-still={still || undefined}>
      <div className="grid gap-5 @min-[900px]:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label="State graph" className="flex min-w-0 flex-col gap-3.5 rounded-[20px] border border-border bg-surface px-[18px] pt-4 pb-[18px]">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
            <Segmented label="What the graph shows" name="proof-graph-view" value={view} options={options} onChoose={setChosenView} />
            <label className="flex h-9 min-w-[220px] flex-[1_1_220px] items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:border-border-strong">
              <Search aria-hidden className="size-[15px] shrink-0 text-muted-foreground" />
              <span className="sr-only">Find states where</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={example}
                spellCheck={false}
                autoComplete="off"
                disabled={graph.nodes.size === 0}
                className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70"
              />
              <span className="w-[80px] shrink-0 truncate text-right text-[12px] text-muted-foreground tabular-nums">
                {found ? (found.size === 0 ? 'No state' : `${count(found.size)} ${found.size === 1 ? 'state' : 'states'}`) : ''}
              </span>
            </label>
          </div>

          <div ref={area} onKeyDown={onKeyDown} className="flex flex-col gap-3.5">
            <div
              tabIndex={0}
              role="group"
              aria-label={hasPath ? 'State graph. Left and Right step through the counterexample.' : 'State graph'}
              onPointerDown={() => area.current?.querySelector<HTMLElement>('[role="group"]')?.focus({ preventScroll: true })}
              className="relative h-[420px] overflow-hidden rounded-2xl border border-border bg-[var(--pf-canvas)] outline-offset-2"
            >
              {picture.nodes.length > 0 ? (
                <GraphCanvas key={`${view}:${lens?.label ?? ''}:${view === 'around' ? matchText : ''}`} picture={picture} positions={positions} marks={marks} focus={focus} fit={FIT[view]} still={still} onPick={pick} />
              ) : (
                <p className="grid h-full place-items-center px-8 text-center text-[13px] text-muted-foreground">{emptyWords(run)}</p>
              )}
            </div>
            <div className="-mt-1 flex h-9 items-start gap-2.5">
              {view === 'grouped' && lenses.length > 0 ? (
                <label className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[11.5px] text-muted-foreground">Group by</span>
                  <select
                    value={lens?.label ?? ''}
                    onChange={(event) => setLensLabel(event.target.value)}
                    className="h-7 w-[132px] truncate rounded-lg border border-border bg-background px-2 font-mono text-[12px] text-foreground"
                  >
                    {lenses.map((entry) => (
                      <option key={entry.label} value={entry.label}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <p role={parsed && !parsed.ok ? 'status' : undefined} title={note} className={cn('line-clamp-2 min-w-0 text-[11.5px] leading-[18px]', parsed && !parsed.ok ? 'text-warn-fg' : 'text-muted-foreground')}>
                {note}
              </p>
            </div>
            <StepBar run={run} graph={graph} step={step} onStep={(next) => setChosen({ id: graph.path[next]!, step: next })} onMove={go} />
          </div>
        </section>

        <aside aria-label="The selected state" className="flex min-w-0 flex-col gap-3.5">
          {facts ? (
            <>
              <Inspector facts={facts} onCode={onCode} />
              <VerdictBox verdict={facts.verdict} />
            </>
          ) : (
            <section className="rounded-[20px] border border-border bg-surface px-5 py-[18px] text-[13px] text-muted-foreground">No state to show yet.</section>
          )}
        </aside>
      </div>
    </div>
  )
}

function emptyWords(run: ProofRun): string {
  if (run.outcome === 'checking') return 'TLC dumps the state graph when the check ends.'
  return 'No state graph to draw: TLC dumps one only for a model of at most 50,000 states, and this run has no counterexample.'
}

/** The counterexample, step by step: six at most, with Previous and Next held still at the ends. */
function StepBar({ run, graph, step, onStep, onMove }: { run: ProofRun; graph: StateGraph; step: number | null; onStep: (step: number) => void; onMove: (delta: number) => void }) {
  const length = graph.path.length
  const [from, setFrom] = useState(0)
  const shown = stepWindow(length, step ?? 0, from)
  // The window is remembered between renders, so walking back inside it leaves it where it is.
  if (length > 0 && shown.from !== from) setFrom(shown.from)
  if (length === 0) {
    return (
      <p className="flex h-11 items-center text-[13px] text-muted-foreground">
        {run.outcome === 'holds' ? 'The model holds, so there is no counterexample to step through. Pick a state or a group in the graph.' : 'No counterexample to step through.'}
      </p>
    )
  }
  const steps = Array.from({ length: shown.to - shown.from }, (_, index) => shown.from + index)
  const arrow = 'grid size-11 shrink-0 place-items-center rounded-xl border border-border text-foreground transition-colors hover:bg-tone-2 disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div className="flex items-center gap-2.5">
      <button type="button" aria-label="Previous step" className={arrow} disabled={step === 0} onClick={() => onMove(-1)}>
        <ChevronLeft aria-hidden className="size-4" />
      </button>
      <ol aria-label="The counterexample, step by step" className="grid min-w-0 flex-1 gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((index) => {
          const current = index === step
          const breaks = graph.broken && index === length - 1
          const action = index === 0 ? 'Init' : (run.trace?.[index]?.action ?? graph.pathMoves[index - 1]!.action)
          return (
            <li key={index} className="min-w-0">
              <button
                type="button"
                aria-current={current ? 'step' : undefined}
                aria-label={`Step ${index + 1}, ${action}${breaks ? ', where it breaks' : ''}`}
                onClick={() => onStep(index)}
                title={action}
                className={cn(
                  'flex h-11 w-full flex-col items-start justify-center gap-px rounded-xl border px-1.5 text-left transition-colors',
                  current ? (breaks ? 'border-bad-fg bg-bad/15' : 'border-primary bg-primary/25') : 'border-border hover:bg-tone-2',
                )}
              >
                <span className={cn('flex w-full items-center gap-1 truncate text-[10.5px] leading-tight tabular-nums', breaks ? 'text-bad-fg' : 'text-muted-foreground')}>
                  {breaks ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-bad-fg" /> : null}
                  Step {index + 1}
                </span>
                <span className="w-full truncate font-mono text-[11px] leading-tight font-medium">{action}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <button type="button" aria-label="Next step" className={arrow} disabled={step === length - 1} onClick={() => onMove(1)}>
        <ChevronRight aria-hidden className="size-4" />
      </button>
    </div>
  )
}

function cellClass(cell: Cell): string {
  if (cell.breaks) return 'bg-bad/15 font-semibold text-bad-fg'
  if (cell.changed) return 'bg-primary/25 font-semibold'
  return cell.quiet ? 'bg-tone-2 text-muted-foreground' : 'bg-tone-2'
}

/** The selected state: where it is, what led to it and its code, a line of story, and its variables. */
function Inspector({ facts, onCode }: { facts: StateFacts; onCode: ((where: string) => void) | null }) {
  // A key the counterexample never moves needs less room, which leaves more for the values that change.
  const quiet = facts.columns.map((_, index) => facts.columns.length > 1 && facts.rows.every((row) => row.cells.length > 1 && row.cells[index]?.quiet))
  return (
    <section className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface px-5 py-[18px]">
      <div className="flex items-baseline justify-between gap-2.5">
        <h2 aria-live="polite" className="shrink-0 font-heading text-[16px] font-semibold">
          {facts.title}
        </h2>
        <span title={facts.action} className="min-w-0 truncate font-mono text-[12px] text-muted-foreground">
          {facts.action}
        </span>
      </div>
      <p title={facts.story} className="line-clamp-3 h-[60px] text-[13.5px] leading-5">
        {facts.story}
      </p>
      <div className="-mx-2.5 flex h-9 items-center">
        {facts.code && onCode ? (
          <button type="button" onClick={() => onCode(facts.code!)} className="flex h-9 min-w-0 items-center gap-2 rounded-[10px] px-2.5 text-sun-fg hover:bg-tone-2">
            <Code aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate font-mono text-[12px]">{facts.code}</span>
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-2 px-2.5 text-muted-foreground">
            <Code aria-hidden className="size-3.5 shrink-0" />
            <span title={facts.code} className="truncate font-mono text-[12px] select-text">
              {facts.code ?? 'The spec names no code for this action.'}
            </span>
          </span>
        )}
      </div>
      <table className="w-full table-fixed border-separate border-spacing-y-1 text-[12.5px]">
        <caption className="sr-only">Variables in this state</caption>
        <colgroup>
          <col className="w-[80px]" />
          {facts.columns.map((column, index) => (
            <col key={column} className={quiet[index] ? 'w-[84px]' : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-left text-[11.5px] text-muted-foreground">
            <th scope="col" className="px-2 font-medium">
              Variable
            </th>
            {facts.columns.map((column) => (
              <th key={column} scope="col" className="truncate px-2 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {facts.rows.map((row) => (
            <tr key={row.name}>
              <th scope="row" title={row.name} className="truncate rounded-l-lg bg-tone-2 px-2 py-[7px] text-left font-mono font-medium">
                {row.name}
              </th>
              {row.cells.map((cell, index) => (
                <td
                  key={index}
                  colSpan={cell.span}
                  title={cell.was != null ? `${cell.text}, was ${cell.was}` : cell.text}
                  className={cn('truncate px-2 py-[7px] font-mono', index === row.cells.length - 1 && 'rounded-r-lg', cellClass(cell))}
                >
                  {cell.text}
                  {cell.was != null ? <span className="text-[11px] font-normal text-muted-foreground">{`  was ${cell.was}`}</span> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

const VERDICT_TONE: Record<Verdict['tone'], string> = {
  bad: 'border-bad-fg bg-bad/15',
  ok: 'border-ok-fg bg-ok/15',
  plain: 'border-border bg-surface',
}

/** The rule read at the selected state, in a box of one height whatever it says. */
function VerdictBox({ verdict }: { verdict: Verdict }) {
  return (
    <section aria-label="The rule at this state" className={cn('flex h-[168px] flex-col gap-2 rounded-[20px] border px-[18px] py-4', VERDICT_TONE[verdict.tone])}>
      <h2 className="font-heading text-[14px] font-semibold">{verdict.title}</h2>
      <p title={verdict.formula} className="pf-tla line-clamp-2 text-[12.5px] leading-normal whitespace-pre-wrap select-text">
        <TlaLine text={verdict.formula} />
      </p>
      <p title={verdict.words} className="line-clamp-2 text-[12.5px] leading-[1.45] text-muted-foreground">
        {verdict.words}
      </p>
    </section>
  )
}
