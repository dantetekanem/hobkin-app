/**
 * The TLAPS proof as the math view tells it (_specs/050-tla-proofs A10, A11): each step with its status, backend and
 * time, nested by its level; the note under the tree, with a failed step's goal and what it knew; and the box that says
 * what each result shows and what it does not. A step counts as proved only when `tlapm` ran with `--strict`, since
 * without it `tlapm` can call a step proved while its proof is missing. Pure, so the tests run it with Node alone.
 */
import type { ProofDefinition, ProofObligation, ProofRun } from '#shared/protocol/proofs.ts'

type Proof = NonNullable<ProofRun['proof']>

/** `unsure`: proved by a run without --strict, so it does not count. */
export type ProofTone = 'ok' | 'bad' | 'warn' | 'quiet' | 'unsure'

export interface ProofRow {
  id: string
  label: string
  status: ProofObligation['status']
  /** Levels below the top one. */
  indent: number
  tone: ProofTone
  mark: string
  /** How it went, in a few words: "Zenon 0.3 s", "1 step fails", "waits". */
  how: string
  counted: boolean
}

const MARK: Record<ProofObligation['status'], string> = { proved: '✓', failed: '!', omitted: '–', missing: '?', pending: '·' }
const HOW: Record<Exclude<ProofObligation['status'], 'proved'>, string> = { failed: 'failed', omitted: 'omitted', missing: 'no proof', pending: 'waits' }
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

function howProved(step: ProofObligation, hasSteps: boolean): string {
  if (step.backend && step.seconds != null) return `${step.backend} ${step.seconds.toFixed(1)} s`
  if (step.backend) return step.backend
  return hasSteps ? 'by its steps' : 'proved'
}

export function proofRows(proof: Proof): ProofRow[] {
  const steps = proof.obligations
  const top = Math.min(...steps.map((step) => step.depth))
  return steps.map((step, index) => {
    const below: ProofObligation[] = []
    for (const next of steps.slice(index + 1)) {
      if (next.depth <= step.depth) break
      below.push(next)
    }
    const failing = below.filter((entry) => entry.status === 'failed').length
    const base = { id: step.id, label: step.label, status: step.status, indent: step.depth - top, counted: proof.strict && step.status === 'proved' }
    if (failing > 0) return { ...base, tone: 'bad', mark: MARK.failed, how: `${plural(failing, 'step', 'steps')} ${failing === 1 ? 'fails' : 'fail'}` }
    if (step.status === 'proved') return { ...base, tone: proof.strict ? 'ok' : 'unsure', mark: MARK.proved, how: howProved(step, below.length > 0) }
    const tone: ProofTone = step.status === 'failed' ? 'bad' : step.status === 'pending' ? 'quiet' : 'warn'
    return { ...base, tone, mark: MARK[step.status], how: HOW[step.status] }
  })
}

function tally(proof: Proof) {
  const of = (status: ProofObligation['status']) => proof.obligations.filter((step) => step.status === status).length
  return { all: proof.obligations.length, proved: of('proved'), failed: of('failed'), pending: of('pending'), omitted: of('omitted'), missing: of('missing') }
}

/** The tree's count, beside its title: "14 proved · 1 failed · 2 waiting", or "17 of 17 proved". */
export function proofSummary(proof: Proof): string {
  if (!proof.strict) return 'Ran without --strict · none counted'
  const { all, proved, failed, pending, omitted, missing } = tally(proof)
  if (all > 0 && proved === all) return `${all} of ${all} proved`
  return [`${proved} proved`, failed && `${failed} failed`, pending && `${pending} waiting`, omitted && `${omitted} omitted`, missing && `${missing} missing`].filter(Boolean).join(' · ')
}

/** A definition's body: what follows its ≜, or what follows THEOREM when it has none, on one line. */
function statementOf(lines: readonly string[]): string {
  const text = lines.join(' ').replace(/\s+/g, ' ').trim()
  const at = text.indexOf('≜')
  return at >= 0 ? text.slice(at + 1).trim() : text.replace(/^THEOREM\s+/, '')
}

export interface Theorem {
  name: string
  lines: string[]
  statement: string
}

/** The spec's theorem: the first definition written as one. */
export function theoremOf(definitions: readonly ProofDefinition[]): Theorem | null {
  const found = definitions.find((definition) => /^\s*(THEOREM|LEMMA)\b/.test(definition.lines[0] ?? ''))
  return found ? { name: found.name, lines: found.lines, statement: statementOf(found.lines) } : null
}

/** The first definition a step's label names, such as `YoloMerge` in "CASE YoloMerge(i)". */
export function relatedDefinition(label: string, names: readonly string[]): string | null {
  const known = new Set(names)
  const words = label.replace(/"(?:[^"\\]|\\.)*"/g, '').match(/[A-Za-z_]\w*/g) ?? []
  return words.find((word) => known.has(word)) ?? null
}

export interface ProofNote {
  tone: 'ok' | 'bad' | 'warn' | 'plain'
  title: string
  math: string
  goal?: string
  known?: string[]
  words: string
}

/**
 * The note under the tree: the step the user picked, else the first that failed, else what the whole proof shows. A
 * proof run without --strict says so first, since none of its steps counts.
 */
export function proofNote(run: Pick<ProofRun, 'outcome' | 'broken' | 'traceLength' | 'model' | 'definitions'>, proof: Proof, picked: string | null): ProofNote {
  const theorem = theoremOf(run.definitions)
  const statement = theorem?.statement ?? ''
  const chosen = proof.obligations.find((step) => step.id === picked) ?? (proof.strict ? proof.obligations.find((step) => step.status === 'failed') : undefined)
  if (chosen?.status === 'failed') {
    const echo = run.outcome === 'broken' && run.broken ? `The model check broke ${run.broken} too${run.traceLength ? `, in a ${run.traceLength}-step example` : ''}.` : ''
    return {
      tone: 'bad',
      title: `${chosen.id} could not be proved`,
      math: chosen.label,
      ...(chosen.goal ? { goal: chosen.goal } : {}),
      ...(chosen.known ? { known: chosen.known } : {}),
      words: [`What it knew was not enough to show its goal.`, echo].filter(Boolean).join(' '),
    }
  }
  if (!proof.strict) {
    return { tone: 'warn', title: 'Not counted: the proof ran without --strict', math: 'tlapm --strict', words: 'Without --strict, tlapm can call a step proved while its proof is missing, so hobkin counts none of these.' }
  }
  if (chosen && picked) {
    if (chosen.status === 'proved') return { tone: 'plain', title: `${chosen.id} is proved`, math: chosen.label, words: chosen.backend ? `${chosen.backend} proved it${chosen.seconds != null ? ` in ${chosen.seconds.toFixed(1)} s` : ''}.` : 'Proved by the steps under it.' }
    if (chosen.status === 'pending') return { tone: 'plain', title: `${chosen.id} waits`, math: chosen.label, words: 'TLAPS has not checked it yet.' }
    return { tone: 'warn', title: `${chosen.id} has no proof yet`, math: chosen.label, words: 'A step left OMITTED or without a proof leaves the theorem unproved.' }
  }
  const { all, proved, pending, omitted, missing } = tally(proof)
  if (all > 0 && proved === all) {
    return { tone: 'ok', title: 'Proved for every size', math: statement, words: `Not just ${run.model ?? 'the small world the model check tried'}: any size. Checked with --strict, so no step was skipped.` }
  }
  if (pending > 0) return { tone: 'plain', title: 'Proving', math: statement, words: 'TLAPS is still checking its steps.' }
  return { tone: 'warn', title: 'Not proved yet', math: statement, words: `${plural(omitted + missing, 'step has', 'steps have')} no proof yet, so the theorem is not proved.` }
}

export interface ScopeRow {
  what: string
  says: string
  tone: 'text' | 'ok' | 'bad' | 'warn' | 'muted'
}

function modelCheckSays(run: ProofRun): ScopeRow {
  const world = run.model ? `a small world: ${run.model}` : 'the small world its cfg sets'
  const what = 'Model check'
  switch (run.outcome) {
    case 'broken':
      return { what, says: `Tried every state of ${world}, and found ${run.traceLength ? `a ${run.traceLength}-step example` : 'a state'} that breaks ${run.broken ?? 'a rule'}.`, tone: 'bad' }
    case 'holds':
      return { what, says: `Tried every state of ${world}, and every rule held. A bigger world is not checked.`, tone: 'ok' }
    case 'checking':
      return { what, says: `Is trying every state of ${world}. It finds bugs fast, with an example.`, tone: 'text' }
    case 'stopped':
      return { what, says: 'Was stopped before it finished, so it shows nothing yet.', tone: 'muted' }
    default:
      return { what, says: `Did not finish${run.message ? `: ${run.message.replace(/\.$/, '')}` : ''}, so it shows nothing yet.`, tone: 'muted' }
  }
}

function proofSays(run: ProofRun): ScopeRow {
  const what = 'Proof'
  if (!run.proof || run.proof.obligations.length === 0) return { what, says: 'None was written. A proof would hold for every size, not just this world.', tone: 'muted' }
  if (!run.proof.strict) return { what, says: 'Ran without --strict, so it does not count.', tone: 'warn' }
  const { all, proved, failed, pending } = tally(run.proof)
  if (proved === all) return { what, says: 'Holds for every size. Done.', tone: 'ok' }
  if (failed > 0) return { what, says: 'Holds for every size once it passes. It does not pass yet.', tone: 'bad' }
  if (pending > 0) return { what, says: 'Is being checked. Once it passes, it holds for every size.', tone: 'text' }
  return { what, says: 'Has steps with no proof yet, so it proves nothing yet.', tone: 'warn' }
}

/** "What this shows, and what it does not": a model check is bounded, a proof is not, and both are about the model. */
export function scopeRows(run: ProofRun): ScopeRow[] {
  return [
    modelCheckSays(run),
    proofSays(run),
    { what: 'The code', says: 'Both are about the model, not the code. Only its code: comments and the review tie the model to the code.', tone: 'warn' },
  ]
}
