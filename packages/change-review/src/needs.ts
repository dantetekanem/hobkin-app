/**
 * The user's questions in every review (spec 058 A11): five ratings from 1 to 10 the Reviewer gives in its one answer,
 * held to what the review measured. A rating says how well a question is answered, never how risky the change is, so
 * it sets no level and no fact; and no level sets a rating, except through the caps here, each said in the score's
 * evidence when it bites.
 */
import { isTestPath } from './triage.ts'
import { changesOnlyModels, isModelFile, modelsOf } from './tla.ts'
import { readRatings } from './model.ts'
import { NEED_CRITERIA, NEED_KINDS } from './types.ts'
import type { Answered, ChangedFile, ModelCheck, NeedCriterion, NeedKind, NeedScore, NotRated, ReviewNeeds, ReviewNode, TestRun } from './types.ts'

/** What the caps read, as the review measured it. */
export interface NeedsFacts {
  /** Changed definitions no test that ran proves, by name. */
  unproven: string[]
  /** How many changed definitions a test that ran proves. */
  proven: number
  /** Test files the change adds or edits. */
  testsChanged: number
  /** Parts that are high. */
  high: string[]
  /** Parts nothing undoes. */
  undoNone: string[]
  /** Parts that write data or take effect at load. */
  dataOrLoad: string[]
  /** The project's monitoring was handed in. */
  monitoring: boolean
  /** The change is TLA+ models and their configs, and nothing else. */
  onlyModels: boolean
  onlyTests?: boolean
  /** Every changed file is documentation and nothing that runs, builds or generates names it: nothing runs differently. */
  onlyUnread: boolean
  /** Models of the change whose check broke a rule at this commit. */
  brokenModels: string[]
  /** Models of the change with no check that held or broke at this commit. */
  uncheckedModels: string[]
  /** Explicit branch gaps are not regressions, even when another test proves the definition. */
  coverageGaps?: string[]
  changedProof?: number
  /** Criterion-specific measured evidence. Absent only on older callers. */
  evidence?: Record<string, { criteria: NeedCriterion[]; text: string; uncertain?: boolean; highRisk?: boolean }>
}

/** The longest evidence hobkin keeps for a score. */
export const LONGEST_EVIDENCE = 400
const PROVEN = new Set(['lifecycle-observed', 'lifecycle', 'isolated'])
const fileOf = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

/** Prose on one line: white space made single spaces, with none at the ends. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Names as words, each on one line, and a name that is empty left out: "a", "a and b", "a, b, c and 2 more", or "a part". */
function named(names: readonly string[]): string {
  const kept = names.map(oneLine).filter(Boolean)
  const shown = kept.length > 3 ? [...kept.slice(0, 3), `${kept.length - 3} more`] : kept
  if (!shown.length) return 'a part'
  return shown.length < 2 ? shown[0]! : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`
}

/** Whether names that are said as `named` says them are more than one. */
const several = (names: readonly string[]) => names.map(oneLine).filter(Boolean).length > 1

/** What the caps read, from the review's parts as rated, the change's files, the model checks and the monitoring given. */
export function needsFacts({ nodes, files, checks, monitoring, onlyUnread = false, runs = [] }: { nodes: readonly ReviewNode[]; runs?: readonly TestRun[]; files: readonly ChangedFile[]; checks: readonly ModelCheck[]; monitoring: boolean; onlyUnread?: boolean }): NeedsFacts {
  const paths = files.map((file) => file.path)
  const parts = nodes.filter((node) => !node.hidden && node.kind !== 'test' && node.change !== 'none')
  const definitions = parts.filter((node) => (node.kind === 'function' || node.findings.some((finding) => finding.rule === 'not-mapped')) && node.change !== 'removed' && node.facts.effect.value !== 'text')
  const modelPaths = [...paths, ...checks.map((check) => check.spec)]
  const specs = modelsOf(paths.filter((path) => isModelFile(path, modelPaths)))
  const checkOf = (spec: string) => checks.find((check) => check.spec === spec)
  const onlyTests = paths.length > 0 && paths.every(isTestPath)
  const onlyModels = changesOnlyModels(paths)
  const evidence: NonNullable<NeedsFacts['evidence']> = Object.create(null)
  for (const node of parts) {
    evidence[`${node.id}:proof`] = { criteria: ['coverage', 'proof'], text: `${node.symbol}: ${node.facts.proof.value}; ${node.facts.proof.evidence}` }
    evidence[`${node.id}:risk`] = { criteria: ['safety'], ...(node.level?.current === 'high' || node.facts.undo.value === 'none' ? { highRisk: true } : {}), text: `${node.symbol}: ${node.level?.current ?? 'unknown'}; ${node.level?.why.join(' ') ?? 'not rated'}` }
    evidence[`${node.id}:undo`] = { criteria: ['rollback'], text: `${node.symbol}: ${node.facts.undo.value}; ${node.facts.undo.evidence}` }
    if (node.facts.proof.value === 'unknown' || node.unverified || node.extras.unresolvedReference) evidence[`${node.id}:uncertainty`] = { criteria: ['safety'], uncertain: true, text: `${node.symbol}: impact is uncertain, not a demonstrated regression; ${node.extras.unresolvedReference ?? node.unverified ?? node.facts.proof.evidence}` }
    if (node.watch) evidence[`${node.id}:watch`] = { criteria: ['visibility'], text: JSON.stringify(node.watch) }
  }
  for (const path of paths.filter((path) => isTestPath(path) || isModelFile(path, paths))) {
    const check = checks.find((check) => check.spec === path)
    const baselines = runs.filter((run) => run.kind === 'baseline' && !run.node && run.tests.includes(path))
    const own = baselines.find((run) => run.tests.length === 1)
    const result = check?.result ?? (own && !own.not_run ? own.exit_code === 0 ? 'passed at head' : 'failed at head' : !own && baselines.length ? 'no individual file result' : 'not run at head')
    evidence[path] = { criteria: onlyTests || onlyModels ? ['coverage', 'proof', 'safety', 'rollback'] : isTestPath(path) ? ['coverage', 'proof'] : [], uncertain: !check && (!own || Boolean(own.not_run)), text: `${path}: ${result}; ${onlyModels ? 'model evidence, not an implementation test' : 'test changes, not branch coverage'}. Reverting restores the previous check.` }
  }
  if (monitoring) evidence.monitoring = { criteria: ['visibility'], text: 'Use the supplied project monitoring, not CI results.' }
  if (onlyUnread) evidence.unread = { criteria: ['coverage', 'proof', 'safety', 'rollback'], text: `No runtime, build or generator consumer found for ${paths.join(', ')}.` }
  return {
    evidence,
    coverageGaps: parts.flatMap((node) => node.findings.filter((finding) => finding.rule === 'coverage-gap').map((finding) => `${node.symbol}: ${finding.text}`)),
    changedProof: definitions.filter((node) => PROVEN.has(node.facts.proof.value) && node.extras.testChangedWithIt).length,
    unproven: definitions.filter((node) => !PROVEN.has(node.facts.proof.value)).map((node) => node.symbol),
    proven: definitions.filter((node) => PROVEN.has(node.facts.proof.value)).length,
    testsChanged: files.filter((file) => isTestPath(file.path) && file.status !== 'deleted').length,
    high: parts.filter((node) => node.level?.current === 'high').map((node) => node.symbol),
    undoNone: parts.filter((node) => node.facts.undo.value === 'none').map((node) => node.symbol),
    dataOrLoad: parts.filter((node) => ['data', 'load'].includes(node.facts.effect.value) || node.facts.exposure.value === 'at-load').map((node) => node.symbol),
    monitoring,
    onlyModels,
    onlyTests,
    onlyUnread,
    brokenModels: specs.filter((spec) => checkOf(spec)?.result === 'violated').map(fileOf),
    uncheckedModels: specs.filter((spec) => !['holds', 'violated'].includes(checkOf(spec)?.result ?? '')).map(fileOf),
  }
}

/** The most each score may be, by the facts, with why: the lowest cap that applies. */
function capsOf(facts: NeedsFacts): Partial<Record<NeedCriterion, { most: number; why: string }>> {
  const caps: Partial<Record<NeedCriterion, { most: number; why: string }>> = {}
  // A change of only TLA+ models is proven by its model check, not by tests: the test caps do not apply to it.
  if (!facts.onlyModels && facts.proven === 0 && facts.unproven.length) caps.coverage = { most: 3, why: `no test that ran proves a changed definition (${named(facts.unproven)})` }
  if (facts.brokenModels.length) caps.proof = { most: 3, why: `the model check of ${named(facts.brokenModels)} breaks a rule at this commit` }
  else if (facts.onlyModels && facts.uncheckedModels.length) caps.proof = { most: 4, why: `the model check of ${named(facts.uncheckedModels)} was not run at this commit` }
  else if (!facts.onlyModels && !facts.onlyUnread && facts.testsChanged === 0) caps.proof = { most: 4, why: 'no test was added or changed with the change' }
  else if (!facts.onlyModels && !facts.onlyTests && !facts.onlyUnread && facts.changedProof === 0) caps.proof = { most: 4, why: 'no added or changed test was measured proving a changed definition' }
  if (facts.high.length) caps.safety = { most: 5, why: `${named(facts.high)} ${several(facts.high) ? 'are' : 'is'} rated high` }
  if (facts.undoNone.length) caps.rollback = { most: 4, why: `nothing undoes ${named(facts.undoNone)}` }
  // With no monitoring known visibility is set by rule (`capNeeds`). With monitoring given, whether it covers
  // a part that writes data or runs at load is the Reviewer's to judge: the prompt asks for 4 or less where it does not.
  return caps
}

/** Refuse unsupported numbers, rather than inventing a replacement for a false premise. */
function unsupportedScore(criterion: NeedCriterion, score: NeedScore, facts: NeedsFacts): string | null {
  if (!facts.evidence || (criterion === 'visibility' && !facts.monitoring)) return null
  const cited = (score.facts ?? []).map((id) => Object.hasOwn(facts.evidence!, id) ? facts.evidence![id] : undefined)
  if (!cited.length || cited.some((fact) => !fact?.criteria.includes(criterion))) return 'cite measured rating_evidence for this criterion; CI or an unaccepted finding is not proof'
  if (criterion === 'safety' && score.score <= 5 && !cited.some((fact) => fact?.highRisk || fact?.uncertain)) return 'a safety score of 5 or less needs an established break, irreversible effect, or explicitly cited uncertainty; not an invented failure'
  if (criterion === 'coverage' && score.score >= 9 && (facts.unproven.length || facts.coverageGaps?.length)) return `near-complete ${criterion} conflicts with unproven parts or branch gaps: ${named([...facts.unproven, ...(facts.coverageGaps ?? [])])}`
  return null
}

/** A score held to its cap, the cap said at the end of its evidence, within the length hobkin keeps. */
function heldTo(kept: NeedScore, cap: { most: number; why: string } | undefined): NeedScore {
  if (!cap || kept.score <= cap.most) return kept
  // The cap's words join the evidence as prose: one line, single spaces, within the length hobkin keeps.
  const why = oneLine(cap.why)
  const said = ` Capped at ${cap.most}: ${why}.`
  const room = LONGEST_EVIDENCE - said.length
  const own = oneLine(kept.evidence)
  const evidence = own.length <= room ? own : `${own.slice(0, Math.max(0, room - 1)).trimEnd()}…`
  return { ...kept, score: cap.most, evidence: `${evidence}${said}`.slice(0, LONGEST_EVIDENCE), capped: { from: kept.score, why } }
}

/** The rating visibility gets when no monitoring is known: a stated rule, never the Reviewer's guess (spec 063). */
export const VISIBILITY_BY_RULE: NeedScore = { score: 3, evidence: 'no monitoring is known for this project, so a regression would not show', byRule: true }

/** How many narrow calls a review makes for ratings still missing, when the host passes no number. */
export const DEFAULT_RATING_TRIES = 3

/**
 * The Reviewer's answers to the user's questions, held to what the review measured, at the review's commit. With no
 * monitoring known a visibility score the Reviewer gave is a guess: it is not kept, and `problems` says so. Visibility
 * is then 3 by rule and says so, which keeps the general rate. Every other rating is the Reviewer's, never invented.
 */
export function capNeeds(answered: Answered, facts: NeedsFacts, head: string, problems: string[] = []): ReviewNeeds {
  const caps = capsOf(facts)
  const given = Object.entries(answered.scores).filter(([criterion, score]) => {
    if (criterion === 'visibility' && !facts.monitoring) {
      problems.push('needs.scores.visibility: a visibility rating was given with no monitoring known, and was not kept')
      return false
    }
    const reason = unsupportedScore(criterion as NeedCriterion, score!, facts)
    if (!reason) return true
    problems.push(`needs.scores.${criterion}: ${reason}; dropped`)
    return false
  })
  const held = given.map(([criterion, kept]) => [criterion, heldTo(kept!, caps[criterion as NeedCriterion])] as const)
  const byRule = facts.monitoring ? [] : ([['visibility', VISIBILITY_BY_RULE]] as const)
  const scores = Object.fromEntries(NEED_CRITERIA.flatMap((criterion) => [...held, ...byRule].filter(([name]) => name === criterion)))
  return { ...answered, scores, head, by: 'change-review', monitoring: facts.monitoring ? 'given' : 'unknown' }
}

/** The ratings a review needs from the Reviewer: all five, or four when no monitoring is known and visibility is set by rule. */
const requiredOf = (facts: NeedsFacts): NeedCriterion[] => NEED_CRITERIA.filter((criterion) => criterion !== 'visibility' || facts.monitoring)

const MOST_OF_REVIEW = 30_000

/** What the narrow call is told, and what it asks for: only the ratings that are missing. */
function ratingsRequest({ held, missing, kind, review, monitoring, attempt, of, facts }: { facts: NeedsFacts; held: Answered['scores']; missing: readonly ('kind' | NeedCriterion)[]; kind?: NeedKind; review: string; monitoring?: readonly string[]; attempt: number; of: number }) {
  const system = [
    "You are the Reviewer of a change. Your earlier answer left some of the user's ratings out or malformed. Give only the ratings named in `missing`, each from 1 to 10, as the user reads them: a whole number and one line of evidence that names what it rests on.",
    'Never give a rating that is not in `missing`. Answer with one JSON object: {"needs":{"kind":"<one of ' + NEED_KINDS.join(', ') + '>","scores":{"<name>":{"score":7,"evidence":"one line","facts":["rating_evidence key"]}}}}. The kind is needed only when `missing` names it.',
  ].join('\n')
  const data = { rating_evidence: facts.evidence, measured: { unproven: facts.unproven, coverage_gaps: facts.coverageGaps, high: facts.high, changed_proof: facts.changedProof, undo_none: facts.undoNone }, ask: 'missing-ratings', try: attempt, of, kind: kind ?? null, missing, given: held, monitoring: monitoring?.length ? monitoring : 'unknown', review: review.slice(0, MOST_OF_REVIEW) }
  return { system, prompt: `Ratings still missing\n${JSON.stringify(data)}` }
}

/** The names of what is missing as words: "coverage", "coverage and proof", "the kind, coverage and proof". */
const lacking = (names: readonly ('kind' | NeedCriterion)[]) => {
  const words = names.map((name) => (name === 'kind' ? 'the kind' : name))
  return words.length < 2 ? words[0]! : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/** One call to the Reviewer for ratings: its text, nothing when it gave none, or why it could not be asked. */
export type AskRatings = (call: { system: string; prompt: string }) => Promise<{ text: string | null } | { failed: string }>

/**
 * The five ratings of a review, always (spec 063). What the Reviewer's answer lacks, a missing score or one that did
 * not hold, is asked again in a narrow call that names only what is still missing, at most `tries` times and never
 * once more than needed. A score the Reviewer gave is never replaced. After the last try what is missing stays
 * missing and `notRated` says how many tries and why: never a guessed number. Only visibility with no monitoring
 * known is set by rule, and says so.
 */
export async function rateNeeds(input: {
  answered?: Answered
  facts: NeedsFacts
  head: string
  /** The finished review's story: what the narrow call is told the review found. */
  review: string
  monitoring?: readonly string[]
  tries: number
  /** Absent: there is no model to ask. */
  ask?: AskRatings
  problems?: string[]
}): Promise<{ needs?: ReviewNeeds; notRated?: NotRated }> {
  const { facts, head, review, monitoring, ask } = input
  const problems = input.problems ?? []
  const allowed = Math.max(0, Math.floor(Number.isFinite(input.tries) ? input.tries : DEFAULT_RATING_TRIES))
  const required = requiredOf(facts)
  let kind = input.answered?.kind
  const validScores = (given: Answered['scores']) => Object.fromEntries(Object.entries(given).filter(([criterion, score]) => {
    const reason = unsupportedScore(criterion as NeedCriterion, score!, facts)
    if (reason) problems.push(`needs.scores.${criterion}: ${reason}; dropped`)
    return !reason
  })) as Answered['scores']
  const scores: Answered['scores'] = validScores(input.answered?.scores ?? {})
  const missingNow = (): ('kind' | NeedCriterion)[] => [...(kind ? [] : (['kind'] as const)), ...required.filter((criterion) => !scores[criterion])]
  let reason = input.answered ? 'the answer lacked ratings' : 'the answer had no ratings'
  let tried = 0
  while (ask && tried < allowed && missingNow().length) {
    tried += 1
    const missing = missingNow()
    const call = ratingsRequest({ facts, held: scores, missing, ...(kind ? { kind } : {}), review, ...(monitoring ? { monitoring } : {}), attempt: tried, of: allowed })
    const answer = await ask(call)
    if ('failed' in answer) {
      reason = `the Reviewer could not be asked (${answer.failed})`
      problems.push(`The ratings were asked for again (try ${tried} of ${allowed}) and the Reviewer could not be asked: ${answer.failed}.`)
      continue
    }
    if (answer.text == null) {
      reason = 'the Reviewer gave no answer'
      continue
    }
    const read = readRatings(answer.text, missing.filter((name): name is NeedCriterion => name !== 'kind'), missing.includes('kind'))
    if (read.kind && !kind) kind = read.kind
    const valid = validScores(read.scores)
    for (const criterion of required) if (valid[criterion] && !scores[criterion]) scores[criterion] = valid[criterion]
    const left = missingNow()
    if (left.length) {
      reason = read.why.find((line) => left.some((name) => line.startsWith(`${name}:`))) ?? read.why[0] ?? 'the answer lacked ratings'
      problems.push(`Ratings asked for again (try ${tried} of ${allowed}): ${reason}.`)
    }
  }
  const missing = missingNow()
  const needs = kind ? capNeeds({ kind, ...(input.answered?.missing ? { missing: input.answered.missing } : {}), scores }, facts, head, problems) : undefined
  if (!missing.length) return { needs }
  const why = !ask
    ? `there is no model to ask: the answer lacked ${lacking(missing)}`
    : tried === 0
      ? `no tries were allowed: the answer lacked ${lacking(missing)}`
      : `after ${tried} ${tried === 1 ? 'try' : 'tries'} the answer still lacked ${lacking(missing)}: ${reason}`
  return { ...(needs ? { needs } : {}), notRated: { tries: tried, missing, why } }
}
