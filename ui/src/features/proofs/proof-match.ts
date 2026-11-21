import type { ProofRunSummary, ProofsState } from '#shared/protocol/proofs.ts'
import type { ModelFact, WorkState } from '#shared/protocol/work.ts'
import { namesOf, neverFired, stepsToBreak, type Tone } from './run/run-view.ts'

/**
 * Where proof runs show outside their own page (_specs/050-tla-proofs, screen 4): which runs belong to a finished card,
 * which run an agent's `hobkin proof check` started, what hobkin's runs say of a project's models, and the words for
 * each. Pure, so the matching is tested without a window.
 */

const count = (value: number) => value.toLocaleString('en-US')

/** The spec's file name: `_specs/tla/WorkItem.tla` is WorkItem.tla. */
export const specFile = (spec: string) => spec.split('/').filter(Boolean).at(-1) ?? spec

/** Two commits are the same when one is the other's short form. */
export const sameHead = (left: string | null | undefined, right: string | null | undefined): boolean => Boolean(left && right && (left.startsWith(right) || right.startsWith(left)))

const newestFirst = (left: ProofRunSummary, right: ProofRunSummary) => Date.parse(right.started) - Date.parse(left.started)

/** The newest run of each spec among `runs`, newest first. */
function newestPerSpec(runs: readonly ProofRunSummary[]): ProofRunSummary[] {
  const seen = new Set<string>()
  return [...runs].sort(newestFirst).filter((run) => {
    if (seen.has(run.spec)) return false
    seen.add(run.spec)
    return true
  })
}

/**
 * The runs for one work item, the newest of each spec. When the card shows a head, a spec's newest run at that head
 * stands for it, so a check of an older head never speaks for the change the user is about to merge.
 */
export function runsForItem(proofs: ProofsState | null, project: string, item: string, head: string | null = null): ProofRunSummary[] {
  const mine = (proofs?.runs ?? []).filter((run) => run.project === project && run.item === item)
  const atHead = head ? mine.filter((run) => sameHead(run.head, head)) : []
  return newestPerSpec(atHead.length ? atHead : mine)
}

export interface ProofChip {
  /** The run it opens. Null for a model nothing checked, whose chip is not a button. */
  id: string | null
  label: string
  tone: Tone
}

/**
 * A finished card's chips: one for each model's check, and one for its proof when TLAPS ran. With more than one spec,
 * each chip names its file, or when `named` says so. A check of an older head than the card's is said so, in a quiet chip.
 */
export function chipsOf(runs: readonly ProofRunSummary[], head: string | null = null, named = runs.length > 1): ProofChip[] {
  return runs.flatMap((run) => {
    const name = named ? `${specFile(run.spec).replace(/\.tla$/, '')} ` : 'Model '
    const older = Boolean(head && run.head && !sameHead(run.head, head))
    if (older) return [{ id: run.id, label: `${name}checked at an older head`, tone: 'quiet' }]

    const check: ProofChip = { id: run.id, ...checkChip(run, name) }
    const proof = run.steps.find((step) => step.id === 'prove')?.state
    if (proof === 'done') return [check, { id: run.id, label: 'Proved for every size', tone: 'ok' }]
    if (proof === 'failed') return [check, { id: run.id, label: 'Proof fails', tone: 'bad' }]
    return [check]
  })
}

function checkChip(run: ProofRunSummary, name: string): Omit<ProofChip, 'id'> {
  switch (run.outcome) {
    case 'checking':
      return { label: `Checking · ${count(run.stats.distinct)} states`, tone: 'live' }
    case 'holds': {
      const missed = neverFired(run)
      if (missed.length) return { label: `${name}holds · ${namesOf(missed)} never ran`, tone: 'warn' }
      return { label: `${name}holds · ${count(run.stats.distinct)} states`, tone: 'ok' }
    }
    case 'broken': {
      const steps = stepsToBreak(run)
      return { label: `${name}broke · ${steps} ${steps === 1 ? 'step' : 'steps'}`, tone: 'bad' }
    }
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

/** The spec a shell command checks, when it is `hobkin proof check <spec.tla>`, with or without a path to hobkin. */
export function proofCheckOf(command: string): string | null {
  const match = /(?:^|[\s;&|(])(?:\S*\/)?hobkin\s+proof\s+check\s+(?:--\S+(?:[ =]\S+)?\s+)*['"]?([^\s'"]+\.tla)['"]?/.exec(command)
  return match?.[1] ?? null
}

/** A command names its spec from where it ran, the run from the project: the same file when one path ends with the other. */
const specMatches = (run: ProofRunSummary, spec: string) => run.spec === spec || run.spec.endsWith(`/${spec}`) || spec.endsWith(`/${run.spec}`)

/** A run can start a moment before hobkin records the command that started it. */
const START_SLACK_MS = 5_000

/**
 * The run an agent's `hobkin proof check` started: the one its output names (`proofs/<id>`), or else the first run of
 * that spec started from a moment before the command on, or with no time to go by, the newest run of that spec.
 */
export function runForCommand(proofs: ProofsState | null, { spec, at, output }: { spec: string; at?: number; output?: string }): ProofRunSummary | null {
  const runs = proofs?.runs ?? []
  const named = /proofs\/([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(output ?? '')?.[1]
  const byId = named ? runs.find((run) => run.id === named) : undefined
  if (byId) return byId

  const oldestFirst = runs.filter((run) => specMatches(run, spec)).sort((left, right) => newestFirst(right, left))
  if (at === undefined) return oldestFirst.at(-1) ?? null
  return oldestFirst.find((run) => Date.parse(run.started) >= at - START_SLACK_MS) ?? null
}

type Agent = { work?: { slug?: string; item?: string }; title?: string }

export function itemTitle(run: Pick<ProofRunSummary, 'project' | 'item'>, work: WorkState | null, agents: readonly Agent[] = []): string | null {
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

// What hobkin's own runs say of each model (`ModelFact`), as work mode and YOLO mode send it.

const FACT_WORDS: Readonly<Record<ModelFact['state'], { state: string; tone: Tone }>> = {
  holds: { state: 'Holds', tone: 'ok' },
  broken: { state: 'Broken', tone: 'bad' },
  unproven: { state: 'Not evidence', tone: 'warn' },
  unchecked: { state: 'Not checked', tone: 'quiet' },
}

export interface FactRow {
  spec: string
  file: string
  state: string
  tone: Tone
  /** What the run showed, why it is no evidence, or that nothing checked it. */
  line: string
  run: string | null
}

/** One model on the YOLO page: its file, how it stands, hobkin's line for it, and the run that says so. */
export function factRow(fact: ModelFact): FactRow {
  const { state, tone } = FACT_WORDS[fact.state]
  const line = fact.line ?? (fact.why ? `${fact.why}.` : 'No run of it on the default branch yet.')
  return { spec: fact.spec, file: specFile(fact.spec), state, tone, line, run: fact.run ?? null }
}

/** What a project's models say together, for the YOLO page: "Models: 2 machines, both hold". */
export function factsLine(facts: readonly ModelFact[]): { title: string; tone: Tone } {
  const total = facts.length
  const machines = `Models: ${total === 1 ? '1 machine' : `${total} machines`}`
  const broken = facts.filter((fact) => fact.state === 'broken').length
  const holding = facts.filter((fact) => fact.state === 'holds').length

  if (broken) {
    const breaks = total === 1 ? 'it breaks' : broken === 1 ? '1 breaks' : `${broken} break`
    return { title: `${machines}, ${breaks}`, tone: 'bad' }
  }
  if (holding === total) {
    const hold = total === 1 ? 'it holds' : total === 2 ? 'both hold' : 'all hold'
    return { title: `${machines}, ${hold}`, tone: 'ok' }
  }
  return { title: `${machines}, ${holding} of ${total} hold`, tone: 'warn' }
}

/**
 * A finished card's chips from what hobkin's runs at its head say of each model covering it: holds, broke, ran but is no
 * evidence, or not checked at this head. A run the proofs slice still has adds its counts and its proof.
 */
export function factChips(facts: readonly ModelFact[], runs: readonly ProofRunSummary[]): ProofChip[] {
  const named = facts.length > 1
  return facts.flatMap((fact) => {
    const name = named ? `${specFile(fact.spec).replace(/\.tla$/, '')} ` : 'Model '
    const run = fact.run ? runs.find((candidate) => candidate.id === fact.run) : undefined
    const id = fact.run ?? null

    switch (fact.state) {
      case 'unchecked':
        return [{ id, label: `${name}not checked at this head`, tone: 'quiet' }]
      case 'unproven':
        return [{ id, label: `${name}ran · ${fact.why ?? 'not evidence'}`, tone: 'warn' }]
      case 'broken': {
        const steps = run ? ` · ${stepsToBreak(run)} ${stepsToBreak(run) === 1 ? 'step' : 'steps'}` : ''
        return [{ id, label: `${name}broke${steps}`, tone: 'bad' }, ...proofChips(run)]
      }
      case 'holds': {
        const states = run ? ` · ${count(run.stats.distinct)} states` : ''
        return [{ id, label: `${name}holds${states}`, tone: 'ok' }, ...proofChips(run)]
      }
    }
  })
}

function proofChips(run: ProofRunSummary | undefined): ProofChip[] {
  const proof = run?.steps.find((step) => step.id === 'prove')?.state
  if (!run || (proof !== 'done' && proof !== 'failed')) return []
  return [{ id: run.id, label: proof === 'done' ? 'Proved for every size' : 'Proof fails', tone: proof === 'done' ? 'ok' : 'bad' }]
}

/** The models that broke on a project's default branch, for Home's Problems, each with its project's name. */
export function brokenModels(work: WorkState | null): { project: string; fact: ModelFact & { run: string } }[] {
  return (work?.projects ?? []).flatMap((project) =>
    (project.models ?? []).flatMap((fact) => (fact.state === 'broken' && fact.run ? [{ project: project.name, fact: { ...fact, run: fact.run } }] : [])),
  )
}
