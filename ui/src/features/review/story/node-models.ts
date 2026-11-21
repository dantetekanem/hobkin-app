/**
 * The TLA+ model checks a review shows (050-tla-proofs in Change Review; the user, 2026-11-20: "I want to see TLA+
 * running in the UI we worked, there in review."): which hobkin change a review is of, which files are models, what
 * TLC said of each at the reviewed head for a node's card, and a row for each model in the panel. A pull request
 * has no hobkin item, so it shows none. Pure.
 */
import type { ProofRunSummary, ProofsState } from '#shared/protocol/proofs.ts'
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { Review, ReviewFile, ReviewNode } from '#shared/review/types.ts'
import { runsForItem, sameHead, specFile } from '../../proofs/proof-match.ts'
import { namesOf, neverFired, stepsToBreak, type Tone } from '../../proofs/run/run-view.ts'

/** A hobkin change as reviewed: its project, its item, and the head the review was made at. */
export interface ReviewedChange {
  project: string
  item: string
  head: string
}

/** The hobkin change a review is of, at the head it was reviewed at. Null for a pull request or a sample. */
export function reviewedChange(review: Pick<Review, 'id'> & { change: Pick<Review['change'], 'head'> }): ReviewedChange | null {
  const target = targetOfReviewId(review.id)
  if (target?.kind !== 'change' || !review.change.head) return null
  return { project: target.slug, item: target.item, head: review.change.head }
}

/**
 * The model a file is: a `.tla` spec itself, or the spec a `.cfg` under a `tla` folder configures, beside it, as in
 * `_specs/tla/<area>/<Machine>.cfg`. Null for any other file.
 */
export function modelOf(path: string | null | undefined): string | null {
  if (!path) return null
  if (path.endsWith('.tla')) return path
  return /(?:^|\/)tla\/(?:[^/]+\/)*[^/]+\.cfg$/.test(path) ? path.replace(/\.cfg$/, '.tla') : null
}

/** The models of the nodes in focus, each once, in their order: from each node's file, or its path when it has no lines. */
export function modelsIn(nodes: readonly Pick<ReviewNode, 'anchors' | 'subtitle'>[], files: readonly Pick<ReviewFile, 'id' | 'path'>[]): string[] {
  const paths = nodes.map((node) => files.find((file) => file.id === node.anchors[0]?.fileId)?.path ?? node.subtitle)
  return [...new Set(paths.map(modelOf).filter((spec): spec is string => spec != null))]
}

/** The models the change adds or edits. A file it only shows, or deletes, is not one of its models. */
export function changedModels(files: readonly Pick<ReviewFile, 'path' | 'status'>[]): string[] {
  const edited = files.filter((file) => file.status === 'added' || file.status === 'modified' || file.status === 'renamed')
  return [...new Set(edited.map((file) => modelOf(file.path)).filter((spec): spec is string => spec != null))]
}

const count = (value: number) => value.toLocaleString('en-US')
const plural = (value: number, word: string) => `${count(value)} ${word}${value === 1 ? '' : 's'}`

/** The newest run of one model for the change at the reviewed head. A check of another commit never stands in for it. */
function runAt(proofs: ProofsState | null, change: ReviewedChange, spec: string): ProofRunSummary | null {
  const mine = (proofs?.runs ?? []).filter((run) => run.project === change.project && run.item === change.item && run.spec === spec && sameHead(run.head, change.head))
  return mine.sort((left, right) => Date.parse(right.started) - Date.parse(left.started))[0] ?? null
}

function saidOf(run: ProofRunSummary): { said: string; tone: Tone } {
  switch (run.outcome) {
    case 'checking':
      return { said: run.stats.distinct > 0 ? `checking… ${plural(run.stats.distinct, 'state')}` : 'checking…', tone: 'live' }
    case 'holds': {
      const missed = neverFired(run)
      if (missed.length) return { said: `holds, but ${namesOf(missed)} never ran`, tone: 'warn' }
      return { said: `holds in ${plural(run.stats.distinct, 'state')}`, tone: 'ok' }
    }
    case 'broken':
      return { said: `${run.broken ?? 'a rule'} breaks in ${plural(stepsToBreak(run), 'step')}`, tone: 'bad' }
    case 'stopped':
      return { said: 'stopped before the end', tone: 'quiet' }
    case 'error':
      return { said: 'could not run', tone: 'bad' }
  }
}

/** One model on a node's card: what TLC said of it at the reviewed head, and the run that says so. */
export interface ModelLine {
  spec: string
  /** The run it opens. Null when nothing checked it at this commit. */
  run: string | null
  text: string
  tone: Tone
}

/**
 * What TLC said of each model in focus at the reviewed head: "TLC: holds in 7 states", "TLC: NoRepost breaks in 5
 * steps", "TLC: checking… 1,204 states" while it runs, or "TLC: not checked at this commit". With more than one, each
 * names its file.
 */
export function modelLines(proofs: ProofsState | null, change: ReviewedChange, specs: readonly string[]): ModelLine[] {
  const named = specs.length > 1
  return specs.map((spec) => {
    const run = runAt(proofs, change, spec)
    const { said, tone } = run ? saidOf(run) : { said: 'not checked at this commit', tone: 'quiet' as const }
    return { spec, run: run?.id ?? null, text: `${named ? `TLC · ${specFile(spec)}` : 'TLC'}: ${said}`, tone }
  })
}

/** One model in the panel: its file, what TLC said of it, and the run it opens. */
export interface ModelRow {
  spec: string
  file: string
  /** "holds · 15 states", "NoRepost breaks · 5 steps", "checking · 1,204 states", "not checked at this commit". */
  said: string
  tone: Tone
  /** Null when nothing checked it, and the row opens nothing. */
  run: string | null
}

/** A run in a panel row's words: the result, then the states or the steps to the break. */
function rowSaid(run: ProofRunSummary): { said: string; tone: Tone } {
  const proof = run.steps.find((step) => step.id === 'prove')?.state
  const proved = proof === 'done' ? ' · proved for every size' : proof === 'failed' ? ' · proof fails' : ''
  switch (run.outcome) {
    case 'checking':
      return { said: `checking · ${plural(run.stats.distinct, 'state')}`, tone: 'live' }
    case 'holds': {
      const missed = neverFired(run)
      if (missed.length) return { said: `holds · ${namesOf(missed)} never ran`, tone: 'warn' }
      return { said: `holds · ${plural(run.stats.distinct, 'state')}${proved}`, tone: proof === 'failed' ? 'bad' : 'ok' }
    }
    case 'broken':
      return { said: `${run.broken ?? 'a rule'} breaks · ${plural(stepsToBreak(run), 'step')}${proved}`, tone: 'bad' }
    case 'stopped':
      return { said: 'stopped before the end', tone: 'quiet' }
    case 'error':
      return { said: 'could not run', tone: 'bad' }
  }
}

/**
 * The panel's TLA+ models, one row each, ordered by file so a row keeps its place as runs come and go: each model the
 * change edits and each model hobkin checked for the item, with what TLC said of it at the reviewed head. A check of an
 * older commit still opens, and says it is older. A model nothing checked has a row too, so a check that starts takes
 * its place.
 */
export function reviewModelRows(proofs: ProofsState | null, change: ReviewedChange, specs: readonly string[]): ModelRow[] {
  const mine = (proofs?.runs ?? []).filter((run) => run.project === change.project && run.item === change.item)
  const all = [...new Set([...specs, ...mine.map((run) => run.spec)])].sort()
  return all.map((spec) => {
    const file = specFile(spec)
    const run = runAt(proofs, change, spec)
    if (run) return { spec, file, run: run.id, ...rowSaid(run) }
    const older = runsForItem(proofs, change.project, change.item).find((candidate) => candidate.spec === spec)
    if (older) return { spec, file, run: older.id, said: 'checked at an older commit', tone: 'quiet' }
    return { spec, file, run: null, said: 'not checked at this commit', tone: 'quiet' }
  })
}
