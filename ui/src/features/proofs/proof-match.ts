import type { ProofRunSummary, ProofsState } from '#shared/protocol/proofs.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import { namesOf, neverFired, stepsToBreak, type Tone } from './run/run-view.ts'

/**
 * Where proof runs show outside their own page (_specs/050-tla-proofs, screen 4): which runs belong to a finished card,
 * which run an agent's `hobkin proof check` started, what a project's models on main say, and the words for each.
 * Pure, so the matching is tested without a window.
 */

const count = (value: number) => value.toLocaleString('en-US')

/** The spec's file name: `specs/tla/WorkItem.tla` is WorkItem.tla. */
export const specFile = (spec: string) => spec.split('/').filter(Boolean).at(-1) ?? spec

/** Two commits are the same when one is the other's short form. */
export const sameHead = (left: string | null | undefined, right: string | null | undefined): boolean => Boolean(left && right && (left.startsWith(right) || right.startsWith(left)))

/** The newest run of each spec among `runs`, newest first. The slice comes newest first, so the first seen of a spec is its newest. */
function newestPerSpec(runs: readonly ProofRunSummary[]): ProofRunSummary[] {
  const seen = new Set<string>()
  return [...runs]
    .sort((left, right) => Date.parse(right.started) - Date.parse(left.started))
    .filter((run) => {
      if (seen.has(run.spec)) return false
      seen.add(run.spec)
      return true
    })
}

const ofProject = (run: ProofRunSummary, project: string) => run.project === project

/**
 * The runs for one work item, the newest of each spec. When the card shows a head, a spec's newest run at that head
 * stands for it, so a check of an older head never speaks for the change the user is about to merge.
 */
export function runsForItem(proofs: ProofsState | null, project: string, item: string, head: string | null = null): ProofRunSummary[] {
  const mine = (proofs?.runs ?? []).filter((run) => ofProject(run, project) && run.item === item)
  const atHead = head ? mine.filter((run) => sameHead(run.head, head)) : []
  return newestPerSpec(atHead.length ? atHead : mine)
}

/** A project's models on main: the newest run of each spec that no item ran, as hobkin's weekly recheck writes them. */
export const modelsOnMain = (proofs: ProofsState | null, project: string): ProofRunSummary[] => newestPerSpec((proofs?.runs ?? []).filter((run) => ofProject(run, project) && !run.item))

export interface ProofChip {
  id: string
  label: string
  tone: Tone
}

/**
 * A finished card's chips: one for each model's check, and one for its proof when TLAPS ran. With more than one spec,
 * each chip names its file. A check of an older head than the card's is said so, in a quiet chip.
 */
export function chipsOf(runs: readonly ProofRunSummary[], head: string | null = null): ProofChip[] {
  const named = runs.length > 1
  return runs.flatMap((run) => {
    const name = named ? `${specFile(run.spec).replace(/\.tla$/, '')} ` : 'Model '
    const older = head && run.head && !sameHead(run.head, head)
    const check: ProofChip = older ? { id: run.id, label: `${name}checked at an older head`, tone: 'quiet' } : { id: run.id, ...checkChip(run, name) }
    const prove = run.steps.find((step) => step.id === 'prove')
    if (older || (prove?.state !== 'done' && prove?.state !== 'failed')) return [check]
    return [check, { id: run.id, label: prove.state === 'done' ? 'Proved for every size' : 'Proof fails', tone: prove.state === 'done' ? 'ok' : 'bad' }]
  })
}

function checkChip(run: ProofRunSummary, name: string): Omit<ProofChip, 'id'> {
  switch (run.outcome) {
    case 'checking':
      return { label: `Checking · ${count(run.stats.distinct)} states`, tone: 'live' }
    case 'holds': {
      const missed = neverFired(run)
      return missed.length ? { label: `${name}holds · ${namesOf(missed)} never ran`, tone: 'warn' } : { label: `${name}holds · ${count(run.stats.distinct)} states`, tone: 'ok' }
    }
    case 'broken':
      return { label: `${name}broke · ${stepsToBreak(run)} ${stepsToBreak(run) === 1 ? 'step' : 'steps'}`, tone: 'bad' }
    case 'stopped':
      return { label: `${name}check stopped`, tone: 'quiet' }
    case 'error':
      return { label: `${name}check could not run`, tone: 'bad' }
  }
}

/** A run in a line and a mono line under it, for the agent's step and the YOLO page. */
export function runWords(run: ProofRunSummary): { title: string; detail: string; tone: Tone } {
  const file = specFile(run.spec)
  const { distinct, depth } = run.stats
  const rules = run.rules.length
  switch (run.outcome) {
    case 'checking': {
      const holding = run.rules.filter((rule) => rule.status === 'holding' || rule.status === 'holds').length
      const parsing = run.steps.find((step) => step.state === 'running')?.id === 'parse'
      return { title: parsing ? `Parsing ${file}` : `Checking ${file}`, detail: `${count(distinct)} states · depth ${count(depth)} · ${holding} of ${rules} holding so far`, tone: 'live' }
    }
    case 'holds': {
      const missed = neverFired(run)
      if (missed.length) return { title: `${file} holds, but ${namesOf(missed)} never ran`, detail: `${count(distinct)} states · not evidence until every action runs`, tone: 'warn' }
      return { title: `${file} holds`, detail: `${count(distinct)} states · ${rules === 1 ? 'its rule holds' : `all ${rules} rules hold`}`, tone: 'ok' }
    }
    case 'broken':
      return { title: `${file}: ${run.broken ?? 'a rule'} breaks`, detail: `${stepsToBreak(run)} steps · ${count(distinct)} states`, tone: 'bad' }
    case 'stopped':
      return { title: `${file}: the check was stopped`, detail: `${count(distinct)} states looked at`, tone: 'quiet' }
    case 'error':
      return { title: `${file} could not be checked`, detail: run.message ?? 'hobkin says why on its page', tone: 'bad' }
  }
}

/**
 * How fast new states still come in, from 0 to 1, for the bar under an agent's check: the share of the states found
 * that TLC has still to explore. It falls to nothing as the model runs out of new states. It is never a time left.
 */
export const inflowOf = (run: Pick<ProofRunSummary, 'stats'>): number => (run.stats.distinct > 0 ? Math.min(1, run.stats.queue / run.stats.distinct) : 0)

/** What a project's models say together, for the YOLO page: "Models: 2 machines, both hold". */
export function modelsLine(runs: readonly ProofRunSummary[]): { title: string; detail: string; tone: Tone } {
  const holding = runs.filter((run) => run.outcome === 'holds' && !neverFired(run).length).length
  const broken = runs.filter((run) => run.outcome === 'broken').length
  const checking = runs.some((run) => run.outcome === 'checking')
  const machines = runs.length === 1 ? '1 machine' : `${runs.length} machines`
  const detail = `${runs.map((run) => specFile(run.spec)).join(' · ')} · rechecked when their code changes`
  if (checking) return { title: `Models: ${machines}, checking now`, detail, tone: 'live' }
  if (broken) return { title: `Models: ${machines}, ${broken === 1 ? (runs.length === 1 ? 'it breaks' : '1 breaks') : `${broken} break`}`, detail, tone: 'bad' }
  if (holding === runs.length) return { title: `Models: ${machines}, ${runs.length === 1 ? 'it holds' : runs.length === 2 ? 'both hold' : 'all hold'}`, detail, tone: 'ok' }
  return { title: `Models: ${machines}, ${holding} of ${runs.length} hold`, detail, tone: 'warn' }
}

/** The spec a shell command checks, when it is `hobkin proof check <spec.tla>`, with or without a path to hobkin. */
export function proofCheckOf(command: string): string | null {
  const match = /(?:^|[\s;&|(])(?:\S*\/)?hobkin\s+proof\s+check\s+(?:--\S+(?:[ =]\S+)?\s+)*['"]?([^\s'"]+\.tla)['"]?/.exec(command)
  return match?.[1] ?? null
}

const specMatches = (run: ProofRunSummary, spec: string) => run.spec === spec || run.spec.endsWith(`/${spec}`) || spec.endsWith(`/${run.spec}`)

/**
 * The run an agent's `hobkin proof check` started: the one its output names (`proofs/<id>`), or else the first run of
 * that spec started from a moment before the command on, or with no time to go by, the newest run of that spec.
 */
export function runForCommand(proofs: ProofsState | null, { spec, at, output }: { spec: string; at?: number; output?: string }): ProofRunSummary | null {
  const runs = proofs?.runs ?? []
  const named = /proofs\/([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(output ?? '')?.[1]
  const byId = named ? runs.find((run) => run.id === named) : undefined
  if (byId) return byId
  const ofSpec = runs.filter((run) => specMatches(run, spec)).sort((left, right) => Date.parse(left.started) - Date.parse(right.started))
  if (at === undefined) return ofSpec.at(-1) ?? null
  return ofSpec.find((run) => Date.parse(run.started) >= at - 5_000) ?? null
}

/** The models that broke on main, newest first, for Home's Problems. */
export function brokenOnMain(proofs: ProofsState | null): ProofRunSummary[] {
  const runs = (proofs?.runs ?? []).filter((run) => run.project && !run.item)
  const newest = new Map<string, ProofRunSummary>()
  for (const run of [...runs].sort((left, right) => Date.parse(right.started) - Date.parse(left.started))) {
    const key = `${run.project}\n${run.spec}`
    if (!newest.has(key)) newest.set(key, run)
  }
  return [...newest.values()].filter((run) => run.outcome === 'broken')
}

/** The item's title from work mode, wherever it shows: a finished change, a queue row or an agent's run. */
export function itemTitle(run: Pick<ProofRunSummary, 'project' | 'item'>, work: WorkState | null, agents: readonly { work?: { slug?: string; item?: string }; title?: string }[] = []): string | null {
  if (!run.project || !run.item) return null
  const same = (slug: string | null | undefined, item: string | null | undefined) => slug === run.project && item === run.item
  const change = work?.finished.flatMap((group) => group.changes).find((candidate) => same(candidate.slug, candidate.item))
  const queued = work?.queue.find((row) => same(row.slug, row.item))
  const agent = agents.find((candidate) => same(candidate.work?.slug, candidate.work?.item) && candidate.title)
  return change?.title ?? queued?.title ?? agent?.title ?? null
}

/** Where the run belongs, as the page's eyebrow: "Work · hobkin · item 4f2c", "Work · hobkin · on main", or "Proof run". */
export function placeOf(run: Pick<ProofRunSummary, 'project' | 'item'>, work: WorkState | null): string {
  if (!run.project) return 'Proof run'
  const name = work?.projects.find((project) => project.slug === run.project)?.name ?? run.project
  return run.item ? `Work · ${name} · item ${run.item}` : `Work · ${name} · on main`
}
