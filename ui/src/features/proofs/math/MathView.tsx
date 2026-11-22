import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { Segmented } from '@/features/work/parts.tsx'
import { cn } from '@/lib/utils.ts'
import type { ProofDefinition, ProofRun } from '#shared/protocol/proofs.ts'
import { actionName } from '../graph/values.ts'
import { keepMath, useKept, type MathMode } from '../kept.ts'
import { foldRows, proofNote, proofRows, proofSummary, relatedDefinition, scopeRows, theoremOf, type ProofNote, type ProofRow, type ProofTone, type ScopeRow } from './proof-tree.ts'
import { TlaLine } from './TlaLine.tsx'
import './tla.css'

type Mode = MathMode

const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'math', label: 'Math' },
  { value: 'words', label: 'In words' },
  { value: 'both', label: 'Side by side' },
]

interface Tag {
  text: string
  tone: 'bad' | 'warn'
}

/** What a definition is to this run: the rule that broke, the action where the proof fails, an action that never fired. */
function tagsOf(run: ProofRun): Map<string, Tag> {
  const tags = new Map<string, Tag>()
  const names = run.definitions.map((definition) => definition.name)
  // While TLC still checks, every action is at 0 so far, which says nothing yet.
  if (run.outcome !== 'checking') {
    for (const action of run.actions) {
      if (action.count === 0) tags.set(action.name, { text: 'never fired', tone: 'warn' })
    }
  }
  if (run.proof?.strict) {
    for (const step of run.proof.obligations) {
      const about = step.status === 'failed' ? relatedDefinition(step.label, names) : null
      if (about) tags.set(about, { text: 'proof fails here', tone: 'bad' })
    }
  }
  if (run.broken) tags.set(run.broken, { text: 'broken', tone: 'bad' })
  return tags
}

/** The block picked first: where the proof fails, else the action that broke the rule. */
function firstBlock(run: ProofRun): string | null {
  const names = run.definitions.map((definition) => definition.name)
  const failed = run.proof?.obligations.find((step) => step.status === 'failed')
  const fromProof = failed ? relatedDefinition(failed.label, names) : null
  const last = run.trace?.at(-1)?.action
  const fromTrace = last && run.outcome === 'broken' ? actionName(last) : null
  return fromProof ?? (fromTrace && names.includes(fromTrace) ? fromTrace : null)
}

/**
 * The math (_specs/050-tla-proofs, screen 3): the spec set in Unicode TLA+ in three modes, Math, In words and Side by
 * side, in a scroll area of one height; the TLAPS tree, counted only when it ran with --strict, with the note under it
 * that holds a failed step's goal and what it knew; and the box that says what each result shows and what it does not.
 * Picking a block lights the proof's steps about it, and picking a step brings its block into view. The mode, block,
 * step and fold are kept for the run while the app is open (`kept.ts`).
 */
export function MathView({ run }: { run: ProofRun }) {
  const { mode, block: chosen, step, all } = useKept(run.id, 'math')
  const setMode = (next: Mode) => keepMath(run.id, { mode: next })
  const setChosen = (block: string | null) => keepMath(run.id, { block })
  const selected = chosen === undefined ? firstBlock(run) : chosen
  const tags = useMemo(() => tagsOf(run), [run])
  const spec = useRef<HTMLDivElement | null>(null)
  const parse = run.steps.find((entry) => entry.id === 'parse')
  const parseWords = parse?.note || (parse?.state === 'running' ? 'SANY is parsing it' : '')
  const hasBlocks = run.definitions.length > 0

  /** Brings a block into the spec's scroll area. Only that area moves: scrollIntoView would scroll the page too. */
  const reveal = (name: string | null) => {
    const area = spec.current
    const block = name && area ? area.querySelector<HTMLElement>(`[data-block="${CSS.escape(name)}"]`) : null
    if (!block || !area) return
    const top = block.offsetTop - area.offsetTop
    const outOfView = top < area.scrollTop || top + block.offsetHeight > area.scrollTop + area.clientHeight
    if (outOfView) area.scrollTo({ top: Math.max(0, top - 12) })
  }
  const show = (name: string | null) => {
    setChosen(name)
    reveal(name)
  }
  // The block picked first is in view once the spec first has blocks; a run still parsing has none yet.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || !hasBlocks) return
    opened.current = true
    reveal(selected)
    // Only the spec's arrival moves its scroll here; later picks move it themselves, through `show`.
  }, [hasBlocks])

  return (
    <div className="@container">
      <div className="grid gap-5 @min-[900px]:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="The spec" className="flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-border px-[18px] py-3">
            <span title={run.spec} className="min-w-0 truncate font-mono text-[13px] font-semibold">
              {run.spec}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{parseWords}</span>
            <Segmented label="How to read it" name="proof-math-mode" value={mode} options={MODES} onChoose={setMode} />
          </div>
          <div ref={spec} className="scroll-quiet relative h-[664px] overflow-auto px-2 pt-2.5 pb-4">
            {hasBlocks ? (
              run.definitions.map((definition) => (
                <Block
                  key={definition.name}
                  definition={definition}
                  mode={mode}
                  on={selected === definition.name}
                  tag={tags.get(definition.name)}
                  onPick={() => setChosen(selected === definition.name ? null : definition.name)}
                />
              ))
            ) : (
              <p className="px-3 py-2 text-[13px] text-muted-foreground">
                {parse?.state === 'failed' ? 'SANY could not parse the spec, so there is nothing to set.' : 'The spec shows here once SANY has parsed it.'}
              </p>
            )}
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-3.5">
          <ProofSection
            run={run}
            selected={selected}
            step={step}
            all={all}
            onAll={(next) => keepMath(run.id, { all: next })}
            onStep={(index, about) => {
              keepMath(run.id, { step: index })
              show(about)
            }}
          />
          <Scope rows={scopeRows(run)} />
        </aside>
      </div>
    </div>
  )
}

/**
 * One definition: its lines, its words, or both. It is picked with a click or Enter, and its text can still be
 * selected and copied, so a click that ends a selection does not pick it.
 */
function Block({ definition, mode, on, tag, onPick }: { definition: ProofDefinition; mode: Mode; on: boolean; tag: Tag | undefined; onPick: () => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onPick()
  }
  const tagged = tag ? <span className={cn('pl-3 font-sans text-[11.5px] font-semibold', tag.tone === 'bad' ? 'text-bad-fg' : 'text-warn-fg')}>{tag.text}</span> : null
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={on}
      aria-label={`${definition.name}, line ${definition.line}${tag ? `, ${tag.text}` : ''}`}
      data-block={definition.name}
      onClick={() => {
        if (window.getSelection()?.isCollapsed === false) return
        onPick()
      }}
      onKeyDown={onKeyDown}
      className={cn(
        'my-0.5 grid cursor-pointer gap-[18px] rounded-xl border px-3 py-2 text-left transition-colors select-text',
        on ? 'border-primary bg-primary/20' : 'border-transparent hover:bg-tone-2',
        mode === 'both' && 'grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]',
      )}
    >
      {mode !== 'words' ? (
        <div className="pf-tla scroll-quiet flex min-w-0 flex-col overflow-x-auto text-[13.5px] leading-[1.75] whitespace-pre">
          {definition.lines.map((line, index) => (
            <span key={index} className="block">
              <TlaLine text={line} aligned />
              {index === 0 && mode === 'math' ? tagged : null}
            </span>
          ))}
        </div>
      ) : null}
      {mode !== 'math' ? (
        <div className="flex min-w-0 flex-col gap-1 py-1">
          <span className="font-heading text-[13px] font-semibold">
            {definition.name}
            {tagged}
          </span>
          <span className={cn('text-[13.5px] leading-normal', !definition.words && 'text-muted-foreground')}>{definition.words ?? 'The spec gives no words for this one.'}</span>
        </div>
      ) : null}
    </div>
  )
}

const DOT: Record<ProofTone, string> = {
  ok: 'bg-ok-fg text-background',
  bad: 'bg-bad-fg text-background',
  warn: 'bg-warn-fg text-background',
  quiet: 'bg-tone-1 text-muted-foreground',
  // Proved by a run without --strict: hollow, since it does not count.
  unsure: 'border border-ok-fg text-ok-fg',
}

const NOTE_TONE: Record<ProofNote['tone'], string> = {
  bad: 'border-bad-fg bg-bad/15',
  ok: 'border-ok-fg bg-ok/15',
  warn: 'border-warn-fg bg-warn/15',
  plain: 'border-border bg-tone-2',
}

interface ProofSectionProps {
  run: ProofRun
  /** The spec's picked block, whose steps light up. */
  selected: string | null
  /** The picked step, by its place in the tree. */
  step: number | null
  /** Every step shows, the proved ones too. */
  all: boolean
  onAll: (all: boolean) => void
  /** A step was picked, with the definition it is about. */
  onStep: (index: number, about: string | null) => void
}

function ProofSection({ run, selected, step, all, onAll, onStep }: ProofSectionProps) {
  const theorem = theoremOf(run.definitions)
  const names = useMemo(() => run.definitions.map((definition) => definition.name), [run.definitions])
  const rows = useMemo(() => (run.proof ? proofRows(run.proof) : []), [run.proof])
  const folded = useMemo(() => foldRows(rows), [rows])
  const shown = all ? rows : folded
  const proof = run.proof
  return (
    <section aria-label="The proof" className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface px-5 py-[18px]">
      <div className="flex items-baseline justify-between gap-2.5">
        <h2 className="font-heading text-[16px] font-semibold">The proof</h2>
        <span className="truncate text-[12px] text-muted-foreground tabular-nums">{proof ? `TLAPS · ${proofSummary(proof)}` : 'TLAPS did not run'}</span>
      </div>
      {theorem ? (
        <p className="pf-tla rounded-xl bg-tone-2 px-3 py-2.5 text-[13.5px] leading-[1.75] break-words select-text">
          <TlaLine text={theorem.lines.join(' ')} />
        </p>
      ) : null}
      {proof && rows.length > 0 ? (
        <>
          <div className="-mb-1 flex h-6 items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
            <span className="tabular-nums">{shown.length === rows.length ? `${rows.length} steps` : `${shown.length} of ${rows.length} steps`}</span>
            {folded.length < rows.length ? (
              <button type="button" onClick={() => onAll(!all)} aria-expanded={all} className="rounded-md px-1.5 py-0.5 text-sun-fg hover:bg-tone-2">
                {all ? 'Fold the proved steps' : 'Show every step'}
              </button>
            ) : null}
          </div>
          <ol aria-label="Proof steps" className="scroll-quiet -mx-1 flex max-h-[456px] flex-col gap-0.5 overflow-y-auto px-1">
            {shown.map((row) => {
              const about = relatedDefinition(row.label, names)
              const lit = step === row.index || (selected != null && about === selected)
              return <ProofStep key={row.index} row={row} lit={lit} onPick={() => onStep(row.index, about)} />
            })}
          </ol>
          <NoteBox note={proofNote(run, proof, step)} />
        </>
      ) : (
        <p className="text-[13px] leading-snug text-muted-foreground">
          No proof was written for this spec, so TLAPS did not run. The model check covers the small world it was given; a proof would cover every size.
        </p>
      )}
    </section>
  )
}

function ProofStep({ row, lit, onPick }: { row: ProofRow; lit: boolean; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-label={`${row.text}: ${row.how}${row.counted || row.status !== 'proved' ? '' : ', not counted'}`}
        className={cn('grid min-h-9 w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] pr-2 text-left transition-colors', lit ? 'bg-primary/20' : 'hover:bg-tone-2')}
        style={{ paddingLeft: 8 + row.indent * 22 }}
      >
        <span aria-hidden className={cn('grid size-4 place-items-center rounded-full text-[10px] font-bold', DOT[row.tone])}>
          {row.mark}
        </span>
        <span title={row.text} className="pf-tla truncate text-[12px]">
          <TlaLine text={row.text} />
        </span>
        <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">{row.how}</span>
      </button>
    </li>
  )
}

/** The note under the tree, one height whatever it holds: a long list of what a step knew scrolls inside it. */
function NoteBox({ note }: { note: ProofNote }) {
  return (
    <div role="status" className={cn('scroll-quiet flex h-[156px] flex-col gap-1.5 overflow-y-auto rounded-[14px] border px-3.5 py-3 *:shrink-0', NOTE_TONE[note.tone])}>
      <p className="truncate font-heading text-[13px] font-semibold">{note.title}</p>
      {note.goal ? (
        <div className="pf-tla flex flex-col gap-0.5 text-[12px] leading-normal select-text">
          <p>
            <span className="font-sans text-muted-foreground">Goal: </span>
            <TlaLine text={note.goal} />
          </p>
          {note.known?.length ? (
            <p>
              <span className="font-sans text-muted-foreground">Known: </span>
              {note.known.map((fact, index) => (
                <span key={index}>
                  {index > 0 ? <span className="text-muted-foreground">, </span> : null}
                  <TlaLine text={fact} />
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : note.math ? (
        <p className="pf-tla line-clamp-2 text-[12px] leading-normal select-text">
          <TlaLine text={note.math} />
        </p>
      ) : null}
      <p className="text-[12.5px] leading-[1.45] text-muted-foreground">{note.words}</p>
    </div>
  )
}

const SCOPE_TONE: Record<ScopeRow['tone'], string> = { text: 'text-foreground', ok: 'text-ok-fg', bad: 'text-bad-fg', warn: 'text-warn-fg', muted: 'text-muted-foreground' }

function Scope({ rows }: { rows: ScopeRow[] }) {
  return (
    <section aria-label="What this does and does not show" className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-surface px-[18px] py-4">
      <h2 className="font-heading text-[14px] font-semibold">What this shows, and what it does not</h2>
      <ul className="flex flex-col gap-2 text-[12.5px] leading-[1.45]">
        {rows.map((row) => (
          <li key={row.what} className="grid grid-cols-[84px_minmax(0,1fr)] gap-2.5">
            <span className={cn('font-heading font-semibold', SCOPE_TONE[row.tone])}>{row.what}</span>
            <span>{row.says}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
